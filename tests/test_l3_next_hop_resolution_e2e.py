import os
import uuid
from types import SimpleNamespace

import httpx
import pytest

from app.database import SessionLocal
from app.models import L3Binding
from app.next_hop_resolver import SelectedTableNextHopResolver
from app.repository import CanonicalRepository, RouteNextHopInput
from app.schemas import (
    EvaluationView,
    NextHopResolutionQuery,
    RouteNextHopCandidate,
)


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def resolve(context_id, table_id, destination_ip):
    return httpx.post(
        f"{BASE_URL}/v1/traces/l3/next-hop-resolution",
        json={
            "routing_context_id": str(context_id),
            "routing_table_id": str(table_id),
            "destination_ip": destination_ip,
        },
        timeout=5,
    )


def configured_table(*, completeness="COMPLETE"):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", completeness)
        interface = repository.add_network_interface()
        binding = repository.add_l3_binding(interface.id, context.id)
        return context.id, table.id, binding.id


def add_forward(table_id, prefix, *next_hops):
    with SessionLocal.begin() as session:
        return CanonicalRepository(session).add_route(
            table_id, prefix, "FORWARD", next_hops=list(next_hops)
        ).id


def branch_refs(branch):
    return {(ref["entity_type"], ref["entity_id"]) for ref in branch["evidence_refs"]}


def test_interface_only_defers_direct_destination_adjacency():
    context_id, table_id, binding_id = configured_table()
    route_id = add_forward(
        table_id,
        "203.0.113.0/24",
        RouteNextHopInput(egress_l3_binding_id=binding_id),
    )

    artifact = resolve(context_id, table_id, "203.0.113.9").json()

    assert artifact["result"] == "RESOLVED"
    assert len(artifact["branches"]) == 1
    branch = artifact["branches"][0]
    assert branch["outcome"] == "RESOLVED"
    assert branch["direct_egress"] == {
        "egress_l3_binding_id": str(binding_id),
        "adjacency_mode": "DIRECT_DESTINATION",
        "gateway_address": None,
        "original_destination": "203.0.113.9",
    }
    assert ("Route", str(route_id)) in branch_refs(branch)
    assert ("L3Binding", str(binding_id)) in branch_refs(branch)


def test_gateway_and_interface_is_direct_without_recursive_lookup():
    context_id, table_id, binding_id = configured_table()
    add_forward(
        table_id,
        "198.51.100.0/24",
        RouteNextHopInput(
            gateway_address="192.0.2.1", egress_l3_binding_id=binding_id
        ),
    )

    artifact = resolve(context_id, table_id, "198.51.100.7").json()

    branch = artifact["branches"][0]
    assert len(branch["lookup_steps"]) == 1
    assert branch["direct_egress"]["egress_l3_binding_id"] == str(binding_id)
    assert branch["direct_egress"]["adjacency_mode"] == "GATEWAY"
    assert branch["direct_egress"]["gateway_address"] == "192.0.2.1"


def test_gateway_only_recurses_once_in_selected_table():
    context_id, table_id, binding_id = configured_table()
    add_forward(
        table_id,
        "198.51.100.0/24",
        RouteNextHopInput(gateway_address="192.0.2.1"),
    )
    add_forward(
        table_id,
        "192.0.2.0/24",
        RouteNextHopInput(egress_l3_binding_id=binding_id),
    )

    branch = resolve(context_id, table_id, "198.51.100.7").json()["branches"][0]

    assert [step["state"]["lookup_address"] for step in branch["lookup_steps"]] == [
        "198.51.100.7",
        "192.0.2.1",
    ]
    assert branch["direct_egress"]["adjacency_mode"] == "GATEWAY"
    assert branch["direct_egress"]["gateway_address"] == "192.0.2.1"


def test_multi_level_recursion_preserves_original_destination():
    context_id, table_id, binding_id = configured_table()
    add_forward(
        table_id,
        "203.0.113.0/24",
        RouteNextHopInput(gateway_address="192.0.2.1"),
    )
    add_forward(
        table_id,
        "192.0.2.1/32",
        RouteNextHopInput(gateway_address="192.0.2.2"),
    )
    add_forward(
        table_id,
        "192.0.2.2/32",
        RouteNextHopInput(egress_l3_binding_id=binding_id),
    )

    branch = resolve(context_id, table_id, "203.0.113.8").json()["branches"][0]

    assert [step["state"]["lookup_address"] for step in branch["lookup_steps"]] == [
        "203.0.113.8",
        "192.0.2.1",
        "192.0.2.2",
    ]
    assert {
        step["state"]["original_destination"] for step in branch["lookup_steps"]
    } == {"203.0.113.8"}
    assert {step["state"]["routing_table_id"] for step in branch["lookup_steps"]} == {
        str(table_id)
    }
    assert branch["direct_egress"]["adjacency_mode"] == "GATEWAY"
    assert branch["direct_egress"]["gateway_address"] == "192.0.2.2"


