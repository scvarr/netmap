import uuid

from app.packet_predicates import PacketPredicateEvaluationContext
from app.processing_scopes import evaluate_processing_scope
from app.repository import CanonicalRepository
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    SecurityAttachmentStageArtifact,
    SecurityAttachmentStageGap,
    SecurityEvaluationContext,
    SecurityPolicyEvaluationQuery,
)
from app.security_resolver import ConfiguredSecurityPolicyResolver


class ConfiguredSecurityAttachmentResolver:
    VERSION = "security-configured-attachment/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository
        self.policy_resolver = ConfiguredSecurityPolicyResolver(repository)

    def resolve(
        self,
        attachment_id: uuid.UUID,
        context: SecurityEvaluationContext,
        view: EvaluationView,
    ) -> SecurityAttachmentStageArtifact:
        self.repository.validate_security_evaluation_context(
            routing_context_id=context.routing_context_id,
            ingress_network_interface_id=context.ingress_network_interface_id,
            egress_network_interface_id=context.egress_network_interface_id,
            ingress_l3_binding_id=context.ingress_l3_binding_id,
            egress_l3_binding_id=context.egress_l3_binding_id,
        )
        attachment = self.repository.get_security_policy_attachment(attachment_id)
        attachment_ref = self._ref(
            "SecurityPolicyAttachment", attachment.attachment_id
        )
        scope_evaluation = evaluate_processing_scope(attachment.scope, context)
        scope_refs = [
            self._ref(entity_type, entity_id)
            for entity_type, entity_id in scope_evaluation.canonical_refs
        ]
        evidence = self._dedupe([attachment_ref, *scope_refs])
        policy_evaluation = None
        gaps: list[SecurityAttachmentStageGap] = []

        if scope_evaluation.applicability == "FALSE":
            result = "PASS"
            reason = "ATTACHMENT_NOT_APPLICABLE"
        else:
            policy_evaluation = self.policy_resolver.resolve_with_predicate_context(
                SecurityPolicyEvaluationQuery(
                    policy_id=attachment.policy_id,
                    packet_state=context.packet_state,
                ),
                view,
                PacketPredicateEvaluationContext(
                    packet_state=context.packet_state,
                    connection_state=context.connection_state,
                ),
            )
            evidence = self._dedupe(
                [*evidence, *policy_evaluation.evidence_refs]
            )
            if scope_evaluation.applicability == "TRUE":
                result, reason = self._definite_policy_result(
                    policy_evaluation.result
                )
            else:
                gaps.append(
                    SecurityAttachmentStageGap(
                        code="SECURITY_ATTACHMENT_APPLICABILITY_UNKNOWN",
                        evidence_refs=[attachment_ref],
                    )
                )
                if policy_evaluation.result == "PERMIT":
                    result = "PASS"
                    reason = "ATTACHMENT_APPLICABILITY_COLLAPSED_PERMIT"
                else:
                    result = "UNKNOWN"
                    reason = "SECURITY_UNCERTAINTY"

            if policy_evaluation.result == "UNKNOWN":
                gaps.append(
                    SecurityAttachmentStageGap(
                        code="SECURITY_POLICY_EVALUATION_UNKNOWN",
                        evidence_refs=policy_evaluation.evidence_refs,
                    )
                )

        return SecurityAttachmentStageArtifact(
            evaluation_view=view,
            context=context,
            attachment_id=attachment.attachment_id,
            policy_id=attachment.policy_id,
            stage_order=attachment.stage_order,
            scope=attachment.scope,
            applicability=scope_evaluation.applicability,  # type: ignore[arg-type]
            result=result,  # type: ignore[arg-type]
            reason=reason,  # type: ignore[arg-type]
            policy_evaluation=policy_evaluation,
            evidence_refs=evidence,
            gaps=gaps,
            warnings=[],
        )

    @staticmethod
    def _definite_policy_result(policy_result: str) -> tuple[str, str]:
        return {
            "PERMIT": ("PASS", "POLICY_PERMIT"),
            "DROP": ("BLOCKED", "POLICY_DROP"),
            "REJECT": ("BLOCKED", "POLICY_REJECT"),
            "UNKNOWN": ("UNKNOWN", "SECURITY_UNCERTAINTY"),
        }[policy_result]

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
