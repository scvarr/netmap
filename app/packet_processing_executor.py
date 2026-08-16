import uuid
from dataclasses import dataclass, replace

from app.errors import ModelError, ValidationError
from app.next_hop_resolver import SelectedTableNextHopResolver
from app.packet_processing_plan import (
    PacketProcessingPlanRecord,
    ProcessingStageRecord,
    ProcessingTransitionRecord,
)
from app.repository import CanonicalRepository
from app.routing_policy_resolver import ConfiguredRoutingPolicyResolver
from app.security_attachment_resolver import ConfiguredSecurityAttachmentResolver
from app.schemas import (
    ConnectionState,
    DirectEgressState,
    EvaluationView,
    EvidenceRef,
    NextHopResolutionArtifact,
    NextHopResolutionBranch,
    NextHopResolutionQuery,
    PacketProcessingEvaluationArtifact,
    PacketProcessingEvaluationQuery,
    PacketProcessingExecutionBranch,
    PacketProcessingExecutionGap,
    PacketProcessingFlowState,
    PacketProcessingStageExecution,
    PacketState,
    RoutingPolicyEvaluationQuery,
    SecurityAttachmentStageArtifact,
    SecurityEvaluationContext,
)


_NEXT_HOP_OUTCOMES = {
    "RESOLVED": "FORWARD",
    "LOCAL_TERMINAL": "LOCAL",
    "DISCARD": "DISCARD",
    "NO_ROUTE": "NO_ROUTE",
    "UNKNOWN": "UNKNOWN",
    "CONFLICTING": "CONFLICTING",
    "LOOP_DETECTED": "UNKNOWN",
}
_EXECUTABLE_STAGE_KINDS = {
    "ROUTING_POLICY",
    "ROUTE_DECISION",
    "SECURITY",
    "TERMINATE",
}


@dataclass(frozen=True)
class FlowExecutionState:
    original_packet_state: PacketState
    current_packet_state: PacketState
    routing_context_id: uuid.UUID
    traffic_class: str
    ingress_network_interface_id: uuid.UUID | None
    ingress_l3_binding_id: uuid.UUID | None
    selected_routing_table_id: uuid.UUID | None
    current_route_resolution_branch: NextHopResolutionBranch | None
    direct_egress: DirectEgressState | None
    current_stage_id: uuid.UUID
    connection_state: ConnectionState | None = None


@dataclass(frozen=True)
class _ExecutionBranch:
    initial_state: FlowExecutionState
    state: FlowExecutionState
    stage_executions: tuple[PacketProcessingStageExecution, ...]
    terminal_outcome: str
    evidence_refs: tuple[EvidenceRef, ...]


