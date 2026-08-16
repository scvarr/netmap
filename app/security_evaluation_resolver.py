import uuid

from app.repository import CanonicalRepository, SecurityPolicyAttachmentRecord
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    SecurityAttachmentEvaluation,
    SecurityEvaluationArtifact,
    SecurityEvaluationContext,
    SecurityEvaluationQuery,
    SecurityPolicyEvaluationQuery,
    SecurityStageEvaluationGap,
)
from app.security_resolver import ConfiguredSecurityPolicyResolver
from app.security_scopes import SCOPE_ENTITY_TYPES


class ConfiguredSecurityEvaluationResolver:
    VERSION = "security-configured-stages/1.0"

    _CONTEXT_FIELDS = {
        "traffic_classes": "traffic_class",
        "routing_context_ids": "routing_context_id",
        "ingress_network_interface_ids": "ingress_network_interface_id",
        "egress_network_interface_ids": "egress_network_interface_id",
        "ingress_l3_binding_ids": "ingress_l3_binding_id",
        "egress_l3_binding_ids": "egress_l3_binding_id",
    }

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository
        self.policy_resolver = ConfiguredSecurityPolicyResolver(repository)

    def resolve(
        self, query: SecurityEvaluationQuery, view: EvaluationView
    ) -> SecurityEvaluationArtifact:
        context = query.context
        self.repository.validate_security_evaluation_context(
            routing_context_id=context.routing_context_id,
            ingress_network_interface_id=context.ingress_network_interface_id,
            egress_network_interface_id=context.egress_network_interface_id,
            ingress_l3_binding_id=context.ingress_l3_binding_id,
            egress_l3_binding_id=context.egress_l3_binding_id,
        )

        evaluations: list[SecurityAttachmentEvaluation] = []
        gaps: list[SecurityStageEvaluationGap] = []
        definite_blocks: list[str] = []
        unresolved = query.configured_attachment_completeness != "COMPLETE"
        if unresolved:
            gaps.append(
                SecurityStageEvaluationGap(
                    code="SECURITY_ATTACHMENT_COVERAGE_INCOMPLETE",
                    evidence_refs=[],
                )
            )

        for attachment in self.repository.get_security_policy_attachments():
            applicability, scope_refs = self._evaluate_scope(attachment, context)
            attachment_ref = self._ref(
                "SecurityPolicyAttachment", attachment.attachment_id
            )
            attachment_refs = self._dedupe([attachment_ref, *scope_refs])
            policy_evaluation = None
            if applicability != "FALSE":
                policy_evaluation = self.policy_resolver.resolve(
                    SecurityPolicyEvaluationQuery(
                        policy_id=attachment.policy_id,
                        packet_state=context.packet_state,
                    ),
                    view,
                )
                attachment_refs = self._dedupe(
                    [*attachment_refs, *policy_evaluation.evidence_refs]
                )

            evaluations.append(
                SecurityAttachmentEvaluation(
                    attachment_id=attachment.attachment_id,
                    policy_id=attachment.policy_id,
                    stage_order=attachment.stage_order,
                    scope=attachment.scope,
                    applicability=applicability,
                    policy_evaluation=policy_evaluation,
                    evidence_refs=attachment_refs,
                )
            )

            if applicability == "UNKNOWN":
                gaps.append(
                    SecurityStageEvaluationGap(
                        code="SECURITY_ATTACHMENT_APPLICABILITY_UNKNOWN",
                        attachment_id=attachment.attachment_id,
                        evidence_refs=[attachment_ref],
                    )
                )
            if policy_evaluation is not None and policy_evaluation.result == "UNKNOWN":
                gaps.append(
                    SecurityStageEvaluationGap(
                        code="SECURITY_POLICY_EVALUATION_UNKNOWN",
                        attachment_id=attachment.attachment_id,
                        evidence_refs=policy_evaluation.evidence_refs,
                    )
                )

            if applicability == "TRUE" and policy_evaluation is not None:
                if policy_evaluation.result in {"DROP", "REJECT"}:
                    definite_blocks.append(policy_evaluation.result)
                elif policy_evaluation.result == "UNKNOWN":
                    unresolved = True
            elif applicability == "UNKNOWN" and policy_evaluation is not None:
                if policy_evaluation.result != "PERMIT":
                    unresolved = True

        if definite_blocks:
            result = "BLOCKED"
            reason = "POLICY_DROP" if "DROP" in definite_blocks else "POLICY_REJECT"
        elif unresolved:
            result = "UNKNOWN"
            reason = "SECURITY_UNCERTAINTY"
        else:
            result = "PASS"
            potentially_applicable = any(
                item.applicability != "FALSE" for item in evaluations
            )
            reason = (
                "ALL_APPLICABLE_POLICIES_PERMIT"
                if potentially_applicable
                else "NO_POLICY_APPLICABLE"
            )

        return SecurityEvaluationArtifact(
            query=query,
            evaluation_view=view,
            context=context,
            configured_attachment_completeness=(
                query.configured_attachment_completeness
            ),
            result=result,  # type: ignore[arg-type]
            reason=reason,  # type: ignore[arg-type]
            attachment_evaluations=evaluations,
            evidence_refs=self._dedupe(
                [ref for item in evaluations for ref in item.evidence_refs]
            ),
            gaps=self._dedupe_gaps(gaps),
            warnings=[],
        )

    def _evaluate_scope(
        self,
        attachment: SecurityPolicyAttachmentRecord,
        context: SecurityEvaluationContext,
    ) -> tuple[str, list[EvidenceRef]]:
        has_unknown = False
        refs: list[EvidenceRef] = []
        for dimension, allowed in attachment.scope.items():
            runtime_value = getattr(context, self._CONTEXT_FIELDS[dimension])
            if runtime_value is None:
                has_unknown = True
                continue
            value = str(runtime_value)
            if dimension in SCOPE_ENTITY_TYPES:
                refs.append(self._ref(SCOPE_ENTITY_TYPES[dimension], runtime_value))
            if value not in allowed:
                return "FALSE", self._dedupe(refs)
        return ("UNKNOWN" if has_unknown else "TRUE"), self._dedupe(refs)

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

    @staticmethod
    def _dedupe_gaps(
        gaps: list[SecurityStageEvaluationGap],
    ) -> list[SecurityStageEvaluationGap]:
        result: list[SecurityStageEvaluationGap] = []
        seen: set[tuple[str, uuid.UUID | None]] = set()
        for gap in gaps:
            key = (gap.code, gap.attachment_id)
            if key not in seen:
                seen.add(key)
                result.append(gap)
        return result
