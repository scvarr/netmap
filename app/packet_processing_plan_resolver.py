import uuid

from app.repository import CanonicalRepository
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    PacketProcessingPlanValidationArtifact,
    PacketProcessingPlanValidationQuery,
    ProcessingEntryPointArtifact,
    ProcessingStageArtifact,
    ProcessingTransitionArtifact,
)


class PacketProcessingPlanValidationResolver:
    VERSION = "packet-processing-plan-validation/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self,
        query: PacketProcessingPlanValidationQuery,
        view: EvaluationView,
    ) -> PacketProcessingPlanValidationArtifact:
        plan = self.repository.get_packet_processing_plan(query.plan_id)
        refs = [self._ref("PacketProcessingPlan", plan.plan_id)]
        stages = []
        for stage in plan.stages:
            refs.append(self._ref("ProcessingStage", stage.stage_id))
            if stage.payload_reference is not None:
                refs.append(self._ref(*stage.payload_reference))
            stages.append(
                ProcessingStageArtifact(
                    stage_id=stage.stage_id,
                    kind=stage.kind,  # type: ignore[arg-type]
                    payload=stage.payload,
                )
            )
        transitions = [
            ProcessingTransitionArtifact(
                transition_id=transition.transition_id,
                from_stage_id=transition.from_stage_id,
                outcome=transition.outcome,
                to_stage_id=transition.to_stage_id,
            )
            for transition in plan.transitions
        ]
        refs.extend(
            self._ref("ProcessingTransition", transition.transition_id)
            for transition in plan.transitions
        )
        entries = [
            ProcessingEntryPointArtifact(
                entry_point_id=entry.entry_point_id,
                traffic_class=entry.traffic_class,  # type: ignore[arg-type]
                stage_id=entry.stage_id,
            )
            for entry in plan.entry_points
        ]
        refs.extend(
            self._ref("ProcessingEntryPoint", entry.entry_point_id)
            for entry in plan.entry_points
        )
        return PacketProcessingPlanValidationArtifact(
            query=query,
            evaluation_view=view,
            plan_id=plan.plan_id,
            configured_completeness=plan.configured_completeness,  # type: ignore[arg-type]
            entry_points=entries,
            stages=stages,
            transitions=transitions,
            evidence_refs=self._dedupe(refs),
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
