import uuid
from dataclasses import dataclass, replace

from app.errors import ModelError, ValidationError
from app.forwarding_adjacency import derive_adjacency_target
from app.nat_attachment_resolver import ConfiguredNATAttachmentResolver
from app.next_hop_resolver import SelectedTableNextHopResolver
from app.packet_processing_plan import (
    PacketProcessingPlanRecord,
    ProcessingStageRecord,
    ProcessingTransitionRecord,
)
from app.packet_constraints import expand_packet_constraint
from app.repository import CanonicalRepository
from app.routing_policy_resolver import ConfiguredRoutingPolicyResolver
from app.security_attachment_resolver import ConfiguredSecurityAttachmentResolver
from app.structural_adjacency_resolver import StructuralAdjacencyProofResolver
from app.schemas import (
    AdjacencyCandidate,
    ConnectionState,
    DirectEgressState,
    EvaluationView,
    EvidenceRef,
    NATAttachmentStageArtifact,
    NATEvaluationContext,
    NATPacketConstraint,
    NextHopResolutionArtifact,
    NextHopResolutionBranch,
    NextHopResolutionQuery,
    PacketProcessingEvaluationArtifact,
    PacketProcessingEvaluationQuery,
    PacketProcessingExecutionBranch,
    PacketProcessingExecutionGap,
    PacketProcessingFlowState,
    PacketProcessingHandoff,
    PacketProcessingLocalDelivery,
    PacketProcessingStageExecution,
    PacketState,
    RoutingPolicyEvaluationQuery,
    SecurityAttachmentStageArtifact,
    SecurityEvaluationContext,
    StructuralAdjacencyArtifact,
    StructuralAdjacencyQuery,
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
    "NAT",
    "ADJACENCY_L2",
    "LOCAL_DELIVERY",
    "TERMINATE",
}


@dataclass(frozen=True, kw_only=True)
class FlowExecutionState:
    original_packet_state: PacketState
    current_packet_state: PacketState | None
    current_packet_constraint: NATPacketConstraint | None = None
    current_packet_unknown: bool = False
    routing_context_id: uuid.UUID
    traffic_class: str
    ingress_network_interface_id: uuid.UUID | None
    ingress_l3_binding_id: uuid.UUID | None
    selected_routing_table_id: uuid.UUID | None
    current_route_resolution_branch: NextHopResolutionBranch | None
    direct_egress: DirectEgressState | None
    current_stage_id: uuid.UUID
    connection_state: ConnectionState | None = None

    def __post_init__(self) -> None:
        active = sum(
            (
                self.current_packet_state is not None,
                self.current_packet_constraint is not None,
                self.current_packet_unknown,
            )
        )
        if active != 1:
            raise ValueError("FlowExecutionState requires one current packet value")


@dataclass(frozen=True)
class _ExecutionBranch:
    initial_state: FlowExecutionState
    state: FlowExecutionState
    stage_executions: tuple[PacketProcessingStageExecution, ...]
    terminal_outcome: str
    evidence_refs: tuple[EvidenceRef, ...]