def test_recursion_never_switches_to_another_table():
    context_id, table_id, binding_id = configured_table()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        other_table = repository.add_routing_table(context_id, "IPv4", "COMPLETE")
        repository.add_route(other_table.id, "192.0.2.1/32", "DISCARD")
        other_table_id = other_table.id
    add_forward(
        table_id,
        "203.0.113.0/24",
        RouteNextHopInput(gateway_address="192.0.2.1"),
    )
    add_forward(
        table_id,
        "192.0.2.0/24",
        RouteNextHopInput(egress_l3_binding_id=binding_id),
    )

    artifact = resolve(context_id, table_id, "203.0.113.8").json()

    assert artifact["result"] == "RESOLVED"
    assert {
        step["state"]["routing_table_id"]
        for step in artifact["branches"][0]["lookup_steps"]
    } == {str(table_id)}
    assert str(other_table_id) not in {
        ref["entity_id"] for ref in artifact["evidence_refs"]
    }


def test_recursive_complete_no_route_is_a_no_route_branch():
    context_id, table_id, _binding_id = configured_table()
    add_forward(
        table_id,
        "203.0.113.0/24",
        RouteNextHopInput(gateway_address="192.0.2.1"),
    )

    branch = resolve(context_id, table_id, "203.0.113.8").json()["branches"][0]

    assert branch["outcome"] == "NO_ROUTE"
    assert branch["lookup_steps"][-1]["route_decision_result"] == "NO_ROUTE"


@pytest.mark.parametrize("completeness", ["PARTIAL", "UNKNOWN"])
def test_incomplete_selected_table_is_unknown(completeness):
    context_id, table_id, _binding_id = configured_table(completeness=completeness)

    artifact = resolve(context_id, table_id, "203.0.113.8").json()

    assert artifact["result"] == "UNKNOWN"
    assert artifact["branches"][0]["outcome"] == "UNKNOWN"


@pytest.mark.parametrize(
    ("disposition", "outcome"),
    [("DISCARD", "DISCARD"), ("LOCAL", "LOCAL_TERMINAL")],
)
def test_recursive_terminal_dispositions_remain_distinct(disposition, outcome):
    context_id, table_id, _binding_id = configured_table()
    add_forward(
        table_id,
        "203.0.113.0/24",
        RouteNextHopInput(gateway_address="192.0.2.1"),
    )
    with SessionLocal.begin() as session:
        CanonicalRepository(session).add_route(
            table_id, "192.0.2.1/32", disposition
        )

    branch = resolve(context_id, table_id, "203.0.113.8").json()["branches"][0]

    assert branch["outcome"] == outcome
    assert branch["direct_egress"] is None
    assert branch["lookup_steps"][-1]["route_decision_result"] == disposition


def test_recursive_competing_routes_are_conflicting():
    context_id, table_id, _binding_id = configured_table()
    add_forward(
        table_id,
        "203.0.113.0/24",
        RouteNextHopInput(gateway_address="192.0.2.1"),
    )
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_route(table_id, "192.0.2.1/32", "LOCAL")
        repository.add_route(table_id, "192.0.2.1/32", "DISCARD")

    branch = resolve(context_id, table_id, "203.0.113.8").json()["branches"][0]

    assert branch["outcome"] == "CONFLICTING"
    assert branch["lookup_steps"][-1]["route_decision_result"] == "CONFLICTING"


def test_recursive_gateway_loop_is_detected_semantically():
    context_id, table_id, _binding_id = configured_table()
    add_forward(
        table_id,
        "203.0.113.0/24",
        RouteNextHopInput(gateway_address="192.0.2.1"),
    )
    add_forward(
        table_id,
        "192.0.2.1/32",
        RouteNextHopInput(gateway_address="192.0.2.2"),
    )
    add_forward(
        table_id,
        "192.0.2.2/32",
        RouteNextHopInput(gateway_address="192.0.2.1"),
    )

    artifact = resolve(context_id, table_id, "203.0.113.8").json()

    assert artifact["result"] == "LOOP_DETECTED"
    assert artifact["branches"][0]["outcome"] == "LOOP_DETECTED"
    assert artifact["branches"][0]["lookup_steps"][-1][
        "route_decision_result"
    ] == "LOOP_DETECTED"


