import os

import httpx
import pytest

from app.database import SessionLocal
from app.models import Route
from app.repository import CanonicalRepository, RouteNextHopInput

BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def decide(context_id, table_id, destination_ip):
    return httpx.post(
        f"{BASE_URL}/v1/traces/l3/route-decision",
        json={
            "routing_context_id": str(context_id),
            "routing_table_id": str(table_id),
            "destination_ip": destination_ip,
        },
        timeout=5,
    )


def configured_table(*, family="IPv4", completeness="COMPLETE"):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, family, completeness)
        return context.id, table.id


def test_complete_table_uses_longest_prefix_match():
    context_id, table_id = configured_table()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        broad = repository.add_route(table_id, "10.0.0.0/8", "DISCARD")
        specific = repository.add_route(table_id, "10.20.30.0/24", "LOCAL")

    artifact = decide(context_id, table_id, "10.20.30.55").json()

    assert artifact["result"] == "LOCAL"
    assert artifact["selected_route_id"] == str(specific.id)
    assert artifact["selected_route_id"] != str(broad.id)
    assert artifact["decision_basis"]["routing_table_id"] == str(table_id)
    assert artifact["decision_basis"]["destination_ip"] == "10.20.30.55"


def test_default_route_is_selected_by_normal_lpm():
    context_id, table_id = configured_table()
    with SessionLocal.begin() as session:
        route = CanonicalRepository(session).add_route(
            table_id, "0.0.0.0/0", "DISCARD"
        )

    artifact = decide(context_id, table_id, "198.51.100.7").json()

    assert artifact["result"] == "DISCARD"
    assert artifact["selected_route_id"] == str(route.id)


def test_ipv6_lpm_is_separate_from_ipv4():
    context_id, table_id = configured_table(family="IPv6")
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_route(table_id, "2001:db8::/32", "DISCARD")
        selected = repository.add_route(table_id, "2001:db8:10::/48", "LOCAL")

    artifact = decide(context_id, table_id, "2001:db8:10::42").json()

    assert artifact["result"] == "LOCAL"
    assert artifact["selected_route_id"] == str(selected.id)
    mismatch = decide(context_id, table_id, "192.0.2.1")
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    ("completeness", "expected"),
    [("COMPLETE", "NO_ROUTE"), ("PARTIAL", "UNKNOWN"), ("UNKNOWN", "UNKNOWN")],
)
def test_no_matching_route_respects_configured_completeness(
    completeness, expected
):
    context_id, table_id = configured_table(completeness=completeness)

    artifact = decide(context_id, table_id, "203.0.113.9").json()

    assert artifact["result"] == expected
    assert artifact["selected_route_id"] is None
    if expected == "UNKNOWN":
        assert artifact["gaps"][0]["code"] == "ROUTING_TABLE_INCOMPLETE"


def test_partial_table_matching_route_is_still_unknown():
    context_id, table_id = configured_table(completeness="PARTIAL")
    with SessionLocal.begin() as session:
        route = CanonicalRepository(session).add_route(
            table_id, "10.0.0.0/8", "LOCAL"
        )

    artifact = decide(context_id, table_id, "10.20.30.40").json()

    assert artifact["result"] == "UNKNOWN"
    assert artifact["selected_route_id"] is None
    assert ("Route", str(route.id)) in {
        (ref["entity_type"], ref["entity_id"])
        for ref in artifact["evidence_refs"]
    }


@pytest.mark.parametrize("disposition", ["LOCAL", "DISCARD"])
def test_terminal_route_dispositions_are_preserved(disposition):
    context_id, table_id = configured_table()
    with SessionLocal.begin() as session:
        route = CanonicalRepository(session).add_route(
            table_id, "192.0.2.0/24", disposition
        )

    artifact = decide(context_id, table_id, "192.0.2.17").json()

    assert artifact["result"] == disposition
    assert artifact["selected_route_id"] == str(route.id)
    assert artifact["next_hop_candidates"] == []


