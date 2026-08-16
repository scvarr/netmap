import uuid
from dataclasses import dataclass

from app.errors import ValidationError
from app.next_hop_resolver import SelectedTableNextHopResolver
from app.repository import CanonicalRepository
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    L3ReachabilityArtifact,
    L3ReachabilityBranch,
    L3ReachabilityHop,
    L3ReachabilityQuery,
    L3RoutingState,
    NextHopResolutionQuery,
    StructuralAdjacencyCandidateResult,
    StructuralAdjacencyArtifact,
    StructuralAdjacencyQuery,
)
from app.structural_adjacency_resolver import StructuralAdjacencyProofResolver


ForwardingKey = tuple[uuid.UUID, uuid.UUID | None, uuid.UUID, str]


@dataclass(frozen=True)
class _TraversalBranch:
    termination: str
    hops: tuple[L3ReachabilityHop, ...]
    evidence_refs: tuple[EvidenceRef, ...]


class ConfiguredL3ReachabilityResolver:
    VERSION = "l3-configured-multirouter/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository
        self.next_hop = SelectedTableNextHopResolver(repository)
        self.adjacency = StructuralAdjacencyProofResolver(repository)

    def resolve(
        self, query: L3ReachabilityQuery, view: EvaluationView
    ) -> L3ReachabilityArtifact:
        origin = self.repository.get_l3_binding_attachment(
            query.origin_l3_binding_id
        )
        selections = self._validate_selections(query)
        initial = L3RoutingState(
            routing_context_id=origin.routing_context_id,
            ingress_l3_binding_id=None,
            destination_ip=query.destination_ip,
        )
        origin_refs = (
            self._ref("L3Binding", origin.l3_binding_id),
            self._ref("NetworkInterface", origin.network_interface_id),
            self._ref("RoutingContext", origin.routing_context_id),
        )
        traversed = self._walk(
            initial, selections, view, (), origin_refs, frozenset()
        )
        branches = [
            L3ReachabilityBranch(
                branch_id=f"l3-branch-{index}",
                termination=branch.termination,  # type: ignore[arg-type]
                hops=list(branch.hops),
                evidence_refs=list(branch.evidence_refs),
            )
            for index, branch in enumerate(traversed, start=1)
        ]
        return L3ReachabilityArtifact(
            query=query,
            evaluation_view=view,
            verdict=self._verdict(branches),
            branches=branches,
            evidence_refs=self._dedupe(
                [ref for branch in branches for ref in branch.evidence_refs]
            ),
            warnings=[],
        )

    def _validate_selections(
        self, query: L3ReachabilityQuery
    ) -> dict[uuid.UUID, uuid.UUID]:
        selections: dict[uuid.UUID, uuid.UUID] = {}
        for selection in query.table_selections:
            if selection.routing_context_id in selections:
                raise ValidationError(
                    "At most one table selection is allowed per RoutingContext",
                    {"routing_context_id": str(selection.routing_context_id)},
                )
            # This is the canonical read boundary that validates both ownership
            # and the selected configured table slice.
            self.repository.get_selected_routing_table(
                selection.routing_context_id, selection.routing_table_id
            )
            selections[selection.routing_context_id] = selection.routing_table_id
        return selections

    def _walk(
        self,
        state: L3RoutingState,
        selections: dict[uuid.UUID, uuid.UUID],
        view: EvaluationView,
        hops: tuple[L3ReachabilityHop, ...],
        evidence: tuple[EvidenceRef, ...],
        visited: frozenset[ForwardingKey],
    ) -> list[_TraversalBranch]:
        table_id = selections.get(state.routing_context_id)
        state_refs = [self._ref("RoutingContext", state.routing_context_id)]
        if state.ingress_l3_binding_id is not None:
            state_refs.append(self._ref("L3Binding", state.ingress_l3_binding_id))
        elif not hops:
            state_refs.extend(evidence)
        if table_id is None:
            hop = L3ReachabilityHop(
                routing_state=state,
                evidence_refs=self._dedupe(state_refs),
            )
            return [
                self._terminal(
                    "TABLE_SELECTION_UNKNOWN",
                    hops + (hop,),
                    evidence + tuple(state_refs),
                )
            ]

        key = (
            state.routing_context_id,
            state.ingress_l3_binding_id,
            table_id,
            str(state.destination_ip),
        )
        selected_refs = state_refs + [self._ref("RoutingTable", table_id)]
        if key in visited:
            hop = L3ReachabilityHop(
                routing_state=state,
                selected_routing_table_id=table_id,
                evidence_refs=self._dedupe(selected_refs),
            )
            return [
                self._terminal(
                    "FORWARDING_LOOP",
                    hops + (hop,),
                    evidence + tuple(selected_refs),
                )
            ]

        resolution = self.next_hop.resolve(
            NextHopResolutionQuery(
                routing_context_id=state.routing_context_id,
                routing_table_id=table_id,
                destination_ip=state.destination_ip,
            ),
            view,
        )
        results: list[_TraversalBranch] = []
        next_visited = visited | {key}
        for next_hop_branch in resolution.branches:
            branch_refs = self._dedupe(selected_refs + next_hop_branch.evidence_refs)
            base_hop = L3ReachabilityHop(
                routing_state=state,
                selected_routing_table_id=table_id,
                next_hop_resolution=resolution,
                next_hop_branch=next_hop_branch,
                evidence_refs=branch_refs,
            )
            if next_hop_branch.outcome != "RESOLVED":
                if next_hop_branch.outcome == "LOCAL_TERMINAL":
                    terminal_purpose = next_hop_branch.lookup_steps[-1].state.purpose
                    termination = (
                        "LOCAL_DELIVERY"
                        if terminal_purpose == "PACKET_DESTINATION"
                        else "NEXT_HOP_UNRESOLVED"
                    )
                else:
                    termination = {
                        "DISCARD": "ROUTE_DISCARD",
                        "NO_ROUTE": "NO_ROUTE",
                        "UNKNOWN": "ROUTE_UNKNOWN",
                        "CONFLICTING": "ROUTE_CONFLICTING",
                        "LOOP_DETECTED": "LOOP_DETECTED",
                    }[next_hop_branch.outcome]
                results.append(
                    self._terminal(
                        termination,
                        hops + (base_hop,),
                        evidence + tuple(branch_refs),
                    )
                )
                continue

            direct = next_hop_branch.direct_egress
            if direct is None:  # protected by the M4.2 artifact contract
                results.append(
                    self._terminal(
                        "ROUTE_UNKNOWN",
                        hops + (base_hop,),
                        evidence + tuple(branch_refs),
                    )
                )
                continue
            adjacency = self.adjacency.resolve(
                StructuralAdjacencyQuery(
                    egress_l3_binding_id=direct.egress_l3_binding_id,
                    neighbor_target_ip=direct.neighbor_target_ip,
                ),
                view,
            )
            if not adjacency.candidate_results:
                unknown_hop = base_hop.model_copy(
                    update={
                        "structural_adjacency": adjacency,
                        "evidence_refs": self._dedupe(
                            branch_refs + adjacency.evidence_refs
                        ),
                    }
                )
                results.append(
                    self._terminal(
                        "STRUCTURAL_ADJACENCY_UNKNOWN",
                        hops + (unknown_hop,),
                        evidence + tuple(unknown_hop.evidence_refs),
                    )
                )
                continue

            for candidate_result in adjacency.candidate_results:
                results.extend(
                    self._continue_candidate(
                        state,
                        base_hop,
                        adjacency,
                        candidate_result,
                        selections,
                        view,
                        hops,
                        evidence,
                        next_visited,
                    )
                )
        return results

    def _continue_candidate(
        self,
        state: L3RoutingState,
        base_hop: L3ReachabilityHop,
        adjacency: StructuralAdjacencyArtifact,
        candidate_result: StructuralAdjacencyCandidateResult,
        selections: dict[uuid.UUID, uuid.UUID],
        view: EvaluationView,
        hops: tuple[L3ReachabilityHop, ...],
        evidence: tuple[EvidenceRef, ...],
        visited: frozenset[ForwardingKey],
    ) -> list[_TraversalBranch]:
        candidate = candidate_result.identity_candidate
        assert base_hop.next_hop_branch is not None
        direct = base_hop.next_hop_branch.direct_egress
        assert direct is not None
        source = self.repository.get_l3_binding_attachment(
            direct.egress_l3_binding_id
        )
        identity_refs = [
            self._ref("L3Binding", source.l3_binding_id),
            self._ref("NetworkInterface", source.network_interface_id),
            self._ref("RoutingContext", source.routing_context_id),
            self._ref("InterfaceAddress", candidate.interface_address_id),
            self._ref("L3Binding", candidate.target_l3_binding_id),
            self._ref(
                "NetworkInterface", candidate.target_network_interface_id
            ),
        ]
        refs = self._dedupe(base_hop.evidence_refs + identity_refs)
        if candidate_result.result != "REACHABLE":
            refs = self._dedupe(
                refs + candidate_result.l2_traversal.evidence_refs
            )
            hop = base_hop.model_copy(
                update={
                    "structural_adjacency": adjacency,
                    "adjacency_candidate": candidate_result,
                    "evidence_refs": refs,
                }
            )
            return [
                self._terminal(
                    "STRUCTURAL_ADJACENCY_UNKNOWN",
                    hops + (hop,),
                    evidence + tuple(refs),
                )
            ]

        results: list[_TraversalBranch] = []
        for l2_branch in candidate_result.l2_traversal.branches:
            path_refs = self._dedupe(refs + l2_branch.evidence_refs)
            if str(candidate.ip_address) == str(state.destination_ip):
                attachment = self.repository.get_l3_binding_attachment(
                    candidate.target_l3_binding_id
                )
                hop = base_hop.model_copy(
                    update={
                        "structural_adjacency": adjacency,
                        "adjacency_candidate": candidate_result,
                        "l2_branch_id": l2_branch.branch_id,
                        "reached_l3_binding_id": candidate.target_l3_binding_id,
                        "next_routing_context_id": attachment.routing_context_id,
                        "evidence_refs": path_refs,
                    }
                )
                results.append(
                    self._terminal(
                        "TARGET_REACHED",
                        hops + (hop,),
                        evidence + tuple(path_refs),
                    )
                )
                continue

            # InterfaceAddress identity remains scoped to the sender's routing
            # context (M4.3).  A receiving NetworkInterface may additionally be
            # attached to one or more local processing contexts.  Preserve all
            # such explicit L3Binding handoffs instead of guessing one.
            attachments = self.repository.get_l3_binding_attachments_by_interface(
                candidate.target_network_interface_id
            )
            processing_attachments = tuple(
                attachment
                for attachment in attachments
                if attachment.l3_binding_id != candidate.target_l3_binding_id
            )
            if not processing_attachments:
                processing_attachments = attachments
            for attachment in processing_attachments:
                handoff_refs = self._dedupe(
                    path_refs
                    + [self._ref("L3Binding", attachment.l3_binding_id)]
                )
                hop = base_hop.model_copy(
                    update={
                        "structural_adjacency": adjacency,
                        "adjacency_candidate": candidate_result,
                        "l2_branch_id": l2_branch.branch_id,
                        "reached_l3_binding_id": attachment.l3_binding_id,
                        "next_routing_context_id": attachment.routing_context_id,
                        "evidence_refs": handoff_refs,
                    }
                )
                next_state = L3RoutingState(
                    routing_context_id=attachment.routing_context_id,
                    ingress_l3_binding_id=attachment.l3_binding_id,
                    destination_ip=state.destination_ip,
                )
                results.extend(
                    self._walk(
                        next_state,
                        selections,
                        view,
                        hops + (hop,),
                        evidence + tuple(handoff_refs),
                        visited,
                    )
                )

        # A reachable proof may coexist with incomplete alternative L2 facts.
        # Preserve that uncertainty as its own relevant branch.
        if candidate_result.l2_traversal.gaps:
            unknown_hop = base_hop.model_copy(
                update={
                    "structural_adjacency": adjacency,
                    "adjacency_candidate": candidate_result,
                    "evidence_refs": refs,
                }
            )
            results.append(
                self._terminal(
                    "STRUCTURAL_ADJACENCY_UNKNOWN",
                    hops + (unknown_hop,),
                    evidence + tuple(refs),
                )
            )
        return results

    @classmethod
    def _terminal(
        cls,
        termination: str,
        hops: tuple[L3ReachabilityHop, ...],
        evidence: tuple[EvidenceRef, ...],
    ) -> _TraversalBranch:
        return _TraversalBranch(
            termination=termination,
            hops=hops,
            evidence_refs=tuple(cls._dedupe(list(evidence))),
        )

    @staticmethod
    def _verdict(branches: list[L3ReachabilityBranch]) -> str:
        terminations = {branch.termination for branch in branches}
        if terminations & {"TARGET_REACHED", "LOCAL_DELIVERY"}:
            return "REACHABLE"
        unresolved = {
            "TABLE_SELECTION_UNKNOWN",
            "ROUTE_UNKNOWN",
            "ROUTE_CONFLICTING",
            "NEXT_HOP_UNRESOLVED",
            "STRUCTURAL_ADJACENCY_UNKNOWN",
        }
        if not branches or terminations & unresolved:
            return "UNKNOWN"
        return "UNREACHABLE"

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
