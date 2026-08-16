import uuid
from dataclasses import dataclass

from app.errors import ModelError, ValidationError
from app.processing_stage_payloads import ProcessingStagePayload, STAGE_OUTCOMES


@dataclass(frozen=True)
class ProcessingStageRecord:
    stage_id: uuid.UUID
    plan_id: uuid.UUID
    kind: str
    payload: ProcessingStagePayload
    payload_reference: tuple[str, uuid.UUID] | None


@dataclass(frozen=True)
class ProcessingTransitionRecord:
    transition_id: uuid.UUID
    plan_id: uuid.UUID
    from_stage_id: uuid.UUID
    outcome: str
    to_stage_id: uuid.UUID


@dataclass(frozen=True)
class ProcessingEntryPointRecord:
    entry_point_id: uuid.UUID
    plan_id: uuid.UUID
    traffic_class: str
    stage_id: uuid.UUID


@dataclass(frozen=True)
class PacketProcessingPlanRecord:
    plan_id: uuid.UUID
    configured_completeness: str
    entry_points: tuple[ProcessingEntryPointRecord, ...]
    stages: tuple[ProcessingStageRecord, ...]
    transitions: tuple[ProcessingTransitionRecord, ...]


def validate_packet_processing_plan_graph(
    plan: PacketProcessingPlanRecord, *, model_error: bool
) -> None:
    error_type = ModelError if model_error else ValidationError

    def fail(message: str, **details: object) -> None:
        raise error_type(
            message,
            {"packet_processing_plan_id": str(plan.plan_id), **details},
        )

    stages = {stage.stage_id: stage for stage in plan.stages}
    if not plan.entry_points:
        fail("PacketProcessingPlan must have at least one entry point")

    entry_classes: set[str] = set()
    for entry in plan.entry_points:
        if entry.plan_id != plan.plan_id:
            fail(
                "ProcessingEntryPoint plan_id does not match its plan",
                processing_entry_point_id=str(entry.entry_point_id),
            )
        if entry.traffic_class in entry_classes:
            fail(
                "ProcessingEntryPoint traffic class is duplicated",
                traffic_class=entry.traffic_class,
            )
        entry_classes.add(entry.traffic_class)
        stage = stages.get(entry.stage_id)
        if stage is None or stage.plan_id != plan.plan_id:
            fail(
                "ProcessingEntryPoint references a stage from another plan",
                processing_entry_point_id=str(entry.entry_point_id),
                stage_id=str(entry.stage_id),
            )

    outgoing: dict[uuid.UUID, dict[str, uuid.UUID]] = {
        stage_id: {} for stage_id in stages
    }
    for transition in plan.transitions:
        if transition.plan_id != plan.plan_id:
            fail(
                "ProcessingTransition plan_id does not match its plan",
                processing_transition_id=str(transition.transition_id),
            )
        source = stages.get(transition.from_stage_id)
        target = stages.get(transition.to_stage_id)
        if source is None or target is None:
            fail(
                "ProcessingTransition crosses PacketProcessingPlan boundary",
                processing_transition_id=str(transition.transition_id),
                from_stage_id=str(transition.from_stage_id),
                to_stage_id=str(transition.to_stage_id),
            )
        if transition.outcome not in STAGE_OUTCOMES[source.kind]:
            fail(
                "ProcessingTransition outcome is invalid for source stage kind",
                processing_transition_id=str(transition.transition_id),
                stage_kind=source.kind,
                outcome=transition.outcome,
            )
        if transition.outcome in outgoing[source.stage_id]:
            fail(
                "ProcessingTransition outcome is duplicated for source stage",
                from_stage_id=str(source.stage_id),
                outcome=transition.outcome,
            )
        outgoing[source.stage_id][transition.outcome] = target.stage_id

    for stage in plan.stages:
        if stage.kind == "TERMINATE" and outgoing[stage.stage_id]:
            fail(
                "TERMINATE stage must not have outgoing transitions",
                stage_id=str(stage.stage_id),
            )
        if plan.configured_completeness == "COMPLETE" and stage.kind != "TERMINATE":
            required = set(STAGE_OUTCOMES[stage.kind])
            actual = set(outgoing[stage.stage_id])
            if actual != required:
                fail(
                    "Complete PacketProcessingPlan stage is missing required outcomes",
                    stage_id=str(stage.stage_id),
                    stage_kind=stage.kind,
                    missing_outcomes=sorted(required - actual),
                )

    reachable: set[uuid.UUID] = set()
    active: set[uuid.UUID] = set()
    completed: set[uuid.UUID] = set()

    def visit(stage_id: uuid.UUID) -> None:
        if stage_id in active:
            fail("PacketProcessingPlan must be acyclic", stage_id=str(stage_id))
        if stage_id in completed:
            reachable.add(stage_id)
            return
        active.add(stage_id)
        reachable.add(stage_id)
        for target_id in outgoing[stage_id].values():
            visit(target_id)
        active.remove(stage_id)
        completed.add(stage_id)

    for entry in plan.entry_points:
        visit(entry.stage_id)

    unreachable = sorted(str(stage_id) for stage_id in set(stages) - reachable)
    if unreachable:
        fail(
            "Every ProcessingStage must be reachable from an entry point",
            unreachable_stage_ids=unreachable,
        )

    if plan.configured_completeness == "COMPLETE":
        memo: dict[uuid.UUID, bool] = {}

        def all_paths_terminate(stage_id: uuid.UUID) -> bool:
            if stage_id in memo:
                return memo[stage_id]
            stage = stages[stage_id]
            if stage.kind == "TERMINATE":
                memo[stage_id] = True
                return True
            targets = tuple(outgoing[stage_id].values())
            result = bool(targets) and all(
                all_paths_terminate(target_id) for target_id in targets
            )
            memo[stage_id] = result
            return result

        for entry in plan.entry_points:
            if not all_paths_terminate(entry.stage_id):
                fail(
                    "Every complete PacketProcessingPlan path must reach TERMINATE",
                    processing_entry_point_id=str(entry.entry_point_id),
                )
