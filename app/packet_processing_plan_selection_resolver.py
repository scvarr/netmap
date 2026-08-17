import uuid
from dataclasses import dataclass

from app.processing_scopes import evaluate_processing_scope
from app.repository import CanonicalRepository
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    PacketProcessingPlanAttachmentEvaluation,
    PacketProcessingPlanSelectionArtifact,
    PacketProcessingPlanSelectionGap,
    PacketProcessingPlanSelectionQuery,
)


@dataclass(frozen=True)
class _ScopeContext:
    traffic_class: str
    routing_context_id: uuid.UUID
    ingress_network_interface_id: uuid.UUID | None
    ingress_l3_binding_id: uuid.UUID | None
    egress_network_interface_id: uuid.UUID | None = None
    egress_l3_binding_id: uuid.UUID | None = None


class PacketProcessingPlanSelectionResolver:
    VERSION = "packet-processing-plan-selection/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self, query: PacketProcessingPlanSelectionQuery, view: EvaluationView
    ) -> PacketProcessingPlanSelectionArtifact:
        self.repository.validate_routing_policy_evaluation_context(
            routing_context_id=query.routing_context_id,
            ingress_network_interface_id=query.ingress_network_interface_id,
            ingress_l3_binding_id=query.ingress_l3_binding_id,
        )
        attachment_set = self.repository.get_packet_processing_plan_attachment_set(
            query.routing_context_id, query.traffic_class
        )
        if attachment_set is None:
            gap = PacketProcessingPlanSelectionGap(
                code="PLAN_ATTACHMENT_SET_UNKNOWN", evidence_refs=[]
            )
            return PacketProcessingPlanSelectionArtifact(
                query=query,
                evaluation_view=view,
                result="UNKNOWN",
                attachment_evaluations=[],
                evidence_refs=[],
                gaps=[gap],
                warnings=[],
            )

        set_ref = self._ref(
            "PacketProcessingPlanAttachmentSet", attachment_set.attachment_set_id
        )
        context = _ScopeContext(
            traffic_class=query.traffic_class,
            routing_context_id=query.routing_context_id,
            ingress_network_interface_id=query.ingress_network_interface_id,
            ingress_l3_binding_id=query.ingress_l3_binding_id,
        )
        evaluations: list[PacketProcessingPlanAttachmentEvaluation] = []
        true_items = []
        unknown_items = []
        for attachment in attachment_set.attachments:
            evaluated = evaluate_processing_scope(attachment.scope, context)
            refs = [
                self._ref("PacketProcessingPlanAttachment", attachment.attachment_id),
                self._ref("PacketProcessingPlan", attachment.plan_id),
                *[self._ref(entity_type, entity_id) for entity_type, entity_id in evaluated.canonical_refs],
            ]
            evaluations.append(
                PacketProcessingPlanAttachmentEvaluation(
                    attachment_id=attachment.attachment_id,
                    plan_id=attachment.plan_id,
                    scope=attachment.scope,
                    applicability=evaluated.applicability,  # type: ignore[arg-type]
                    evidence_refs=self._dedupe(refs),
                )
            )
            if evaluated.applicability == "TRUE":
                true_items.append((attachment, refs))
            elif evaluated.applicability == "UNKNOWN":
                unknown_items.append((attachment, refs))

        definite_plans = {item.plan_id for item, _refs in true_items}
        gaps: list[PacketProcessingPlanSelectionGap] = []
        result = "UNKNOWN"
        selected_plan_id = None
        selected_completeness = None
        relevant = []

        if len(definite_plans) >= 2:
            result = "CONFLICTING"
            relevant = [ref for _item, refs in true_items for ref in refs]
            gaps.append(PacketProcessingPlanSelectionGap(code="PLAN_SELECTION_CONFLICT", evidence_refs=self._dedupe(relevant)))
        elif attachment_set.configured_completeness != "COMPLETE":
            relevant = [ref for _item, refs in [*true_items, *unknown_items] for ref in refs]
            gaps.append(PacketProcessingPlanSelectionGap(code="PLAN_ATTACHMENT_COVERAGE_INCOMPLETE", evidence_refs=[set_ref]))
        elif len(definite_plans) == 1:
            candidate = next(iter(definite_plans))
            unknown_plans = {item.plan_id for item, _refs in unknown_items}
            relevant = [ref for _item, refs in [*true_items, *unknown_items] for ref in refs]
            if unknown_plans <= {candidate}:
                plan = self.repository.get_packet_processing_plan(candidate)
                result = "PLAN_SELECTED"
                selected_plan_id = candidate
                selected_completeness = plan.configured_completeness
            else:
                gaps.append(PacketProcessingPlanSelectionGap(code="PLAN_ATTACHMENT_APPLICABILITY_UNKNOWN", evidence_refs=self._dedupe([ref for _item, refs in unknown_items for ref in refs])))
        elif unknown_items:
            relevant = [ref for _item, refs in unknown_items for ref in refs]
            gaps.append(PacketProcessingPlanSelectionGap(code="PLAN_ATTACHMENT_APPLICABILITY_UNKNOWN", evidence_refs=self._dedupe(relevant)))
        else:
            result = "NO_PLAN_CONFIRMED"

        if unknown_items and not any(gap.code == "PLAN_ATTACHMENT_APPLICABILITY_UNKNOWN" for gap in gaps):
            gaps.append(PacketProcessingPlanSelectionGap(code="PLAN_ATTACHMENT_APPLICABILITY_UNKNOWN", evidence_refs=self._dedupe([ref for _item, refs in unknown_items for ref in refs])))

        return PacketProcessingPlanSelectionArtifact(
            query=query,
            evaluation_view=view,
            result=result,  # type: ignore[arg-type]
            attachment_set_id=attachment_set.attachment_set_id,
            configured_completeness=attachment_set.configured_completeness,  # type: ignore[arg-type]
            selected_plan_id=selected_plan_id,
            selected_plan_configured_completeness=selected_completeness,  # type: ignore[arg-type]
            attachment_evaluations=evaluations,
            evidence_refs=self._dedupe([set_ref, *relevant]),
            gaps=gaps,
            warnings=[],
        )

    @staticmethod
    def _ref(entity_type: str, entity_id: uuid.UUID) -> EvidenceRef:
        return EvidenceRef(entity_type=entity_type, entity_id=entity_id)  # type: ignore[arg-type]

    @staticmethod
    def _dedupe(refs: list[EvidenceRef]) -> list[EvidenceRef]:
        result = []
        seen = set()
        for ref in refs:
            key = (ref.entity_type, ref.entity_id)
            if key not in seen:
                seen.add(key)
                result.append(ref)
        return result
