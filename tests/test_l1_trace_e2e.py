import os

import httpx
import pytest
from sqlalchemy import delete

from app.database import SessionLocal
from app.models import Connection, ConnectionMember, ConnectionPoint, PhysicalObject
from app.repository import CanonicalRepository, ConnectionMemberInput


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


@pytest.fixture(autouse=True)
def clean_database():
    with SessionLocal.begin() as session:
        session.execute(delete(ConnectionMember))
        session.execute(delete(Connection))
        session.execute(delete(ConnectionPoint))
        session.execute(delete(PhysicalObject))
    yield


@pytest.fixture
def direct_connection_fixture():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        object_a = repository.add_physical_object()
        object_b = repository.add_physical_object()
        point_a = repository.add_connection_point(object_a.id, cardinality=1)
        point_b = repository.add_connection_point(object_b.id, cardinality=1)
        connection, members = repository.add_connection(
            point_a.id,
            point_b.id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        return point_a.id, point_b.id, connection.id, members[0].id


def test_direct_l1_trace_returns_transition_and_canonical_evidence(
    direct_connection_fixture,
):
    point_a_id, point_b_id, connection_id, connection_member_id = direct_connection_fixture

    response = httpx.post(
        f"{BASE_URL}/v1/traces/l1",
        json={
            "from": {"point_id": str(point_a_id), "member_index": 1},
            "to": {"point_id": str(point_b_id), "member_index": 1},
        },
        timeout=5,
    )

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["schema_version"] == 1
    assert artifact["evaluation_view"] == {"mode": "CONFIGURED"}
    assert artifact["resolver_version"] == "l1-direct/1.0"
    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["edges"]) == 1
    transition = artifact["edges"][0]
    assert transition["transition_kind"] == "L1_TRAVERSE"
    assert transition["from_node_id"].endswith(f"{point_a_id}:1")
    assert transition["to_node_id"].endswith(f"{point_b_id}:1")
    expected_refs = {
        ("CANONICAL_FACT", "Connection", str(connection_id)),
        ("CANONICAL_FACT", "ConnectionMember", str(connection_member_id)),
    }
    assert {
        (ref["ref_type"], ref["entity_type"], ref["entity_id"])
        for ref in transition["evidence_refs"]
    } == expected_refs
    assert {
        (ref["ref_type"], ref["entity_type"], ref["entity_id"])
        for ref in artifact["evidence_refs"]
    } == expected_refs


def test_member_above_cardinality_is_validation_error_not_unknown(
    direct_connection_fixture,
):
    point_a_id, point_b_id, _, _ = direct_connection_fixture

    response = httpx.post(
        f"{BASE_URL}/v1/traces/l1",
        json={
            "from": {"point_id": str(point_a_id), "member_index": 2},
            "to": {"point_id": str(point_b_id), "member_index": 1},
        },
        timeout=5,
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["code"] != "UNKNOWN"
    assert body["error"]["details"]["member_index"] == 2
    assert body["error"]["details"]["cardinality"] == 1

