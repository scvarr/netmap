import uuid
from ipaddress import IPv4Address, IPv6Address

from app.l3_resolver import SelectedTableRouteDecisionResolver
from app.repository import CanonicalRepository
from app.schemas import (
    DirectEgressState,
    EvaluationView,
    EvidenceRef,
    L3LookupState,
    L3LookupStep,
    NextHopResolutionArtifact,
    NextHopResolutionBranch,
    NextHopResolutionQuery,
    RouteDecisionQuery,
    RouteNextHopCandidate,
)


LookupAddress = IPv4Address | IPv6Address
LookupKey = tuple[uuid.UUID, uuid.UUID, str, uuid.UUID | None, str]


class SelectedTableNextHopResolver:
    VERSION = "l3-selected-table-next-hop-resolution/1.1"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.route_decision = SelectedTableRouteDecisionResolver(repository)

    def resolve(
        self, query: NextHopResolutionQuery, view: EvaluationView
    ) -> NextHopResolutionArtifact:
        initial = L3LookupState(
            routing_context_id=query.routing_context_id,
            routing_table_id=query.routing_table_id,
            lookup_address=query.destination_ip,
            original_destination=query.destination_ip,
            purpose="PACKET_DESTINATION",
        )
        branches = self._resolve_state(initial, view, [], [], frozenset())
        evidence = self._dedupe(
            [ref for branch in branches for ref in branch.evidence_refs]
        )
        return NextHopResolutionArtifact(
            query=query,
            evaluation_view=view,
            result=self._overall_result(branches),
            branches=branches,
            evidence_refs=evidence,
            warnings=[],
        )

    def _resolve_state(
        self,
        state: L3LookupState,
        view: EvaluationView,
        steps: list[L3LookupStep],
        evidence: list[EvidenceRef],
        visited: frozenset[LookupKey],
    ) -> list[NextHopResolutionBranch]:
        key = self._state_key(state)
        if key in visited:
            refs = [
                self._ref("RoutingContext", state.routing_context_id),
                self._ref("RoutingTable", state.routing_table_id),
            ]
            loop_step = L3LookupStep(
                state=state,
                route_decision_result="LOOP_DETECTED",
                evidence_refs=refs,
            )
            return [
                self._terminal_branch(
                    "LOOP_DETECTED", steps + [loop_step], evidence + refs
                )
            ]

        decision = self.route_decision.resolve(
            RouteDecisionQuery(
                routing_context_id=state.routing_context_id,
                routing_table_id=state.routing_table_id,
                destination_ip=state.lookup_address,
            ),
            view,
        )
        if decision.result != "FORWARD":
            outcome = "LOCAL_TERMINAL" if decision.result == "LOCAL" else decision.result
            step = L3LookupStep(
                state=state,
                route_decision_result=decision.result,
                selected_route_id=decision.selected_route_id,
                evidence_refs=decision.evidence_refs,
            )
            return [
                self._terminal_branch(
                    outcome, steps + [step], evidence + decision.evidence_refs
                )
            ]

        next_visited = visited | {key}
        branches: list[NextHopResolutionBranch] = []
        for candidate in decision.next_hop_candidates:
            candidate_refs = self._candidate_refs(
                state, decision.selected_route_id, candidate
            )
            step = L3LookupStep(
                state=state,
                route_decision_result="FORWARD",
                selected_route_id=decision.selected_route_id,
                selected_route_next_hop_id=candidate.route_next_hop_id,
                gateway_address=candidate.gateway_address,
                egress_l3_binding_id=candidate.egress_l3_binding_id,
                evidence_refs=candidate_refs,
            )
            branch_steps = steps + [step]
            branch_evidence = evidence + candidate_refs
            if candidate.egress_l3_binding_id is not None:
                if candidate.gateway_address is not None:
                    adjacency_mode = "GATEWAY"
                    gateway_address = candidate.gateway_address
                elif state.purpose == "NEXT_HOP_RESOLUTION":
                    adjacency_mode = "GATEWAY"
                    gateway_address = state.lookup_address
                else:
                    adjacency_mode = "DIRECT_DESTINATION"
                    gateway_address = None
                branches.append(
                    NextHopResolutionBranch(
                        outcome="RESOLVED",
                        lookup_steps=branch_steps,
                        direct_egress=DirectEgressState(
                            egress_l3_binding_id=candidate.egress_l3_binding_id,
                            adjacency_mode=adjacency_mode,
                            gateway_address=gateway_address,
                            original_destination=state.original_destination,
                        ),
                        evidence_refs=self._dedupe(branch_evidence),
                    )
                )
                continue

            gateway = candidate.gateway_address
            if gateway is None:  # canonical validation makes this unreachable
                continue
            recursive_state = L3LookupState(
                routing_context_id=state.routing_context_id,
                routing_table_id=state.routing_table_id,
                lookup_address=gateway,
                original_destination=state.original_destination,
                purpose="NEXT_HOP_RESOLUTION",
                egress_constraint=state.egress_constraint,
            )
            branches.extend(
                self._resolve_state(
                    recursive_state,
                    view,
                    branch_steps,
                    branch_evidence,
                    next_visited,
                )
            )
        return branches

    def _candidate_refs(
        self,
        state: L3LookupState,
        route_id: uuid.UUID | None,
        candidate: RouteNextHopCandidate,
    ) -> list[EvidenceRef]:
        refs = [
            self._ref("RoutingContext", state.routing_context_id),
            self._ref("RoutingTable", state.routing_table_id),
        ]
        if route_id is not None:
            refs.append(self._ref("Route", route_id))
        refs.append(self._ref("RouteNextHop", candidate.route_next_hop_id))
        if candidate.egress_l3_binding_id is not None:
            refs.append(self._ref("L3Binding", candidate.egress_l3_binding_id))
        return refs

    @staticmethod
    def _state_key(state: L3LookupState) -> LookupKey:
        return (
            state.routing_context_id,
            state.routing_table_id,
            str(state.lookup_address),
            state.egress_constraint,
            state.purpose,
        )

    @classmethod
    def _terminal_branch(
        cls,
        outcome: str,
        steps: list[L3LookupStep],
        evidence: list[EvidenceRef],
    ) -> NextHopResolutionBranch:
        return NextHopResolutionBranch(
            outcome=outcome,  # type: ignore[arg-type]
            lookup_steps=steps,
            evidence_refs=cls._dedupe(evidence),
        )

    @staticmethod
    def _overall_result(branches: list[NextHopResolutionBranch]) -> str:
        outcomes = {branch.outcome for branch in branches}
        if "RESOLVED" in outcomes:
            return "RESOLVED"
        if len(outcomes) == 1:
            return next(iter(outcomes))
        return "UNKNOWN"

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
