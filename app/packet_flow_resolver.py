import uuid
from dataclasses import dataclass

from app.errors import ModelError
from app.packet_processing_executor import PacketProcessingPlanExecutor
from app.packet_processing_plan_selection_resolver import (
    PacketProcessingPlanSelectionResolver,
)
from app.repository import CanonicalRepository
from app.schemas import (
    ConnectionState,
    EvaluationView,
    EvidenceRef,
    PacketFlowContext,
    PacketFlowEvaluationArtifact,
    PacketFlowEvaluationQuery,
    PacketFlowExecutionBranch,
    PacketFlowGap,
    PacketFlowLocalStep,
    PacketProcessingEvaluationQuery,
    PacketProcessingExecutionBranch,
    PacketProcessingHandoff,
    PacketProcessingPlanSelectionQuery,
    PacketState,
)


@dataclass(frozen=True, kw_only=True)
class _Context:
    packet_state: PacketState
    routing_context_id: uuid.UUID
    traffic_class: str
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None
    connection_state: ConnectionState | None = None


@dataclass(frozen=True)
class _Branch:
    local_steps: tuple[PacketFlowLocalStep, ...]
    verdict: str
    termination_reason: str
    final_context: _Context | None
    evidence_refs: tuple[EvidenceRef, ...]
    gaps: tuple[PacketFlowGap, ...]