class PacketProcessingPlanExecutor:
    VERSION = "packet-processing-full-local/1.6"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository
        self.routing_policy = ConfiguredRoutingPolicyResolver(repository)
        self.next_hop = SelectedTableNextHopResolver(repository)
        self.security_attachment = ConfiguredSecurityAttachmentResolver(repository)
        self.nat_attachment = ConfiguredNATAttachmentResolver(repository)
        self.structural_adjacency = StructuralAdjacencyProofResolver(repository)

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
            current_packet_constraint=None,
            current_packet_unknown=False,
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

        if stage.kind == "LOCAL_DELIVERY":
            return self._execute_local_delivery(
                plan,
                stages,
                transitions,
                initial,
                state,
                executions,
                evidence,
                view,
                stage,
                stage_ref,
            )

        if state.current_packet_state is None:
            if state.current_packet_constraint is not None:
                expansion = expand_packet_constraint(
                    state.current_packet_constraint
                )
                if not expansion.limit_exceeded:
                    return [
                        completed_branch
                        for packet in expansion.packets
                        for completed_branch in self._execute(
                            plan,
                            stages,
                            transitions,
                            initial,
                            replace(
                                state,
                                current_packet_state=packet,
                                current_packet_constraint=None,
                                current_packet_unknown=False,
                            ),
                            executions,
                            evidence,
                            view,
                        )
                    ]
            return self._execute_nonexact(
                plan,
                stages,
                transitions,
                initial,
                state,
                executions,
                evidence,
                view,
                stage,
                stage_ref,
                packet_gap_code=(
                    "PACKET_CONSTRAINT_EXPANSION_LIMIT"
                    if state.current_packet_constraint is not None
                    else None
                ),
            )

        if stage.kind == "ADJACENCY_L2":
            return self._execute_adjacency(
                plan,
                stages,
                transitions,
                initial,
                state,
                executions,
                evidence,
                view,
                stage,
                stage_ref,
            )

        if stage.kind == "ROUTING_POLICY":
            assert state.current_packet_state is not None
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
            assert state.current_packet_state is not None
            egress_l3_binding_id, egress_network_interface_id = (
                self._egress_context(state)
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

        if stage.kind == "NAT":
            assert state.current_packet_state is not None
            egress_l3_binding_id, egress_network_interface_id = (
                self._egress_context(state)
            )
            nat_artifact = self.nat_attachment.resolve(
                uuid.UUID(stage.payload["attachment_id"]),
                NATEvaluationContext(
                    packet_state=state.current_packet_state,
                    traffic_class=state.traffic_class,  # type: ignore[arg-type]
                    routing_context_id=state.routing_context_id,
                    ingress_network_interface_id=state.ingress_network_interface_id,
                    egress_network_interface_id=egress_network_interface_id,
                    ingress_l3_binding_id=state.ingress_l3_binding_id,
                    egress_l3_binding_id=egress_l3_binding_id,
                    connection_state=state.connection_state,
                ),
                view,
            )
            outcome = nat_artifact.result
            transition = self._transition(stage, outcome, transitions)
            if outcome in {"IDENTITY", "TRANSFORMED_EXACT"}:
                updated = replace(
                    state,
                    current_packet_state=nat_artifact.packet_after,
                    current_packet_constraint=None,
                    current_packet_unknown=False,
                )
            elif outcome == "TRANSFORMED_CONSTRAINED":
                updated = replace(
                    state,
                    current_packet_state=None,
                    current_packet_constraint=nat_artifact.packet_after_constraint,
                    current_packet_unknown=False,
                )
            else:
                updated = replace(
                    state,
                    current_packet_state=None,
                    current_packet_constraint=None,
                    current_packet_unknown=True,
                )
            next_state = replace(updated, current_stage_id=transition.to_stage_id)
            refs = self._dedupe(
                [
                    stage_ref,
                    *nat_artifact.evidence_refs,
                    self._ref("ProcessingTransition", transition.transition_id),
                ]
            )
            gaps = []
            if outcome == "UNKNOWN":
                gaps.append(
                    PacketProcessingExecutionGap(
                        code="NAT_STAGE_UNKNOWN",
                        stage_id=stage.stage_id,
                        evidence_refs=nat_artifact.evidence_refs,
                    )
                )
            execution = self._stage_execution(
                stage,
                state,
                updated,
                outcome,
                transition,
                refs,
                direct_egress=state.direct_egress,
                nat_attachment_evaluation=nat_artifact,
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

    def _execute_local_delivery(
        self,
        plan: PacketProcessingPlanRecord,
        stages: dict[uuid.UUID, ProcessingStageRecord],
        transitions: dict[tuple[uuid.UUID, str], ProcessingTransitionRecord],
        initial: FlowExecutionState,
        state: FlowExecutionState,
        executions: tuple[PacketProcessingStageExecution, ...],
        evidence: tuple[EvidenceRef, ...],
        view: EvaluationView,
        stage: ProcessingStageRecord,
        stage_ref: EvidenceRef,
    ) -> list[_ExecutionBranch]:
        delivered = state.traffic_class == "LOCAL_INPUT"
        outcome = "DELIVERED" if delivered else "UNKNOWN"
        transition = self._transition(stage, outcome, transitions)
        next_state = replace(state, current_stage_id=transition.to_stage_id)
        refs = self._dedupe(
            [stage_ref, self._ref("ProcessingTransition", transition.transition_id)]
        )
        gaps = []
        if not delivered:
            gaps.append(
                PacketProcessingExecutionGap(
                    code="STAGE_PRECONDITION_UNKNOWN",
                    stage_id=stage.stage_id,
                    evidence_refs=[stage_ref],
                )
            )
        local_delivery = PacketProcessingLocalDelivery(
            result=outcome,  # type: ignore[arg-type]
            routing_context_id=state.routing_context_id,
            traffic_class=state.traffic_class,  # type: ignore[arg-type]
            ingress_network_interface_id=state.ingress_network_interface_id,
            ingress_l3_binding_id=state.ingress_l3_binding_id,
            reason=(
                "LOCAL_INPUT_CONTEXT"
                if delivered
                else "STAGE_PRECONDITION_UNKNOWN"
            ),
        )
        execution = self._stage_execution(
            stage,
            state,
            state,
            outcome,
            transition,
            refs,
            direct_egress=state.direct_egress,
            local_delivery=local_delivery,
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

    def _execute_adjacency(
        self,
        plan: PacketProcessingPlanRecord,
        stages: dict[uuid.UUID, ProcessingStageRecord],
        transitions: dict[tuple[uuid.UUID, str], ProcessingTransitionRecord],
        initial: FlowExecutionState,
        state: FlowExecutionState,
        executions: tuple[PacketProcessingStageExecution, ...],
        evidence: tuple[EvidenceRef, ...],
        view: EvaluationView,
        stage: ProcessingStageRecord,
        stage_ref: EvidenceRef,
    ) -> list[_ExecutionBranch]:
        assert state.current_packet_state is not None
        direct = state.direct_egress
        if direct is None or (
            direct.adjacency_mode == "DIRECT_DESTINATION"
            and state.current_packet_state.destination_ip is None
        ):
            return self._continue_adjacency_unknown(
                plan,
                stages,
                transitions,
                initial,
                state,
                executions,
                evidence,
                view,
                stage,
                stage_ref,
                gap_code="STAGE_PRECONDITION_UNKNOWN",
                evidence_refs=[stage_ref],
            )

        target_ip = derive_adjacency_target(
            direct, state.current_packet_state.destination_ip
        )
        adjacency = self.structural_adjacency.resolve(
            StructuralAdjacencyQuery(
                egress_l3_binding_id=direct.egress_l3_binding_id,
                neighbor_target_ip=target_ip,
            ),
            view,
        )
        if not adjacency.candidate_results:
            return self._continue_adjacency_unknown(
                plan,
                stages,
                transitions,
                initial,
                state,
                executions,
                evidence,
                view,
                stage,
                stage_ref,
                gap_code="STRUCTURAL_ADJACENCY_UNKNOWN",
                evidence_refs=adjacency.identity_resolution.evidence_refs,
                adjacency_target_ip=target_ip,
                structural_adjacency_evaluation=adjacency,
            )

        results: list[_ExecutionBranch] = []
        for candidate_result in adjacency.candidate_results:
            candidate = candidate_result.identity_candidate
            receiving = self.repository.get_l3_binding_attachment(
                candidate.target_l3_binding_id
            )
            if receiving.network_interface_id != candidate.target_network_interface_id:
                raise ModelError(
                    "Structural adjacency candidate target attachment is inconsistent",
                    {
                        "interface_address_id": str(candidate.interface_address_id),
                        "target_l3_binding_id": str(candidate.target_l3_binding_id),
                        "candidate_network_interface_id": str(
                            candidate.target_network_interface_id
                        ),
                        "binding_network_interface_id": str(
                            receiving.network_interface_id
                        ),
                    },
                )
            identity_refs = self._adjacency_identity_refs(direct, candidate)
            if candidate_result.result == "REACHABLE":
                for l2_branch in candidate_result.l2_traversal.branches:
                    outcome = (
                        "NEXT_PROCESSING_POINT"
                        if direct.adjacency_mode == "GATEWAY"
                        else "TARGET_ATTACHMENT_REACHED"
                    )
                    transition = self._transition(stage, outcome, transitions)
                    updated = replace(
                        state,
                        routing_context_id=receiving.routing_context_id,
                        traffic_class=(
                            "TRANSIT"
                            if outcome == "NEXT_PROCESSING_POINT"
                            else "LOCAL_INPUT"
                        ),
                        ingress_network_interface_id=receiving.network_interface_id,
                        ingress_l3_binding_id=receiving.l3_binding_id,
                        selected_routing_table_id=None,
                        current_route_resolution_branch=None,
                        direct_egress=None,
                    )
                    next_state = replace(
                        updated, current_stage_id=transition.to_stage_id
                    )
                    refs = self._dedupe(
                        [
                            stage_ref,
                            *identity_refs,
                            *l2_branch.evidence_refs,
                            self._ref(
                                "ProcessingTransition", transition.transition_id
                            ),
                        ]
                    )
                    handoff = PacketProcessingHandoff(
                        outcome=outcome,  # type: ignore[arg-type]
                        receiving_network_interface_id=(
                            receiving.network_interface_id
                        ),
                        receiving_l3_binding_id=receiving.l3_binding_id,
                        receiving_routing_context_id=receiving.routing_context_id,
                    )
                    execution = self._stage_execution(
                        stage,
                        state,
                        updated,
                        outcome,
                        transition,
                        refs,
                        direct_egress=direct,
                        adjacency_target_ip=target_ip,
                        structural_adjacency_evaluation=adjacency,
                        selected_adjacency_candidate=candidate,
                        selected_l2_branch_id=l2_branch.branch_id,
                        handoff=handoff,
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

            if (
                candidate_result.result == "UNKNOWN"
                or candidate_result.l2_traversal.gaps
            ):
                gap_refs = self._dedupe(
                    [
                        *identity_refs,
                        *[
                            ref
                            for gap in candidate_result.l2_traversal.gaps
                            for ref in gap.evidence_refs
                        ],
                    ]
                )
                results.extend(
                    self._continue_adjacency_unknown(
                        plan,
                        stages,
                        transitions,
                        initial,
                        state,
                        executions,
                        evidence,
                        view,
                        stage,
                        stage_ref,
                        gap_code="STRUCTURAL_ADJACENCY_UNKNOWN",
                        evidence_refs=gap_refs,
                        adjacency_target_ip=target_ip,
                        structural_adjacency_evaluation=adjacency,
                        selected_adjacency_candidate=candidate,
                    )
                )
        return results

    def _continue_adjacency_unknown(
        self,
        plan: PacketProcessingPlanRecord,
        stages: dict[uuid.UUID, ProcessingStageRecord],
        transitions: dict[tuple[uuid.UUID, str], ProcessingTransitionRecord],
        initial: FlowExecutionState,
        state: FlowExecutionState,
        executions: tuple[PacketProcessingStageExecution, ...],
        evidence: tuple[EvidenceRef, ...],
        view: EvaluationView,
        stage: ProcessingStageRecord,
        stage_ref: EvidenceRef,
        *,
        gap_code: str,
        evidence_refs: list[EvidenceRef],
        adjacency_target_ip=None,
        structural_adjacency_evaluation: StructuralAdjacencyArtifact | None = None,
        selected_adjacency_candidate: AdjacencyCandidate | None = None,
    ) -> list[_ExecutionBranch]:
        transition = self._transition(stage, "UNKNOWN", transitions)
        next_state = replace(state, current_stage_id=transition.to_stage_id)
        refs = self._dedupe(
            [
                stage_ref,
                *evidence_refs,
                self._ref("ProcessingTransition", transition.transition_id),
            ]
        )
        gap = PacketProcessingExecutionGap(
            code=gap_code,  # type: ignore[arg-type]
            stage_id=stage.stage_id,
            evidence_refs=self._dedupe(evidence_refs or [stage_ref]),
        )
        execution = self._stage_execution(
            stage,
            state,
            state,
            "UNKNOWN",
            transition,
            refs,
            direct_egress=state.direct_egress,
            adjacency_target_ip=adjacency_target_ip,
            structural_adjacency_evaluation=structural_adjacency_evaluation,
            selected_adjacency_candidate=selected_adjacency_candidate,
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

    def _adjacency_identity_refs(
        self, direct: DirectEgressState, candidate: AdjacencyCandidate
    ) -> list[EvidenceRef]:
        source = self.repository.get_l3_binding_attachment(
            direct.egress_l3_binding_id
        )
        return self._dedupe(
            [
                self._ref("L3Binding", source.l3_binding_id),
                self._ref("NetworkInterface", source.network_interface_id),
                self._ref("RoutingContext", source.routing_context_id),
                self._ref("InterfaceAddress", candidate.interface_address_id),
                self._ref("L3Binding", candidate.target_l3_binding_id),
                self._ref(
                    "NetworkInterface", candidate.target_network_interface_id
                ),
            ]
        )

    def _execute_nonexact(
        self,
        plan: PacketProcessingPlanRecord,
        stages: dict[uuid.UUID, ProcessingStageRecord],
        transitions: dict[tuple[uuid.UUID, str], ProcessingTransitionRecord],
        initial: FlowExecutionState,
        state: FlowExecutionState,
        executions: tuple[PacketProcessingStageExecution, ...],
        evidence: tuple[EvidenceRef, ...],
        view: EvaluationView,
        stage: ProcessingStageRecord,
        stage_ref: EvidenceRef,
        packet_gap_code: str | None = None,
    ) -> list[_ExecutionBranch]:
        outcome = {
            "ROUTING_POLICY": "TABLE_SELECTION_UNKNOWN",
            "ROUTE_DECISION": "UNKNOWN",
            "SECURITY": "UNKNOWN",
            "NAT": "UNKNOWN",
            "ADJACENCY_L2": "UNKNOWN",
        }[stage.kind]
        if stage.kind == "ROUTING_POLICY":
            updated = replace(state, selected_routing_table_id=None)
        elif stage.kind == "ROUTE_DECISION":
            updated = replace(
                state,
                current_route_resolution_branch=None,
                direct_egress=None,
            )
        else:
            updated = state
        transition = self._transition(stage, outcome, transitions)
        next_state = replace(updated, current_stage_id=transition.to_stage_id)
        refs = self._dedupe(
            [stage_ref, self._ref("ProcessingTransition", transition.transition_id)]
        )
        packet_gap = PacketProcessingExecutionGap(
            code=(
                packet_gap_code
                or (
                    "PACKET_CONSTRAINT_UNSUPPORTED"
                    if state.current_packet_constraint is not None
                    else "PACKET_STATE_UNKNOWN"
                )
            ),
            stage_id=stage.stage_id,
            evidence_refs=[stage_ref],
        )
        gaps = [packet_gap]
        if stage.kind == "SECURITY":
            gaps.append(
                PacketProcessingExecutionGap(
                    code="SECURITY_STAGE_UNKNOWN",
                    stage_id=stage.stage_id,
                    evidence_refs=[stage_ref],
                )
            )
        elif stage.kind == "NAT":
            gaps.append(
                PacketProcessingExecutionGap(
                    code="NAT_STAGE_UNKNOWN",
                    stage_id=stage.stage_id,
                    evidence_refs=[stage_ref],
                )
            )
        execution = self._stage_execution(
            stage,
            state,
            updated,
            outcome,
            transition,
            refs,
            direct_egress=updated.direct_egress,
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

    def _egress_context(
        self, state: FlowExecutionState
    ) -> tuple[uuid.UUID | None, uuid.UUID | None]:
        if state.direct_egress is None:
            return None, None
        binding_id = state.direct_egress.egress_l3_binding_id
        attachment = self.repository.get_l3_binding_attachment(binding_id)
        return binding_id, attachment.network_interface_id

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
        nat_attachment_evaluation: NATAttachmentStageArtifact | None = None,
        adjacency_target_ip=None,
        structural_adjacency_evaluation: StructuralAdjacencyArtifact | None = None,
        selected_adjacency_candidate: AdjacencyCandidate | None = None,
        selected_l2_branch_id: str | None = None,
        handoff: PacketProcessingHandoff | None = None,
        local_delivery: PacketProcessingLocalDelivery | None = None,
        gaps: list[PacketProcessingExecutionGap] | None = None,
    ) -> PacketProcessingStageExecution:
        return PacketProcessingStageExecution(
            stage_id=stage.stage_id,
            stage_kind=stage.kind,  # type: ignore[arg-type]
            packet_before=before.current_packet_state,
            packet_before_constraint=before.current_packet_constraint,
            packet_before_unknown=before.current_packet_unknown,
            packet_after=after.current_packet_state,
            packet_after_constraint=after.current_packet_constraint,
            packet_after_unknown=after.current_packet_unknown,
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
            nat_attachment_evaluation=nat_attachment_evaluation,
            adjacency_target_ip=adjacency_target_ip,
            structural_adjacency_evaluation=structural_adjacency_evaluation,
            selected_adjacency_candidate=selected_adjacency_candidate,
            selected_l2_branch_id=selected_l2_branch_id,
            handoff=handoff,
            local_delivery=local_delivery,
            evidence_refs=evidence_refs,
            gaps=gaps or [],
        )

    @staticmethod
    def _state_schema(state: FlowExecutionState) -> PacketProcessingFlowState:
        return PacketProcessingFlowState(
            original_packet_state=state.original_packet_state,
            current_packet_state=state.current_packet_state,
            current_packet_constraint=state.current_packet_constraint,
            current_packet_unknown=state.current_packet_unknown,
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
    NATAttachmentStageArtifact,
    NATEvaluationContext,
    NATPacketConstraint,
