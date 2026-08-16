import uuid

from app.nat_resolver import ConfiguredNATPolicyResolver
from app.packet_predicates import PacketPredicateEvaluationContext
from app.processing_scopes import evaluate_processing_scope
from app.repository import CanonicalRepository
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    NATAttachmentStageArtifact,
    NATAttachmentStageGap,
    NATEvaluationContext,
    NATPolicyEvaluationQuery,
)


class ConfiguredNATAttachmentResolver:
    VERSION = "nat-configured-attachment/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository
        self.policy_resolver = ConfiguredNATPolicyResolver(repository)

    def resolve(
        self,
        attachment_id: uuid.UUID,
        context: NATEvaluationContext,
        view: EvaluationView,
    ) -> NATAttachmentStageArtifact:
        self.repository.validate_processing_evaluation_context(
            routing_context_id=context.routing_context_id,
            ingress_network_interface_id=context.ingress_network_interface_id,
            egress_network_interface_id=context.egress_network_interface_id,
            ingress_l3_binding_id=context.ingress_l3_binding_id,
            egress_l3_binding_id=context.egress_l3_binding_id,
        )
        attachment = self.repository.get_nat_policy_attachment(attachment_id)
        attachment_ref = self._ref("NATPolicyAttachment", attachment.attachment_id)
        scope_evaluation = evaluate_processing_scope(attachment.scope, context)
        scope_refs = [
            self._ref(entity_type, entity_id)
            for entity_type, entity_id in scope_evaluation.canonical_refs
        ]
        evidence = self._dedupe([attachment_ref, *scope_refs])
        policy_evaluation = None
        gaps: list[NATAttachmentStageGap] = []

        if scope_evaluation.applicability == "FALSE":
            result = "IDENTITY"
            reason = "ATTACHMENT_NOT_APPLICABLE"
            packet_after = context.packet_state
            packet_after_constraint = None
        else:
            policy_evaluation = self.policy_resolver.resolve_with_predicate_context(
                NATPolicyEvaluationQuery(
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
                result = policy_evaluation.result
                packet_after = policy_evaluation.packet_after
                packet_after_constraint = policy_evaluation.packet_after_constraint
                reason = {
                    "IDENTITY": "POLICY_IDENTITY",
                    "TRANSFORMED_EXACT": "POLICY_TRANSFORMED_EXACT",
                    "TRANSFORMED_CONSTRAINED": "POLICY_TRANSFORMED_CONSTRAINED",
                    "UNKNOWN": "NAT_UNCERTAINTY",
                }[result]
            else:
                gaps.append(
                    NATAttachmentStageGap(
                        code="NAT_ATTACHMENT_APPLICABILITY_UNKNOWN",
                        evidence_refs=[attachment_ref],
                    )
                )
                exact_same = (
                    policy_evaluation.result == "TRANSFORMED_EXACT"
                    and policy_evaluation.packet_after == context.packet_state
                )
                if policy_evaluation.result == "IDENTITY" or exact_same:
                    result = "IDENTITY"
                    reason = "ATTACHMENT_APPLICABILITY_COLLAPSED_IDENTITY"
                    packet_after = context.packet_state
                    packet_after_constraint = None
                else:
                    result = "UNKNOWN"
                    reason = "NAT_UNCERTAINTY"
                    packet_after = None
                    packet_after_constraint = None
                    gaps.append(
                        NATAttachmentStageGap(
                            code="NAT_TRANSLATION_UNKNOWN",
                            evidence_refs=evidence,
                        )
                    )

            if policy_evaluation.result == "UNKNOWN":
                gaps.append(
                    NATAttachmentStageGap(
                        code="NAT_POLICY_EVALUATION_UNKNOWN",
                        evidence_refs=policy_evaluation.evidence_refs,
                    )
                )

        return NATAttachmentStageArtifact(
            evaluation_view=view,
            context=context,
            attachment_id=attachment.attachment_id,
            policy_id=attachment.policy_id,
            local_stage_order=attachment.local_stage_order,
            scope=attachment.scope,
            applicability=scope_evaluation.applicability,  # type: ignore[arg-type]
            result=result,  # type: ignore[arg-type]
            reason=reason,  # type: ignore[arg-type]
            packet_before=context.packet_state,
            packet_after=packet_after,
            packet_after_constraint=packet_after_constraint,
            policy_evaluation=policy_evaluation,
            evidence_refs=evidence,
            gaps=gaps,
            warnings=[],
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