class PacketProcessingPlanExecutor:
    VERSION = "packet-processing-routing-security/1.1"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository
        self.routing_policy = ConfiguredRoutingPolicyResolver(repository)
        self.next_hop = SelectedTableNextHopResolver(repository)
        self.security_attachment = ConfiguredSecurityAttachmentResolver(repository)

    def resolve(
        self,
        query: PacketProcessingEvaluationQuery,
        view: EvaluationView,
    ) -> PacketProcessingEvaluationArtifact:
        self.repository.validate_routing_policy_evaluation_context(
            routing_context_id=query.routing_context_id,
            ingress_network_interface_id=query.ingress_network_interface_id,
            ingress_l3_binding_id=query.ingress_l3_binding_id,
        )
        plan = self.repository.get_packet_processing_plan(query.plan_id)
        entry = next(
            (
                candidate
                for candidate in plan.entry_points
                if candidate.traffic_class == query.traffic_class
            ),
            None,
        )
        if entry is None:
            raise ValidationError(
                "PacketProcessingPlan has no entry for requested traffic class",
                {
                    "reason": "PROCESSING_ENTRY_UNAVAILABLE",
                    "packet_processing_plan_id": str(plan.plan_id),
                    "traffic_class": query.traffic_class,
                },
            )
        plan_ref = self._ref("PacketProcessingPlan", plan.plan_id)
        entry_ref = self._ref("ProcessingEntryPoint", entry.entry_point_id)
        base_refs = [plan_ref, entry_ref]
        if plan.configured_completeness != "COMPLETE":
            gap = PacketProcessingExecutionGap(
                code="PROCESSING_PLAN_INCOMPLETE",
                evidence_refs=[plan_ref],
            )
            return PacketProcessingEvaluationArtifact(
                query=query,
                evaluation_view=view,
                result="UNKNOWN",
                plan_id=plan.plan_id,
                configured_completeness=plan.configured_completeness,  # type: ignore[arg-type]
                original_packet_state=query.packet_state,
                branches=[],
                evidence_refs=base_refs,
                gaps=[gap],
                warnings=[],
            )

        unsupported = next(
            (
                stage
                for stage in plan.stages
                if stage.kind not in _EXECUTABLE_STAGE_KINDS
            ),
            None,
        )
        if unsupported is not None:
            raise ValidationError(
                "ProcessingStage kind is unsupported by this executor",
                {
                    "reason": "PACKET_PROCESSING_STAGE_UNSUPPORTED_BY_EXECUTOR",
                    "packet_processing_plan_id": str(plan.plan_id),
                    "processing_stage_id": str(unsupported.stage_id),
                    "stage_kind": unsupported.kind,
                    "executor_version": self.VERSION,
                },
            )

        stages = {stage.stage_id: stage for stage in plan.stages}
        transitions = {
            (transition.from_stage_id, transition.outcome): transition
            for transition in plan.transitions
        }
        initial = FlowExecutionState(
            original_packet_state=query.packet_state,
            current_packet_state=query.packet_state,
            routing_context_id=query.routing_context_id,
            traffic_class=query.traffic_class,
            ingress_network_interface_id=query.ingress_network_interface_id,
            ingress_l3_binding_id=query.ingress_l3_binding_id,
            selected_routing_table_id=None,
            current_route_resolution_branch=None,
            direct_egress=None,
            current_stage_id=entry.stage_id,
            connection_state=query.connection_state,
        )
        completed = self._execute(
            plan,
            stages,
            transitions,
            initial,
            initial,
            (),
            tuple(base_refs),
            view,
        )
        branches = [
            PacketProcessingExecutionBranch(
                branch_id=f"packet-processing-branch-{index}",
                initial_state=self._state_schema(branch.initial_state),
                stage_executions=list(branch.stage_executions),
                final_state=self._state_schema(branch.state),
                terminal_outcome=branch.terminal_outcome,  # type: ignore[arg-type]
                evidence_refs=list(branch.evidence_refs),
            )
            for index, branch in enumerate(completed, start=1)
        ]
        terminal_outcomes = {branch.terminal_outcome for branch in completed}
        result = (
            next(iter(terminal_outcomes))
            if len(terminal_outcomes) == 1
            else "UNKNOWN"
        )
        gaps = self._dedupe_gaps(
            [
                gap
                for branch in branches
                for execution in branch.stage_executions
                for gap in execution.gaps
            ]
        )
        return PacketProcessingEvaluationArtifact(
            query=query,
            evaluation_view=view,
            result=result,  # type: ignore[arg-type]
            plan_id=plan.plan_id,
            configured_completeness="COMPLETE",
            original_packet_state=query.packet_state,
            branches=branches,
            evidence_refs=self._dedupe(
                [ref for branch in branches for ref in branch.evidence_refs]
            ),
            gaps=gaps,
            warnings=[],
        )

    def _execute(
        self,
        plan: PacketProcessingPlanRecord,
        stages: dict[uuid.UUID, ProcessingStageRecord],
        transitions: dict[tuple[uuid.UUID, str], ProcessingTransitionRecord],
        initial: FlowExecutionState,
        state: FlowExecutionState,
        executions: tuple[PacketProcessingStageExecution, ...],
        evidence: tuple[EvidenceRef, ...],
        view: EvaluationView,
    ) -> list[_ExecutionBranch]:
        stage = stages[state.current_stage_id]
        stage_ref = self._ref("ProcessingStage", stage.stage_id)
        if stage.kind == "TERMINATE":
            terminal_outcome = stage.payload["outcome"]
            stage_evidence = self._dedupe([stage_ref])
            execution = self._stage_execution(
                stage,
                state,
                state,
                terminal_outcome,
                None,
                stage_evidence,
            )
            return [
                _ExecutionBranch(
                    initial_state=initial,
                    state=state,
                    stage_executions=executions + (execution,),
                    terminal_outcome=terminal_outcome,
                    evidence_refs=tuple(
                        self._dedupe([*evidence, *stage_evidence])
                    ),
                )
            ]

        if stage.kind == "ROUTING_POLICY":
            policy_artifact = self.routing_policy.resolve(
                RoutingPolicyEvaluationQuery(
                    policy_id=uuid.UUID(stage.payload["policy_id"]),
                    routing_context_id=state.routing_context_id,
                    packet_state=state.current_packet_state,
                    traffic_class=state.traffic_class,  # type: ignore[arg-type]
                    ingress_network_interface_id=state.ingress_network_interface_id,
                    ingress_l3_binding_id=state.ingress_l3_binding_id,
                ),
                view,
            )
            outcome = policy_artifact.result
            selected_table = (
                policy_artifact.selected_routing_table_id
                if outcome == "TABLE_SELECTED"
                else None
            )
            updated = replace(state, selected_routing_table_id=selected_table)
            transition = self._transition(stage, outcome, transitions)
            next_state = replace(updated, current_stage_id=transition.to_stage_id)
            refs = self._dedupe(
                [
                    stage_ref,
                    *policy_artifact.evidence_refs,
                    self._ref("ProcessingTransition", transition.transition_id),
                ]
            )
            execution = self._stage_execution(
                stage,
                state,
                updated,
                outcome,
                transition,
                refs,
                routing_policy_evaluation=policy_artifact,
            )
            return self._execute(
                plan,
                stages,
                transitions,
                initial,
                next_state,
                executions + (execution,),
                tuple(self._dedupe([*evidence, *refs])),
                view,
            )

        if stage.kind == "SECURITY":
            egress_l3_binding_id = (
                state.direct_egress.egress_l3_binding_id
                if state.direct_egress is not None
                else None
            )
            egress_network_interface_id = None
            if egress_l3_binding_id is not None:
                egress_attachment = self.repository.get_l3_binding_attachment(
                    egress_l3_binding_id
                )
                egress_network_interface_id = (
                    egress_attachment.network_interface_id
                )
            security_artifact = self.security_attachment.resolve(
                uuid.UUID(stage.payload["attachment_id"]),
                SecurityEvaluationContext(
                    packet_state=state.current_packet_state,
                    traffic_class=state.traffic_class,  # type: ignore[arg-type]
                    routing_context_id=state.routing_context_id,
                    ingress_network_interface_id=(
                        state.ingress_network_interface_id
                    ),
                    egress_network_interface_id=egress_network_interface_id,
                    ingress_l3_binding_id=state.ingress_l3_binding_id,
                    egress_l3_binding_id=egress_l3_binding_id,
                    connection_state=state.connection_state,  # type: ignore[arg-type]
                ),
                view,
            )
            outcome = security_artifact.result
            transition = self._transition(stage, outcome, transitions)
            next_state = replace(state, current_stage_id=transition.to_stage_id)
            refs = self._dedupe(
                [
                    stage_ref,
                    *security_artifact.evidence_refs,
                    self._ref("ProcessingTransition", transition.transition_id),
                ]
            )
            gaps = []
            if outcome == "UNKNOWN":
                gaps.append(
                    PacketProcessingExecutionGap(
                        code="SECURITY_STAGE_UNKNOWN",
                        stage_id=stage.stage_id,
                        evidence_refs=security_artifact.evidence_refs,
                    )
                )
            execution = self._stage_execution(
                stage,
                state,
                state,
                outcome,
                transition,
                refs,
                direct_egress=state.direct_egress,
                security_attachment_evaluation=security_artifact,
                gaps=gaps,
            )
            return self._execute(
                plan,
                stages,
                transitions,
                initial,
                next_state,
                executions + (execution,),
                tuple(self._dedupe([*evidence, *refs])),
                view,
            )

        if stage.kind != "ROUTE_DECISION":
            raise AssertionError("executor capability validation missed stage kind")
        if (
            state.selected_routing_table_id is None
            or state.current_packet_state.destination_ip is None
        ):
            outcome = "UNKNOWN"
            transition = self._transition(stage, outcome, transitions)
            updated = replace(
                state,
                current_route_resolution_branch=None,
                direct_egress=None,
            )
            next_state = replace(updated, current_stage_id=transition.to_stage_id)
            refs = self._dedupe(
                [stage_ref, self._ref("ProcessingTransition", transition.transition_id)]
            )
            gap = PacketProcessingExecutionGap(
                code="STAGE_PRECONDITION_UNKNOWN",
                stage_id=stage.stage_id,
                evidence_refs=[stage_ref],
            )
            execution = self._stage_execution(
                stage,
                state,
                updated,
                outcome,
                transition,
                refs,
                gaps=[gap],
            )
            return self._execute(
                plan,
                stages,
                transitions,
                initial,
                next_state,
                executions + (execution,),
                tuple(self._dedupe([*evidence, *refs])),
                view,
            )

        next_hop_artifact = self.next_hop.resolve(
            NextHopResolutionQuery(
                routing_context_id=state.routing_context_id,
                routing_table_id=state.selected_routing_table_id,
                destination_ip=state.current_packet_state.destination_ip,
            ),
            view,
        )
        results: list[_ExecutionBranch] = []
        for branch_index, resolution_branch in enumerate(
            next_hop_artifact.branches
        ):
            outcome = _NEXT_HOP_OUTCOMES[resolution_branch.outcome]
            transition = self._transition(stage, outcome, transitions)
            traffic_class = (
                "LOCAL_INPUT" if outcome == "LOCAL" else state.traffic_class
            )
            updated = replace(
                state,
                traffic_class=traffic_class,
                current_route_resolution_branch=resolution_branch,
                direct_egress=resolution_branch.direct_egress,
            )
            next_state = replace(updated, current_stage_id=transition.to_stage_id)
            refs = self._dedupe(
                [
                    stage_ref,
                    *resolution_branch.evidence_refs,
                    self._ref("ProcessingTransition", transition.transition_id),
                ]
            )
            gaps = []
            if resolution_branch.outcome == "LOOP_DETECTED":
                gaps.append(
                    PacketProcessingExecutionGap(
                        code="NEXT_HOP_RESOLUTION_LOOP",
                        stage_id=stage.stage_id,
                        evidence_refs=resolution_branch.evidence_refs,
                    )
                )
            execution = self._stage_execution(
                stage,
                state,
                updated,
                outcome,
                transition,
                refs,
                next_hop_resolution=next_hop_artifact,
                selected_next_hop_branch_index=branch_index,
                direct_egress=resolution_branch.direct_egress,
                gaps=gaps,
            )
            results.extend(
                self._execute(
                    plan,
                    stages,
                    transitions,
                    initial,
                    next_state,
                    executions + (execution,),
                    tuple(self._dedupe([*evidence, *refs])),
                    view,
                )
            )
        return results

    @staticmethod
    def _transition(
        stage: ProcessingStageRecord,
        outcome: str,
        transitions: dict[tuple[uuid.UUID, str], ProcessingTransitionRecord],
    ) -> ProcessingTransitionRecord:
        transition = transitions.get((stage.stage_id, outcome))
        if transition is None:
            raise ModelError(
                "Complete PacketProcessingPlan has no transition for stage outcome",
                {"processing_stage_id": str(stage.stage_id), "outcome": outcome},
            )
        return transition

    @staticmethod
    def _stage_execution(
        stage: ProcessingStageRecord,
        before: FlowExecutionState,
        after: FlowExecutionState,
        outcome: str,
        transition: ProcessingTransitionRecord | None,
        evidence_refs: list[EvidenceRef],
        *,
        routing_policy_evaluation=None,
        next_hop_resolution: NextHopResolutionArtifact | None = None,
        selected_next_hop_branch_index: int | None = None,
        direct_egress: DirectEgressState | None = None,
        security_attachment_evaluation: SecurityAttachmentStageArtifact | None = None,
        gaps: list[PacketProcessingExecutionGap] | None = None,
    ) -> PacketProcessingStageExecution:
        return PacketProcessingStageExecution(
            stage_id=stage.stage_id,
            stage_kind=stage.kind,  # type: ignore[arg-type]
            packet_before=before.current_packet_state,
            packet_after=after.current_packet_state,
            traffic_class_before=before.traffic_class,  # type: ignore[arg-type]
            traffic_class_after=after.traffic_class,  # type: ignore[arg-type]
            selected_routing_table_id_before=before.selected_routing_table_id,
            selected_routing_table_id_after=after.selected_routing_table_id,
            stage_outcome=outcome,
            transition_id=(transition.transition_id if transition else None),
            next_stage_id=(transition.to_stage_id if transition else None),
            routing_policy_evaluation=routing_policy_evaluation,
            next_hop_resolution=next_hop_resolution,
            selected_next_hop_branch_index=selected_next_hop_branch_index,
            direct_egress=direct_egress,
            security_attachment_evaluation=security_attachment_evaluation,
            evidence_refs=evidence_refs,
            gaps=gaps or [],
        )

    @staticmethod
    def _state_schema(state: FlowExecutionState) -> PacketProcessingFlowState:
        return PacketProcessingFlowState(
            original_packet_state=state.original_packet_state,
            current_packet_state=state.current_packet_state,
            routing_context_id=state.routing_context_id,
            traffic_class=state.traffic_class,  # type: ignore[arg-type]
            ingress_network_interface_id=state.ingress_network_interface_id,
            ingress_l3_binding_id=state.ingress_l3_binding_id,
            connection_state=state.connection_state,  # type: ignore[arg-type]
            selected_routing_table_id=state.selected_routing_table_id,
            current_route_resolution_branch=state.current_route_resolution_branch,
            direct_egress=state.direct_egress,
            current_stage_id=state.current_stage_id,
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

    @staticmethod
    def _dedupe_gaps(
        gaps: list[PacketProcessingExecutionGap],
    ) -> list[PacketProcessingExecutionGap]:
        result: list[PacketProcessingExecutionGap] = []
        seen: set[tuple[str, uuid.UUID | None]] = set()
        for gap in gaps:
            key = (gap.code, gap.stage_id)
            if key not in seen:
                seen.add(key)
                result.append(gap)
        return result
