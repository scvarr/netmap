import uuid
from dataclasses import dataclass

from app.repository import CanonicalRepository, SecurityPolicyRecord
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    SecurityEvaluationBranch,
    SecurityEvaluationGap,
    SecurityPolicyEvaluationArtifact,
    SecurityPolicyEvaluationQuery,
    SecurityRuleEvaluationStep,
)
from app.packet_predicates import (
    PacketPredicateEvaluationContext,
    evaluate_predicate,
)


@dataclass(frozen=True)
class _Branch:
    steps: tuple[SecurityRuleEvaluationStep, ...]
    terminal_action: str
    terminal_source: str
    terminal_rule_id: uuid.UUID | None
    evidence_refs: tuple[EvidenceRef, ...]


class ConfiguredSecurityPolicyResolver:
    VERSION = "security-configured-policy/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self, query: SecurityPolicyEvaluationQuery, view: EvaluationView
    ) -> SecurityPolicyEvaluationArtifact:
        return self.resolve_with_predicate_context(
            query,
            view,
            PacketPredicateEvaluationContext(packet_state=query.packet_state),
        )

    def resolve_with_predicate_context(
        self,
        query: SecurityPolicyEvaluationQuery,
        view: EvaluationView,
        predicate_context: PacketPredicateEvaluationContext,
    ) -> SecurityPolicyEvaluationArtifact:
        policy = self.repository.get_security_policy(query.policy_id)
        policy_ref = self._ref("SecurityPolicy", policy.security_policy_id)
        logical = self._evaluate_rules(
            policy, predicate_context, 0, (), (policy_ref,)
        )
        branches = [
            SecurityEvaluationBranch(
                branch_id=f"security-branch-{index}",
                steps=list(branch.steps),
                terminal_action=branch.terminal_action,  # type: ignore[arg-type]
                terminal_source=branch.terminal_source,  # type: ignore[arg-type]
                terminal_rule_id=branch.terminal_rule_id,
                evidence_refs=list(branch.evidence_refs),
            )
            for index, branch in enumerate(logical, start=1)
        ]
        if policy.configured_completeness != "COMPLETE":
            result = "UNKNOWN"
            gaps = [
                SecurityEvaluationGap(
                    code="SECURITY_POLICY_INCOMPLETE",
                    evidence_refs=[policy_ref],
                )
            ]
        else:
            actions = {branch.terminal_action for branch in logical}
            result = next(iter(actions)) if len(actions) == 1 else "UNKNOWN"
            gaps = []
        return SecurityPolicyEvaluationArtifact(
            query=query,
            evaluation_view=view,
            result=result,  # type: ignore[arg-type]
            policy_id=policy.security_policy_id,
            default_action=policy.default_action,  # type: ignore[arg-type]
            configured_completeness=policy.configured_completeness,  # type: ignore[arg-type]
            branches=branches,
            evidence_refs=self._dedupe(
                [ref for branch in branches for ref in branch.evidence_refs]
            ),
            gaps=gaps,
            warnings=[],
        )

    def _evaluate_rules(
        self,
        policy: SecurityPolicyRecord,
        predicate_context: PacketPredicateEvaluationContext,
        index: int,
        steps: tuple[SecurityRuleEvaluationStep, ...],
        evidence: tuple[EvidenceRef, ...],
    ) -> list[_Branch]:
        if index == len(policy.rules):
            return [
                _Branch(
                    steps=steps,
                    terminal_action=policy.default_action,
                    terminal_source="DEFAULT",
                    terminal_rule_id=None,
                    evidence_refs=tuple(self._dedupe(list(evidence))),
                )
            ]

        rule = policy.rules[index]
        result = evaluate_predicate(rule.predicate, predicate_context)
        rule_ref = self._ref("SecurityRule", rule.security_rule_id)
        next_evidence = evidence + (rule_ref,)
        if result == "TRUE":
            step = SecurityRuleEvaluationStep(
                rule_id=rule.security_rule_id,
                order_key=rule.order_key,
                predicate_result=result,
                branch_assumption="MATCH",
                evidence_refs=[rule_ref],
            )
            return [
                self._rule_terminal(
                    rule.action,
                    rule.security_rule_id,
                    steps + (step,),
                    next_evidence,
                )
            ]
        if result == "FALSE":
            step = SecurityRuleEvaluationStep(
                rule_id=rule.security_rule_id,
                order_key=rule.order_key,
                predicate_result=result,
                branch_assumption="NO_MATCH",
                evidence_refs=[rule_ref],
            )
            return self._evaluate_rules(
                policy,
                predicate_context,
                index + 1,
                steps + (step,),
                next_evidence,
            )

        match_step = SecurityRuleEvaluationStep(
            rule_id=rule.security_rule_id,
            order_key=rule.order_key,
            predicate_result="UNKNOWN",
            branch_assumption="MATCH",
            evidence_refs=[rule_ref],
        )
        no_match_step = match_step.model_copy(
            update={"branch_assumption": "NO_MATCH"}
        )
        return [
            self._rule_terminal(
                rule.action,
                rule.security_rule_id,
                steps + (match_step,),
                next_evidence,
            ),
            *self._evaluate_rules(
                policy,
                predicate_context,
                index + 1,
                steps + (no_match_step,),
                next_evidence,
            ),
        ]

    @classmethod
    def _rule_terminal(
        cls,
        action: str,
        rule_id: uuid.UUID,
        steps: tuple[SecurityRuleEvaluationStep, ...],
        evidence: tuple[EvidenceRef, ...],
    ) -> _Branch:
        return _Branch(
            steps=steps,
            terminal_action=action,
            terminal_source="RULE",
            terminal_rule_id=rule_id,
            evidence_refs=tuple(cls._dedupe(list(evidence))),
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
