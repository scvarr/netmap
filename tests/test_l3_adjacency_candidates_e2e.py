import os

import httpx
import pytest
from sqlalchemy import func, select, text

from app.adjacency_resolver import StructuralAdjacencyResolver
from app.database import SessionLocal
from app.errors import ModelError, ValidationError
from app.models import InterfaceAddress, Route
from app.repository import CanonicalRepository
from app.schemas import AdjacencyCandidatesQuery, EvaluationView


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def adjacency(egress_l3_binding_id, neighbor_target_ip):
    return httpx.post(
        f"{BASE_URL}/v1/traces/l3/adjacency-candidates",
        json={
            "egress_l3_binding_id": str(egress_l3_binding_id),
            "neighbor_target_ip": neighbor_target_ip,
        },
        timeout=5,
    )


def context_with_bindings(count=2):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        bindings = []
        for _ in range(count):
            interface = repository.add_network_interface()
            bindings.append(repository.add_l3_binding(interface.id, context.id))
        return context.id, [(binding.id, binding.interface_id) for binding in bindings]


def add_address(binding_id, address, prefix_length):
    with SessionLocal.begin() as session:
        assignment = CanonicalRepository(session).add_interface_address(
            binding_id, address, prefix_length
        )
        return assignment.id


def evidence_types(artifact):
    return {ref["entity_type"] for ref in artifact["evidence_refs"]}


def test_ipv4_exact_address_returns_structural_candidate():
    context_id, bindings = context_with_bindings()
    source_id, source_interface_id = bindings[0]
    target_id, target_interface_id = bindings[1]
    address_id = add_address(target_id, "192.0.2.1", 24)

    artifact = adjacency(source_id, "192.0.2.1").json()

    assert artifact["result"] == "CANDIDATES_FOUND"
    assert artifact["routing_context_id"] == str(context_id)
    assert artifact["candidates"] == [
        {
            "interface_address_id": str(address_id),
            "target_l3_binding_id": str(target_id),
            "target_network_interface_id": str(target_interface_id),
            "ip_address": "192.0.2.1",
        }
    ]
    refs = {(ref["entity_type"], ref["entity_id"]) for ref in artifact["evidence_refs"]}
    assert ("L3Binding", str(source_id)) in refs
    assert ("NetworkInterface", str(source_interface_id)) in refs
    assert ("InterfaceAddress", str(address_id)) in refs
    assert evidence_types(artifact).isdisjoint({"Route", "RouteNextHop"})


def test_exact_candidate_can_belong_only_to_receiving_routing_context():
    source_context_id, source_bindings = context_with_bindings(count=1)
    receiving_context_id, receiving_bindings = context_with_bindings(count=1)
    source_id = source_bindings[0][0]
    receiving_id = receiving_bindings[0][0]
    address_id = add_address(receiving_id, "192.0.2.2", 24)

    artifact = adjacency(source_id, "192.0.2.2").json()

    assert artifact["result"] == "CANDIDATES_FOUND"
    assert artifact["routing_context_id"] == str(source_context_id)
    assert artifact["candidates"] == [
        {
            "interface_address_id": str(address_id),
            "target_l3_binding_id": str(receiving_id),
            "target_network_interface_id": str(receiving_bindings[0][1]),
            "ip_address": "192.0.2.2",
        }
    ]
    assert receiving_context_id != source_context_id


def test_ipv6_equivalent_text_is_canonicalized_for_exact_lookup():
    _context_id, bindings = context_with_bindings()
    source_id = bindings[0][0]
    target_id = bindings[1][0]
    add_address(target_id, "2001:0db8:0000:0000:0000:0000:0000:0001", 64)

    artifact = adjacency(source_id, "2001:db8::1").json()

    assert artifact["result"] == "CANDIDATES_FOUND"
    assert artifact["candidates"][0]["ip_address"] == "2001:db8::1"


def test_interface_prefix_membership_is_not_an_identity_match():
    _context_id, bindings = context_with_bindings()
    source_id = bindings[0][0]
    add_address(bindings[1][0], "192.0.2.10", 24)

    artifact = adjacency(source_id, "192.0.2.20").json()

    assert artifact["result"] == "UNKNOWN"
    assert artifact["candidates"] == []