class ConfiguredPacketFlowResolver:
    VERSION = "packet-flow-configured/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository
        self.selector = PacketProcessingPlanSelectionResolver(repository)
        self.executor = PacketProcessingPlanExecutor(repository)

    def resolve(
        self, query: PacketFlowEvaluationQuery, view: EvaluationView
    ) -> PacketFlowEvaluationArtifact:
        initial = _Context(
            packet_state=query.packet_state,
            routing_context_id=query.routing_context_id,
            traffic_class=query.traffic_class,
            ingress_network_interface_id=query.ingress_network_interface_id,
            ingress_l3_binding_id=query.ingress_l3_binding_id,
            connection_state=query.connection_state,
        )
        completed = self._expand(
            query,
            view,
            initial,
            (),
            (),
            (),
            frozenset(),
        )
        branches = [
            PacketFlowExecutionBranch(
                branch_id=f"packet-flow-branch-{index}",
                local_steps=list(branch.local_steps),
                verdict=branch.verdict,  # type: ignore[arg-type]
                termination_reason=branch.termination_reason,  # type: ignore[arg-type]
                final_context=(
                    self._context_schema(branch.final_context)
                    if branch.final_context is not None
                    else None
                ),
                evidence_refs=list(branch.evidence_refs),
                gaps=list(branch.gaps),
            )
            for index, branch in enumerate(completed, start=1)
        ]
        verdicts = {branch.verdict for branch in completed}
        if verdicts == {"DELIVERED"}:
            result = "DELIVERED"
        elif verdicts == {"NOT_DELIVERED"}:
            result = "NOT_DELIVERED"
        else:
            result = "UNKNOWN"
        return PacketFlowEvaluationArtifact(
            query=query,
            evaluation_view=view,
            result=result,  # type: ignore[arg-type]
            original_packet_state=query.packet_state,
            branches=branches,
            evidence_refs=self._dedupe(
                [ref for branch in completed for ref in branch.evidence_refs]
            ),
            gaps=self._dedupe_gaps(
                [gap for branch in completed for gap in branch.gaps]
            ),
            warnings=[],
        )

    def _expand(
        self,
        query: PacketFlowEvaluationQuery,
        view: EvaluationView,
        context: _Context,
        steps: tuple[PacketFlowLocalStep, ...],
        evidence: tuple[EvidenceRef, ...],
        gaps: tuple[PacketFlowGap, ...],
        ancestry: frozenset[tuple[object, ...]],
    ) -> list[_Branch]:
        key = self._context_key(context)
        if key in ancestry:
            gap = PacketFlowGap(
                code="PACKET_FLOW_LOOP_DETECTED",
                local_step_sequence=(len(steps) or None),
                evidence_refs=list(evidence),
            )
            return [
                self._terminal(
                    steps,
                    "UNKNOWN",
                    "PACKET_FLOW_LOOP_DETECTED",
                    context,
                    evidence,
                    (*gaps, gap),
                )
            ]
        if len(ancestry) >= query.max_processing_points:
            gap = PacketFlowGap(
                code="PACKET_FLOW_SEARCH_LIMIT",
                local_step_sequence=(len(steps) or None),
                evidence_refs=list(evidence),
            )
            return [
                self._terminal(
                    steps,
                    "UNKNOWN",
                    "PACKET_FLOW_SEARCH_LIMIT",
                    context,
                    evidence,
                    (*gaps, gap),
                )
            ]

        selection = self.selector.resolve(
            PacketProcessingPlanSelectionQuery(
                routing_context_id=context.routing_context_id,
                traffic_class=context.traffic_class,  # type: ignore[arg-type]
                ingress_network_interface_id=context.ingress_network_interface_id,
                ingress_l3_binding_id=context.ingress_l3_binding_id,
            ),
            view,
        )
        sequence = len(steps) + 1
        selection_refs = self._dedupe(selection.evidence_refs)
        base_step = PacketFlowLocalStep(
            sequence=sequence,
            context_before=self._context_schema(context),
            plan_selection=selection,
            selected_plan_id=selection.selected_plan_id,
            evidence_refs=selection_refs,
        )
        accumulated_selection = tuple(
            self._dedupe([*evidence, *selection_refs])
        )

        if selection.result != "PLAN_SELECTED":
            reason = {
                "UNKNOWN": "PLAN_SELECTION_UNKNOWN",
                "CONFLICTING": "PLAN_SELECTION_CONFLICTING",
                "NO_PLAN_CONFIRMED": "NO_PROCESSING_PLAN_APPLICABLE",
            }[selection.result]
            gap_code = (
                "NO_PROCESSING_PLAN_APPLICABLE"
                if selection.result == "NO_PLAN_CONFIRMED"
                else "PLAN_SELECTION_UNRESOLVED"
            )
            gap = PacketFlowGap(
                code=gap_code,  # type: ignore[arg-type]
                local_step_sequence=sequence,
                evidence_refs=selection_refs,
            )
            return [
                self._terminal(
                    (*steps, base_step),
                    "UNKNOWN",
                    reason,
                    context,
                    accumulated_selection,
                    (*gaps, gap),
                )
            ]

        assert selection.selected_plan_id is not None
        evaluation = self.executor.resolve(
            PacketProcessingEvaluationQuery(
                plan_id=selection.selected_plan_id,
                traffic_class=context.traffic_class,  # type: ignore[arg-type]
                routing_context_id=context.routing_context_id,
                packet_state=context.packet_state,
                ingress_network_interface_id=context.ingress_network_interface_id,
                ingress_l3_binding_id=context.ingress_l3_binding_id,
                connection_state=context.connection_state,
            ),
            view,
        )
        if not evaluation.branches:
            refs = self._dedupe(
                [*selection_refs, *evaluation.evidence_refs]
            )
            step = base_step.model_copy(
                update={
                    "packet_processing_evaluation": evaluation,
                    "evidence_refs": refs,
                }
            )
            return [
                self._terminal(
                    (*steps, step),
                    "UNKNOWN",
                    "LOCAL_EXECUTION_UNKNOWN",
                    context,
                    tuple(self._dedupe([*evidence, *refs])),
                    gaps,
                )
            ]

        results: list[_Branch] = []
        next_ancestry = ancestry | {key}
        for local_branch in evaluation.branches:
            branch_refs = self._dedupe(
                [*selection_refs, *local_branch.evidence_refs]
            )
            branch_evidence = tuple(
                self._dedupe([*evidence, *branch_refs])
            )
            step = base_step.model_copy(
                update={
                    "packet_processing_evaluation": evaluation,
                    "selected_execution_branch_id": local_branch.branch_id,
                    "evidence_refs": branch_refs,
                }
            )
            if local_branch.terminal_outcome == "NETWORK_DELIVERY":
                results.append(
                    self._terminal(
                        (*steps, step),
                        "DELIVERED",
                        "NETWORK_DELIVERY",
                        self._exact_final_context(local_branch),
                        branch_evidence,
                        gaps,
                    )
                )
            elif local_branch.terminal_outcome == "NOT_DELIVERED":
                results.append(
                    self._terminal(
                        (*steps, step),
                        "NOT_DELIVERED",
                        "NOT_DELIVERED",
                        self._exact_final_context(local_branch),
                        branch_evidence,
                        gaps,
                    )
                )
            elif local_branch.terminal_outcome == "UNKNOWN":
                results.append(
                    self._terminal(
                        (*steps, step),
                        "UNKNOWN",
                        "LOCAL_EXECUTION_UNKNOWN",
                        self._exact_final_context(local_branch),
                        branch_evidence,
                        gaps,
                    )
                )
            else:
                results.extend(
                    self._continue_handoff(
                        query,
                        view,
                        context,
                        steps,
                        step,
                        local_branch,
                        branch_evidence,
                        gaps,
                        next_ancestry,
                    )
                )
        return results

    def _continue_handoff(
        self,
        query: PacketFlowEvaluationQuery,
        view: EvaluationView,
        context: _Context,
        prior_steps: tuple[PacketFlowLocalStep, ...],
        step: PacketFlowLocalStep,
        local_branch: PacketProcessingExecutionBranch,
        evidence: tuple[EvidenceRef, ...],
        gaps: tuple[PacketFlowGap, ...],
        ancestry: frozenset[tuple[object, ...]],
    ) -> list[_Branch]:
        handoffs = [
            execution.handoff
            for execution in local_branch.stage_executions
            if execution.handoff is not None
        ]
        if not handoffs:
            gap = PacketFlowGap(
                code="PROCESSING_HANDOFF_UNKNOWN",
                local_step_sequence=step.sequence,
                evidence_refs=list(evidence),
            )
            return [
                self._terminal(
                    (*prior_steps, step),
                    "UNKNOWN",
                    "PROCESSING_HANDOFF_UNKNOWN",
                    context,
                    evidence,
                    (*gaps, gap),
                )
            ]
        if len(handoffs) != 1:
            raise ModelError(
                "Packet processing branch contains multiple successful handoffs",
                {
                    "selected_execution_branch_id": local_branch.branch_id,
                    "handoff_count": len(handoffs),
                },
            )
        handoff = handoffs[0]
        assert handoff is not None
        self._validate_handoff(local_branch, handoff)
        final = local_branch.final_state
        if (
            final.current_packet_state is None
            or final.current_packet_constraint is not None
            or final.current_packet_unknown
        ):
            gap = PacketFlowGap(
                code="PROCESSING_HANDOFF_PACKET_UNKNOWN",
                local_step_sequence=step.sequence,
                evidence_refs=list(evidence),
            )
            return [
                self._terminal(
                    (*prior_steps, step.model_copy(update={"handoff": handoff})),
                    "UNKNOWN",
                    "PROCESSING_HANDOFF_PACKET_UNKNOWN",
                    None,
                    evidence,
                    (*gaps, gap),
                )
            ]
        next_context = _Context(
            packet_state=final.current_packet_state,
            routing_context_id=handoff.receiving_routing_context_id,
            traffic_class=final.traffic_class,
            ingress_network_interface_id=handoff.receiving_network_interface_id,
            ingress_l3_binding_id=handoff.receiving_l3_binding_id,
            connection_state=None,
        )
        completed_step = step.model_copy(
            update={
                "context_after": self._context_schema(next_context),
                "handoff": handoff,
            }
        )
        return self._expand(
            query,
            view,
            next_context,
            (*prior_steps, completed_step),
            evidence,
            gaps,
            ancestry,
        )

    @staticmethod
    def _validate_handoff(
        branch: PacketProcessingExecutionBranch,
        handoff: PacketProcessingHandoff,
    ) -> None:
        final = branch.final_state
        expected_class = {
            "NEXT_PROCESSING_POINT": "TRANSIT",
            "TARGET_ATTACHMENT_REACHED": "LOCAL_INPUT",
        }[handoff.outcome]
        if (
            handoff.receiving_routing_context_id != final.routing_context_id
            or handoff.receiving_network_interface_id
            != final.ingress_network_interface_id
            or handoff.receiving_l3_binding_id != final.ingress_l3_binding_id
            or final.traffic_class != expected_class
        ):
            raise ModelError(
                "Packet processing handoff is inconsistent with final local state",
                {
                    "selected_execution_branch_id": branch.branch_id,
                    "handoff_outcome": handoff.outcome,
                    "expected_traffic_class": expected_class,
                    "final_traffic_class": final.traffic_class,
                    "handoff_routing_context_id": str(
                        handoff.receiving_routing_context_id
                    ),
                    "final_routing_context_id": str(final.routing_context_id),
                },
            )

    @staticmethod
    def _exact_final_context(
        branch: PacketProcessingExecutionBranch,
    ) -> _Context | None:
        final = branch.final_state
        if final.current_packet_state is None:
            return None
        return _Context(
            packet_state=final.current_packet_state,
            routing_context_id=final.routing_context_id,
            traffic_class=final.traffic_class,
            ingress_network_interface_id=final.ingress_network_interface_id,
            ingress_l3_binding_id=final.ingress_l3_binding_id,
            connection_state=final.connection_state,
        )

    @staticmethod
    def _context_key(context: _Context) -> tuple[object, ...]:
        packet = context.packet_state
        return (
            context.routing_context_id,
            context.traffic_class,
            context.ingress_network_interface_id,
            context.ingress_l3_binding_id,
            str(packet.source_ip) if packet.source_ip is not None else None,
            str(packet.destination_ip)
            if packet.destination_ip is not None
            else None,
            packet.ip_protocol,
            packet.source_port,
            packet.destination_port,
            packet.icmp_type,
            packet.icmp_code,
            context.connection_state,
        )

    @staticmethod
    def _context_schema(context: _Context) -> PacketFlowContext:
        return PacketFlowContext(
            packet_state=context.packet_state,
            routing_context_id=context.routing_context_id,
            traffic_class=context.traffic_class,  # type: ignore[arg-type]
            ingress_network_interface_id=context.ingress_network_interface_id,
            ingress_l3_binding_id=context.ingress_l3_binding_id,
            connection_state=context.connection_state,
        )

    @staticmethod
    def _terminal(
        steps: tuple[PacketFlowLocalStep, ...],
        verdict: str,
        reason: str,
        final_context: _Context | None,
        evidence: tuple[EvidenceRef, ...],
        gaps: tuple[PacketFlowGap, ...],
    ) -> _Branch:
        return _Branch(steps, verdict, reason, final_context, evidence, gaps)

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

    @staticmethod
    def _dedupe_gaps(gaps: list[PacketFlowGap]) -> list[PacketFlowGap]:
        result = []
        seen = set()
        for gap in gaps:
            key = (
                gap.code,
                gap.local_step_sequence,
                tuple((ref.entity_type, ref.entity_id) for ref in gap.evidence_refs),
            )
            if key not in seen:
                seen.add(key)
                result.append(gap)
        return result
