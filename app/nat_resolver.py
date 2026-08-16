import uuid
from dataclasses import dataclass

from app.nat_transforms import NATTransform, apply_nat_transform
from app.packet_predicates import (
    PacketPredicateEvaluationContext,
    evaluate_predicate,
)
from app.repository import CanonicalRepository, NATPolicyRecord
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    NATPolicyEvaluationArtifact,
    NATPolicyEvaluationBranch,
    NATPolicyEvaluationGap,
    NATPolicyEvaluationQuery,
    NATRuleEvaluationStep,
    PacketState,
)


@dataclass(frozen=True)
class _Branch:
    steps: tuple[NATRuleEvaluationStep, ...]
    terminal_source: str
    terminal_rule_id: uuid.UUID | None
    selected_transform: NATTransform
    packet_after: PacketState
    evidence_refs: tuple[EvidenceRef, ...]


class ConfiguredNATPolicyResolver:
    VERSION = "nat-configured-policy/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self, query: NATPolicyEvaluationQuery, view: EvaluationView
    ) -> NATPolicyEvaluationArtifact:
        policy = self.repository.get_nat_policy(query.policy_id)
        policy_ref = self._ref("NATPolicy", policy.nat_policy_id)
        predicate_context = PacketPredicateEvaluationContext(
            packet_state=query.packet_state
        )
        logical = self._evaluate_rules(
            policy,
            predicate_context,
            query.packet_state,
            0,
            (),
            (policy_ref,),
        )
        branches = [
            NATPolicyEvaluationBranch(
                branch_id=f"nat-branch-{index}",
                steps=list(branch.steps),
                terminal_source=branch.terminal_source,  # type: ignore[arg-type]
                terminal_rule_id=branch.terminal_rule_id,
                selected_transform=branch.selected_transform,
                packet_before=query.packet_state,
                packet_after=branch.packet_after,
                evidence_refs=list(branch.evidence_refs),
            )
            for index, branch in enumerate(logical, start=1)
        ]

        if policy.configured_completeness != "COMPLETE":
            result = "UNKNOWN"
            packet_after = None
            gaps = [
                NATPolicyEvaluationGap(
                    code="NAT_POLICY_INCOMPLETE", evidence_refs=[policy_ref]
                )
            ]
        else:
            packet_outputs = {
                self._packet_key(branch.packet_after) for branch in logical
            }
            all_identity = all(
                branch.selected_transform["op"] == "IDENTITY"
                for branch in logical
            )
            if all_identity:
                result = "IDENTITY"
                packet_after = query.packet_state
                gaps = []
            elif len(packet_outputs) == 1:
                result = "TRANSFORMED_EXACT"
                packet_after = logical[0].packet_after
                gaps = []
            else:
                result = "UNKNOWN"
                packet_after = None
                gaps = [
                    NATPolicyEvaluationGap(
                        code="NAT_TRANSLATION_UNKNOWN",
                        evidence_refs=self._dedupe(
                            [
                                ref
                                for branch in logical
                                for ref in branch.evidence_refs
                            ]
                        ),
                    )
                ]

        return NATPolicyEvaluationArtifact(
            query=query,
            evaluation_view=view,
            result=result,  # type: ignore[arg-type]
            policy_id=policy.nat_policy_id,
            configured_completeness=policy.configured_completeness,  # type: ignore[arg-type]
            packet_before=query.packet_state,
            packet_after=packet_after,
            branches=branches,
            evidence_refs=self._dedupe(
                [ref for branch in branches for ref in branch.evidence_refs]
            ),
            gaps=gaps,
            warnings=[],
        )

    def _evaluate_rules(
        self,
        policy: NATPolicyRecord,
        predicate_context: PacketPredicateEvaluationContext,
        packet_before: PacketState,
        index: int,
        steps: tuple[NATRuleEvaluationStep, ...],
        evidence: tuple[EvidenceRef, ...],
    ) -> list[_Branch]:
        if index == len(policy.rules):
            return [
                _Branch(
                    steps=steps,
                    terminal_source="DEFAULT",
                    terminal_rule_id=None,
                    selected_transform=policy.default_transform,
                    packet_after=apply_nat_transform(
                        policy.default_transform, packet_before
                    ),
                    evidence_refs=tuple(self._dedupe(list(evidence))),
                )
            ]

        rule = policy.rules[index]
        predicate_result = evaluate_predicate(rule.predicate, predicate_context)
        rule_ref = self._ref("NATRule", rule.nat_rule_id)
        next_evidence = evidence + (rule_ref,)
        if predicate_result == "TRUE":
            step = self._step(rule.nat_rule_id, rule.order_key, "TRUE", "MATCH", rule_ref)
            return [
                self._rule_terminal(
                    rule.nat_rule_id,
                    rule.transform,
                    packet_before,
                    steps + (step,),
                    next_evidence,
                )
            ]
        if predicate_result == "FALSE":
            step = self._step(rule.nat_rule_id, rule.order_key, "FALSE", "NO_MATCH", rule_ref)
            return self._evaluate_rules(
                policy,
                predicate_context,
                packet_before,
                index + 1,
                steps + (step,),
                next_evidence,
            )

        match_step = self._step(
            rule.nat_rule_id, rule.order_key, "UNKNOWN", "MATCH", rule_ref
        )
        no_match_step = match_step.model_copy(
            update={"branch_assumption": "NO_MATCH"}
        )
        return [
            self._rule_terminal(
                rule.nat_rule_id,
                rule.transform,
                packet_before,
                steps + (match_step,),
                next_evidence,
            ),
            *self._evaluate_rules(
                policy,
                predicate_context,
                packet_before,
                index + 1,
                steps + (no_match_step,),
                next_evidence,
            ),
        ]

    @staticmethod
    def _step(
        rule_id: uuid.UUID,
        order_key: int,
        predicate_result: str,
        branch_assumption: str,
        rule_ref: EvidenceRef,
    ) -> NATRuleEvaluationStep:
        return NATRuleEvaluationStep(
            rule_id=rule_id,
            order_key=order_key,
            predicate_result=predicate_result,  # type: ignore[arg-type]
            branch_assumption=branch_assumption,  # type: ignore[arg-type]
            evidence_refs=[rule_ref],
        )

    @classmethod
    def _rule_terminal(
        cls,
        rule_id: uuid.UUID,
        transform: NATTransform,
        packet_before: PacketState,
        steps: tuple[NATRuleEvaluationStep, ...],
        evidence: tuple[EvidenceRef, ...],
    ) -> _Branch:
        return _Branch(
            steps=steps,
            terminal_source="RULE",
            terminal_rule_id=rule_id,
            selected_transform=transform,
            packet_after=apply_nat_transform(transform, packet_before),
            evidence_refs=tuple(cls._dedupe(list(evidence))),
        )

    @staticmethod
    def _packet_key(packet: PacketState) -> str:
        return packet.model_dump_json()

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
