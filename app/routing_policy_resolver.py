import uuid
from dataclasses import dataclass

from app.errors import ModelError, ValidationError
from app.repository import (
    CanonicalRepository,
    RoutingPolicyRecord,
    RoutingPolicyRuleRecord,
    RoutingTableRecord,
)
from app.routing_policy_actions import RoutingTableSelection
from app.routing_policy_predicates import (
    RoutingPolicyPredicateEvaluationContext,
    evaluate_routing_policy_predicate,
)
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    RoutingPolicyEvaluationArtifact,
    RoutingPolicyEvaluationBranch,
    RoutingPolicyEvaluationGap,
    RoutingPolicyEvaluationQuery,
    RoutingPolicyRuleEvaluationStep,
    RoutingTableSelection as RoutingTableSelectionSchema,
)


@dataclass(frozen=True)
class _Branch:
    steps: tuple[RoutingPolicyRuleEvaluationStep, ...]
    terminal_source: str
    terminal_rule_id: uuid.UUID | None
    selection: RoutingTableSelection
    selected_table: RoutingTableRecord
    evidence_refs: tuple[EvidenceRef, ...]


class ConfiguredRoutingPolicyResolver:
    VERSION = "routing-policy-configured/1.1"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self, query: RoutingPolicyEvaluationQuery, view: EvaluationView
    ) -> RoutingPolicyEvaluationArtifact:
        destination_ip = query.packet_state.destination_ip
        if destination_ip is None:
            raise ValidationError(
                "packet_state.destination_ip is required for RoutingPolicy evaluation"
            )
        self.repository.validate_routing_policy_evaluation_context(
            routing_context_id=query.routing_context_id,
            ingress_network_interface_id=query.ingress_network_interface_id,
            ingress_l3_binding_id=query.ingress_l3_binding_id,
        )
        policy = self.repository.get_routing_policy(query.policy_id)
        address_family = "IPv4" if destination_ip.version == 4 else "IPv6"
        policy_ref = self._ref("RoutingPolicy", policy.routing_policy_id)
        tables = {table.table_id: table for table in policy.routing_tables}
        logical = self._evaluate_rules(
            policy,
            RoutingPolicyPredicateEvaluationContext(
                packet_state=query.packet_state,
                routing_context_id=query.routing_context_id,
                traffic_class=query.traffic_class,
                ingress_network_interface_id=query.ingress_network_interface_id,
                ingress_l3_binding_id=query.ingress_l3_binding_id,
            ),
            query.routing_context_id,
            address_family,
            tables,
            0,
            (),
            (policy_ref,),
        )
        branches = [
            RoutingPolicyEvaluationBranch(
                branch_id=f"routing-policy-branch-{index}",
                steps=list(branch.steps),
                terminal_source=branch.terminal_source,  # type: ignore[arg-type]
                terminal_rule_id=branch.terminal_rule_id,
                selection=RoutingTableSelectionSchema(**branch.selection),
                selected_routing_table_id=branch.selected_table.table_id,
                evidence_refs=list(branch.evidence_refs),
            )
            for index, branch in enumerate(logical, start=1)
        ]
        all_refs = self._dedupe(
            [ref for branch in branches for ref in branch.evidence_refs]
        )

        if policy.configured_completeness != "COMPLETE":
            result = "TABLE_SELECTION_UNKNOWN"
            selected_table_id = None
            gaps = [
                RoutingPolicyEvaluationGap(
                    code="ROUTING_POLICY_INCOMPLETE",
                    evidence_refs=[policy_ref],
                )
            ]
        else:
            selected_ids = {branch.selected_table.table_id for branch in logical}
            if len(selected_ids) == 1:
                result = "TABLE_SELECTED"
                selected_table_id = next(iter(selected_ids))
                gaps = []
            else:
                result = "TABLE_SELECTION_UNKNOWN"
                selected_table_id = None
                gaps = [
                    RoutingPolicyEvaluationGap(
                        code="ROUTING_TABLE_SELECTION_UNKNOWN",
                        evidence_refs=all_refs,
                    )
                ]

        return RoutingPolicyEvaluationArtifact(
            query=query,
            evaluation_view=view,
            result=result,  # type: ignore[arg-type]
            policy_id=policy.routing_policy_id,
            configured_completeness=policy.configured_completeness,  # type: ignore[arg-type]
            routing_context_id=query.routing_context_id,
            address_family=address_family,
            selected_routing_table_id=selected_table_id,
            branches=branches,
            evidence_refs=all_refs,
            gaps=gaps,
            warnings=[],
        )

    def _evaluate_rules(
        self,
        policy: RoutingPolicyRecord,
        predicate_context: RoutingPolicyPredicateEvaluationContext,
        routing_context_id: uuid.UUID,
        address_family: str,
        tables: dict[uuid.UUID, RoutingTableRecord],
        index: int,
        steps: tuple[RoutingPolicyRuleEvaluationStep, ...],
        evidence: tuple[EvidenceRef, ...],
    ) -> list[_Branch]:
        if index == len(policy.rules):
            return [
                self._terminal(
                    policy,
                    None,
                    policy.default_selection,
                    routing_context_id,
                    address_family,
                    tables,
                    steps,
                    evidence,
                )
            ]

        rule = policy.rules[index]
        predicate_evaluation = evaluate_routing_policy_predicate(
            rule.predicate, predicate_context
        )
        predicate_result = predicate_evaluation.result
        rule_ref = self._ref("RoutingPolicyRule", rule.routing_policy_rule_id)
        predicate_refs = tuple(
            self._ref(entity_type, entity_id)
            for entity_type, entity_id in predicate_evaluation.canonical_refs
        )
        step_refs = tuple(self._dedupe([rule_ref, *predicate_refs]))
        next_evidence = evidence + step_refs
        if predicate_result == "TRUE":
            step = self._step(rule, "TRUE", "MATCH", step_refs)
            return [
                self._terminal(
                    policy,
                    rule,
                    rule.action,
                    routing_context_id,
                    address_family,
                    tables,
                    steps + (step,),
                    next_evidence,
                )
            ]
        if predicate_result == "FALSE":
            step = self._step(rule, "FALSE", "NO_MATCH", step_refs)
            return self._evaluate_rules(
                policy,
                predicate_context,
                routing_context_id,
                address_family,
                tables,
                index + 1,
                steps + (step,),
                next_evidence,
            )

        match_step = self._step(rule, "UNKNOWN", "MATCH", step_refs)
        no_match_step = match_step.model_copy(
            update={"branch_assumption": "NO_MATCH"}
        )
        return [
            self._terminal(
                policy,
                rule,
                rule.action,
                routing_context_id,
                address_family,
                tables,
                steps + (match_step,),
                next_evidence,
            ),
            *self._evaluate_rules(
                policy,
                predicate_context,
                routing_context_id,
                address_family,
                tables,
                index + 1,
                steps + (no_match_step,),
                next_evidence,
            ),
        ]

    def _terminal(
        self,
        policy: RoutingPolicyRecord,
        rule: RoutingPolicyRuleRecord | None,
        selection: RoutingTableSelection,
        routing_context_id: uuid.UUID,
        address_family: str,
        tables: dict[uuid.UUID, RoutingTableRecord],
        steps: tuple[RoutingPolicyRuleEvaluationStep, ...],
        evidence: tuple[EvidenceRef, ...],
    ) -> _Branch:
        table_id = uuid.UUID(selection["routing_table_id"])
        table = tables[table_id]
        details = {
            "routing_policy_id": str(policy.routing_policy_id),
            "selection_source": (
                str(rule.routing_policy_rule_id) if rule is not None else "DEFAULT"
            ),
            "routing_table_id": str(table_id),
            "expected_routing_context_id": str(routing_context_id),
            "actual_routing_context_id": str(table.routing_context_id),
            "expected_address_family": address_family,
            "actual_address_family": table.address_family,
        }
        if table.routing_context_id != routing_context_id:
            raise ModelError(
                "RoutingPolicy selected a RoutingTable from another RoutingContext",
                details,
            )
        if table.address_family != address_family:
            raise ModelError(
                "RoutingPolicy selected a RoutingTable with another address family",
                details,
            )
        table_ref = self._ref("RoutingTable", table.table_id)
        return _Branch(
            steps=steps,
            terminal_source="RULE" if rule is not None else "DEFAULT",
            terminal_rule_id=(
                rule.routing_policy_rule_id if rule is not None else None
            ),
            selection=selection,
            selected_table=table,
            evidence_refs=tuple(self._dedupe([*evidence, table_ref])),
        )

    @staticmethod
    def _step(
        rule: RoutingPolicyRuleRecord,
        predicate_result: str,
        branch_assumption: str,
        evidence_refs: tuple[EvidenceRef, ...],
    ) -> RoutingPolicyRuleEvaluationStep:
        return RoutingPolicyRuleEvaluationStep(
            rule_id=rule.routing_policy_rule_id,
            order_key=rule.order_key,
            predicate_result=predicate_result,  # type: ignore[arg-type]
            branch_assumption=branch_assumption,  # type: ignore[arg-type]
            evidence_refs=list(evidence_refs),
        )

    @staticmethod
    def _ref(entity_type: str, entity_id: uuid.UUID) -> EvidenceRef:
        return EvidenceRef(entity_type=entity_type, entity_id=entity_id)  # type: ignore[arg-type]

    @staticmethod
    def _dedupe(refs: list[EvidenceRef]) -> list[EvidenceRef]:
        result: list[EvidenceRef] = []
        seen: set[tuple[str, uuid.UUID]] = set()
        for ref in refs:
            key = (ref.entity_type, ref.entity_id)
            if key not in seen:
                seen.add(key)
                result.append(ref)
        return result