def test_primary_ecmp_preserves_every_direct_branch():
    context_id, table_id, binding_id = configured_table()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        other_binding = repository.add_l3_binding(interface.id, context_id)
        other_binding_id = other_binding.id
    add_forward(
        table_id,
        "203.0.113.0/24",
        RouteNextHopInput(egress_l3_binding_id=binding_id),
        RouteNextHopInput(
            gateway_address="192.0.2.9", egress_l3_binding_id=other_binding_id
        ),
    )

    artifact = resolve(context_id, table_id, "203.0.113.8").json()

    assert len(artifact["branches"]) == 2
    assert {branch["outcome"] for branch in artifact["branches"]} == {"RESOLVED"}
    assert {
        branch["direct_egress"]["egress_l3_binding_id"]
        for branch in artifact["branches"]
    } == {str(binding_id), str(other_binding_id)}


def test_recursive_ecmp_branches_to_all_resolved_candidates():
    context_id, table_id, binding_id = configured_table()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        other_binding = repository.add_l3_binding(interface.id, context_id)
        other_binding_id = other_binding.id
    add_forward(
        table_id,
        "203.0.113.0/24",
        RouteNextHopInput(gateway_address="192.0.2.1"),
    )
    add_forward(
        table_id,
        "192.0.2.1/32",
        RouteNextHopInput(egress_l3_binding_id=binding_id),
        RouteNextHopInput(
            gateway_address="192.0.2.2", egress_l3_binding_id=other_binding_id
        ),
    )

    artifact = resolve(context_id, table_id, "203.0.113.8").json()

    assert len(artifact["branches"]) == 2
    assert all(len(branch["lookup_steps"]) == 2 for branch in artifact["branches"])
    assert {
        branch["direct_egress"]["gateway_address"]
        for branch in artifact["branches"]
    } == {"192.0.2.1", "192.0.2.2"}
    assert {
        branch["direct_egress"]["adjacency_mode"]
        for branch in artifact["branches"]
    } == {"GATEWAY"}


def test_resolved_and_unresolved_ecmp_branches_are_both_preserved():
    context_id, table_id, binding_id = configured_table()
    add_forward(
        table_id,
        "203.0.113.0/24",
        RouteNextHopInput(egress_l3_binding_id=binding_id),
        RouteNextHopInput(gateway_address="192.0.2.1"),
    )

    artifact = resolve(context_id, table_id, "203.0.113.8").json()

    assert artifact["result"] == "RESOLVED"
    assert {branch["outcome"] for branch in artifact["branches"]} == {
        "RESOLVED",
        "NO_ROUTE",
    }


def test_resolved_and_unknown_branches_are_both_preserved():
    context_id = uuid.uuid4()
    table_id = uuid.uuid4()
    binding_id = uuid.uuid4()
    route_id = uuid.uuid4()

    class BranchingDecisionCore:
        def resolve(self, query, _view):
            if str(query.destination_ip) == "203.0.113.8":
                return SimpleNamespace(
                    result="FORWARD",
                    selected_route_id=route_id,
                    next_hop_candidates=[
                        RouteNextHopCandidate(
                            route_next_hop_id=uuid.uuid4(),
                            egress_l3_binding_id=binding_id,
                        ),
                        RouteNextHopCandidate(
                            route_next_hop_id=uuid.uuid4(),
                            gateway_address="192.0.2.1",
                        ),
                    ],
                    evidence_refs=[],
                )
            return SimpleNamespace(
                result="UNKNOWN",
                selected_route_id=None,
                next_hop_candidates=[],
                evidence_refs=[],
            )

    resolver = SelectedTableNextHopResolver.__new__(SelectedTableNextHopResolver)
    resolver.route_decision = BranchingDecisionCore()

    artifact = resolver.resolve(
        NextHopResolutionQuery(
            routing_context_id=context_id,
            routing_table_id=table_id,
            destination_ip="203.0.113.8",
        ),
        EvaluationView(),
    )

    assert artifact.result == "RESOLVED"
    assert {branch.outcome for branch in artifact.branches} == {"RESOLVED", "UNKNOWN"}


def test_existing_cross_context_binding_corruption_remains_model_error():
    context_id, table_id, binding_id = configured_table()
    add_forward(
        table_id,
        "203.0.113.0/24",
        RouteNextHopInput(
            gateway_address="192.0.2.1", egress_l3_binding_id=binding_id
        ),
    )
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        other_context = repository.add_routing_context()
        binding = repository.session.get(L3Binding, binding_id)
        binding.routing_context_id = other_context.id

    response = resolve(context_id, table_id, "203.0.113.8")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"
