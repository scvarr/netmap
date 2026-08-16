import uuid

from app.errors import ValidationError
from app.repository import CanonicalRepository, RouteRecord
from app.schemas import (
    EvaluationView,
    EvidenceRef,
    RouteDecisionArtifact,
    RouteDecisionBasis,
    RouteDecisionGap,
    RouteDecisionQuery,
    RouteNextHopCandidate,
)


class SelectedTableRouteDecisionResolver:
    VERSION = "l3-selected-table-route-decision/1.0"

    def __init__(self, repository: CanonicalRepository) -> None:
        self.repository = repository

    def resolve(
        self, query: RouteDecisionQuery, view: EvaluationView
    ) -> RouteDecisionArtifact:
        selected_table = self.repository.get_selected_routing_table(
            query.routing_context_id, query.routing_table_id
        )
        table = selected_table.table
        destination_family = "IPv4" if query.destination_ip.version == 4 else "IPv6"
        if destination_family != table.address_family:
            raise ValidationError(
                "destination_ip address family does not match RoutingTable",
                {
                    "routing_table_id": str(table.table_id),
                    "table_address_family": table.address_family,
                    "destination_address_family": destination_family,
                },
            )
        basis = RouteDecisionBasis(
            routing_context_id=table.routing_context_id,
            routing_table_id=table.table_id,
            destination_ip=query.destination_ip,
            address_family=table.address_family,  # type: ignore[arg-type]
            configured_completeness=table.configured_completeness,  # type: ignore[arg-type]
        )
        base_refs = [
            self._ref("RoutingContext", table.routing_context_id),
            self._ref("RoutingTable", table.table_id),
        ]
        matches = [
            route
            for route in selected_table.routes
            if query.destination_ip in route.destination_prefix
        ]
        if table.configured_completeness != "COMPLETE":
            refs = self._dedupe(
                base_refs + [self._ref("Route", route.route_id) for route in matches]
            )
            return self._artifact(
                query,
                view,
                basis,
                "UNKNOWN",
                refs,
                gaps=[RouteDecisionGap(code="ROUTING_TABLE_INCOMPLETE", evidence_refs=refs)],
            )
        if not matches:
            return self._artifact(query, view, basis, "NO_ROUTE", base_refs)

        longest_prefix = max(route.destination_prefix.prefixlen for route in matches)
        selected = [
            route
            for route in matches
            if route.destination_prefix.prefixlen == longest_prefix
        ]
        if len(selected) != 1:
            refs = self._dedupe(
                base_refs + [self._ref("Route", route.route_id) for route in selected]
            )
            return self._artifact(
                query,
                view,
                basis,
                "CONFLICTING",
                refs,
                gaps=[RouteDecisionGap(code="ROUTE_CONFLICTING", evidence_refs=refs)],
            )

        route = selected[0]
        route_refs = base_refs + [self._ref("Route", route.route_id)]
        if route.disposition in {"LOCAL", "DISCARD"}:
            return self._artifact(
                query,
                view,
                basis,
                route.disposition,
                route_refs,
                selected_route=route,
            )

        candidates: list[RouteNextHopCandidate] = []
        refs = list(route_refs)
        for next_hop in route.next_hops:
            candidates.append(
                RouteNextHopCandidate(
                    route_next_hop_id=next_hop.next_hop_id,
                    gateway_address=next_hop.gateway_address,
                    egress_l3_binding_id=next_hop.egress_l3_binding_id,
                )
            )
            refs.append(self._ref("RouteNextHop", next_hop.next_hop_id))
            if next_hop.egress_l3_binding_id is not None:
                refs.append(self._ref("L3Binding", next_hop.egress_l3_binding_id))
        return self._artifact(
            query,
            view,
            basis,
            "FORWARD",
            self._dedupe(refs),
            selected_route=route,
            candidates=candidates,
        )

    @staticmethod
    def _artifact(
        query: RouteDecisionQuery,
        view: EvaluationView,
        basis: RouteDecisionBasis,
        result: str,
        refs: list[EvidenceRef],
        *,
        selected_route: RouteRecord | None = None,
        candidates: list[RouteNextHopCandidate] | None = None,
        gaps: list[RouteDecisionGap] | None = None,
    ) -> RouteDecisionArtifact:
        return RouteDecisionArtifact(
            query=query,
            evaluation_view=view,
            result=result,  # type: ignore[arg-type]
            decision_basis=basis,
            selected_route_id=(
                selected_route.route_id if selected_route is not None else None
            ),
            next_hop_candidates=candidates or [],
            evidence_refs=refs,
            gaps=gaps or [],
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