@pytest.mark.parametrize(
    ("gateway", "with_binding"),
    [("192.0.2.1", False), (None, True), ("192.0.2.1", True)],
    ids=["gateway-only", "egress-only", "gateway-and-egress"],
)
def test_forward_next_hop_forms(gateway, with_binding):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        egress_binding = None
        if with_binding:
            interface = repository.add_network_interface()
            egress_binding = repository.add_l3_binding(interface.id, context.id)
        route = repository.add_route(
            table.id,
            "198.51.100.0/24",
            "FORWARD",
            next_hops=[
                RouteNextHopInput(
                    gateway_address=gateway,
                    egress_l3_binding_id=(
                        egress_binding.id if egress_binding is not None else None
                    ),
                )
            ],
        )
        context_id, table_id = context.id, table.id

    artifact = decide(context_id, table_id, "198.51.100.9").json()

    assert artifact["result"] == "FORWARD"
    assert artifact["selected_route_id"] == str(route.id)
    candidate = artifact["next_hop_candidates"][0]
    assert candidate["gateway_address"] == gateway
    assert candidate["egress_l3_binding_id"] == (
        str(egress_binding.id) if egress_binding is not None else None
    )
    evidence_types = {ref["entity_type"] for ref in artifact["evidence_refs"]}
    assert {"RoutingContext", "RoutingTable", "Route", "RouteNextHop"} <= evidence_types
    assert ("L3Binding" in evidence_types) is with_binding


def test_forward_preserves_all_ecmp_next_hop_candidates():
    context_id, table_id = configured_table()
    with SessionLocal.begin() as session:
        route = CanonicalRepository(session).add_route(
            table_id,
            "203.0.113.0/24",
            "FORWARD",
            next_hops=[
                RouteNextHopInput(gateway_address="192.0.2.1"),
                RouteNextHopInput(gateway_address="192.0.2.2"),
            ],
        )

    artifact = decide(context_id, table_id, "203.0.113.10").json()

    assert artifact["result"] == "FORWARD"
    assert artifact["selected_route_id"] == str(route.id)
    assert {item["gateway_address"] for item in artifact["next_hop_candidates"]} == {
        "192.0.2.1",
        "192.0.2.2",
    }


def test_competing_routes_at_lpm_prefix_are_conflicting():
    context_id, table_id = configured_table()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        first = repository.add_route(table_id, "10.20.0.0/16", "LOCAL")
        second = repository.add_route(table_id, "10.20.0.0/16", "DISCARD")

    artifact = decide(context_id, table_id, "10.20.1.1").json()

    assert artifact["result"] == "CONFLICTING"
    assert artifact["selected_route_id"] is None
    assert artifact["gaps"][0]["code"] == "ROUTE_CONFLICTING"
    assert {
        ref["entity_id"]
        for ref in artifact["evidence_refs"]
        if ref["entity_type"] == "Route"
    } == {str(first.id), str(second.id)}


def test_endpoint_requires_explicit_selected_table_and_context_membership():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        requested_context = repository.add_routing_context()
        other_context = repository.add_routing_context()
        table = repository.add_routing_table(other_context.id, "IPv4", "COMPLETE")

    mismatch = decide(requested_context.id, table.id, "192.0.2.1")
    missing_table = httpx.post(
        f"{BASE_URL}/v1/traces/l3/route-decision",
        json={
            "routing_context_id": str(other_context.id),
            "destination_ip": "192.0.2.1",
        },
        timeout=5,
    )

    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "VALIDATION_ERROR"
    assert missing_table.status_code == 422
    assert missing_table.json()["error"]["code"] == "VALIDATION_ERROR"


def test_corrupt_route_address_family_is_model_error():
    context_id, table_id = configured_table()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        route = repository.add_route(table_id, "192.0.2.0/24", "LOCAL")
        stored = session.get(Route, route.id)
        assert stored is not None
        stored.destination_prefix = "2001:db8::/32"

    response = decide(context_id, table_id, "192.0.2.1")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_corrupt_cross_context_egress_binding_is_model_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        other_context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        interface = repository.add_network_interface()
        binding = repository.add_l3_binding(interface.id, context.id)
        repository.add_route(
            table.id,
            "203.0.113.0/24",
            "FORWARD",
            next_hops=[RouteNextHopInput(egress_l3_binding_id=binding.id)],
        )
        binding.routing_context_id = other_context.id
        context_id, table_id = context.id, table.id

    response = decide(context_id, table_id, "203.0.113.1")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_corrupt_forward_route_without_next_hops_is_model_error():
    context_id, table_id = configured_table()
    with SessionLocal.begin() as session:
        route = Route(
            routing_table_id=table_id,
            destination_prefix="198.51.100.0/24",
            disposition="FORWARD",
        )
        session.add(route)

    response = decide(context_id, table_id, "198.51.100.1")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"