def test_same_ip_in_another_routing_context_is_also_a_candidate():
    _context_id, bindings = context_with_bindings()
    source_id = bindings[0][0]
    add_address(bindings[1][0], "192.0.2.1", 24)
    _other_context_id, other_bindings = context_with_bindings(count=1)
    other_address_id = add_address(other_bindings[0][0], "192.0.2.1", 24)

    artifact = adjacency(source_id, "192.0.2.1").json()

    assert len(artifact["candidates"]) == 2
    assert {item["target_l3_binding_id"] for item in artifact["candidates"]} == {
        str(bindings[1][0]),
        str(other_bindings[0][0]),
    }
    assert str(other_address_id) in {
        ref["entity_id"] for ref in artifact["evidence_refs"]
    }


def test_duplicate_ip_in_one_context_preserves_all_candidates():
    _context_id, bindings = context_with_bindings(count=3)
    source_id = bindings[0][0]
    address_ids = {
        add_address(bindings[1][0], "192.0.2.1", 24),
        add_address(bindings[2][0], "192.0.2.1", 30),
    }

    artifact = adjacency(source_id, "192.0.2.1").json()

    assert artifact["result"] == "CANDIDATES_FOUND"
    assert {candidate["interface_address_id"] for candidate in artifact["candidates"]} == {
        str(item) for item in address_ids
    }


def test_missing_interface_address_is_unknown():
    _context_id, bindings = context_with_bindings()

    artifact = adjacency(bindings[0][0], "198.51.100.7").json()

    assert artifact["result"] == "UNKNOWN"
    assert artifact["gaps"][0]["code"] == "INTERFACE_ADDRESS_UNKNOWN"
    assert "UNREACHABLE" not in artifact.values()


def test_one_binding_can_own_multiple_addresses():
    _context_id, bindings = context_with_bindings()
    source_id = bindings[0][0]
    target_id = bindings[1][0]
    add_address(target_id, "192.0.2.1", 24)
    selected_id = add_address(target_id, "198.51.100.1", 27)
    add_address(target_id, "2001:db8::1", 64)

    artifact = adjacency(source_id, "198.51.100.1").json()

    assert [candidate["interface_address_id"] for candidate in artifact["candidates"]] == [
        str(selected_id)
    ]


@pytest.mark.parametrize(
    ("address", "prefix_length"),
    [("192.0.2.1", -1), ("192.0.2.1", 33), ("2001:db8::1", 129)],
)
def test_repository_rejects_invalid_prefix_length(address, prefix_length):
    _context_id, bindings = context_with_bindings(count=1)

    with SessionLocal.begin() as session, pytest.raises(ValidationError):
        CanonicalRepository(session).add_interface_address(
            bindings[0][0], address, prefix_length
        )


@pytest.mark.parametrize("corruption", ["address", "prefix_length"])
def test_canonical_corruption_is_model_error_at_read_boundary(corruption):
    _context_id, bindings = context_with_bindings()
    source_id = bindings[0][0]
    target_id = bindings[1][0]
    address_id = add_address(target_id, "192.0.2.1", 24)
    session = SessionLocal()
    try:
        if corruption == "address":
            session.execute(
                text(
                    "UPDATE interface_addresses "
                    "SET address = CAST('192.0.2.1/24' AS inet) WHERE id = :id"
                ),
                {"id": address_id},
            )
        else:
            session.execute(
                text(
                    "ALTER TABLE interface_addresses DROP CONSTRAINT "
                    "ck_interface_addresses_prefix_length_matches_family"
                )
            )
            session.execute(
                text("UPDATE interface_addresses SET prefix_length = 33 WHERE id = :id"),
                {"id": address_id},
            )
        with pytest.raises(ModelError):
            StructuralAdjacencyResolver(CanonicalRepository(session)).resolve(
                AdjacencyCandidatesQuery(
                    egress_l3_binding_id=source_id,
                    neighbor_target_ip="192.0.2.1",
                ),
                EvaluationView(),
            )
    finally:
        session.rollback()
        session.close()


def test_interface_address_does_not_synthesize_route():
    _context_id, bindings = context_with_bindings(count=1)
    add_address(bindings[0][0], "192.0.2.10", 24)

    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Route)) == 0


def test_unknown_egress_binding_is_validation_error():
    response = adjacency("00000000-0000-0000-0000-000000000001", "192.0.2.1")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
