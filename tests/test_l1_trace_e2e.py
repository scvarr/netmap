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
    assert artifact["resolver_version"] == "l1-traversal/1.0"
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


def test_multi_hop_trace_traverses_multiple_adjacency_edges():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        objects = [repository.add_physical_object() for _ in range(4)]
        points = [
            repository.add_connection_point(physical_object.id, cardinality=1)
            for physical_object in objects
        ]
        first_connection, first_members = repository.add_connection(
            points[0].id,
            points[1].id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        repository.add_connection(
            points[1].id,
            points[3].id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        second_connection, second_members = repository.add_connection(
            points[1].id,
            points[2].id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        point_ids = [point.id for point in points]
        expected_evidence_ids = {
            str(first_connection.id),
            str(first_members[0].id),
            str(second_connection.id),
            str(second_members[0].id),
        }

    response = httpx.post(
        f"{BASE_URL}/v1/traces/l1",
        json={
            "from": {"point_id": str(point_ids[0]), "member_index": 1},
            "to": {"point_id": str(point_ids[2]), "member_index": 1},
        },
        timeout=5,
    )

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "REACHABLE"
    assert artifact["gaps"] == []
    assert len(artifact["edges"]) == 2
    assert artifact["edges"][0]["from_node_id"].endswith(f"{point_ids[0]}:1")
    assert artifact["edges"][0]["to_node_id"].endswith(f"{point_ids[1]}:1")
    assert artifact["edges"][1]["from_node_id"].endswith(f"{point_ids[1]}:1")
    assert artifact["edges"][1]["to_node_id"].endswith(f"{point_ids[2]}:1")
    assert {ref["entity_id"] for ref in artifact["evidence_refs"]} == expected_evidence_ids


def test_cycle_terminates_and_missing_path_is_unknown_with_typed_gap():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        objects = [repository.add_physical_object() for _ in range(4)]
        points = [
            repository.add_connection_point(physical_object.id, cardinality=1)
            for physical_object in objects
        ]
        for point_a, point_b in (
            (points[0], points[1]),
            (points[1], points[2]),
            (points[2], points[0]),
        ):
            repository.add_connection(
                point_a.id,
                point_b.id,
                cardinality=1,
                members=[
                    ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)
                ],
            )
        source_id = points[0].id
        isolated_target_id = points[3].id

    response = httpx.post(
        f"{BASE_URL}/v1/traces/l1",
        json={
            "from": {"point_id": str(source_id), "member_index": 1},
            "to": {"point_id": str(isolated_target_id), "member_index": 1},
        },
        timeout=5,
    )

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "UNKNOWN"
    assert artifact["verdict"] != "UNREACHABLE"
    assert len(artifact["edges"]) == 2
    assert artifact["gaps"] == [
        {
            "code": "L1_TOPOLOGY_INCOMPLETE",
            "node_id": f"l1-state:{source_id}:1",
            "evidence_refs": [],
        }
    ]


def test_corrupt_connection_member_is_model_error_not_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        object_a = repository.add_physical_object()
        object_b = repository.add_physical_object()
        point_a = repository.add_connection_point(object_a.id, cardinality=1)
        point_b = repository.add_connection_point(object_b.id, cardinality=1)
        connection = Connection(
            point_a_id=point_a.id,
            point_b_id=point_b.id,
            cardinality=1,
        )
        session.add(connection)
        session.flush()
        session.add(
            ConnectionMember(
                connection_id=connection.id,
                index=1,
                point_a_member=1,
                point_b_member=2,
            )
        )
        source_id = point_a.id
        target_id = point_b.id

    response = httpx.post(
        f"{BASE_URL}/v1/traces/l1",
        json={
            "from": {"point_id": str(source_id), "member_index": 1},
            "to": {"point_id": str(target_id), "member_index": 1},
        },
        timeout=5,
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_passive_pass_through_reuses_members_and_returns_all_evidence():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        endpoint_a_object = repository.add_physical_object()
        passive_object = repository.add_physical_object()
        endpoint_b_object = repository.add_physical_object()
        endpoint_a = repository.add_connection_point(endpoint_a_object.id, cardinality=1)
        passive_point_1 = repository.add_connection_point(passive_object.id, cardinality=1)
        passive_point_2 = repository.add_connection_point(passive_object.id, cardinality=1)
        endpoint_b = repository.add_connection_point(endpoint_b_object.id, cardinality=1)

        expected_evidence_ids = set()
        for point_a, point_b in (
            (endpoint_a, passive_point_1),
            (passive_point_1, passive_point_2),
            (passive_point_2, endpoint_b),
        ):
            connection, members = repository.add_connection(
                point_a.id,
                point_b.id,
                cardinality=1,
                members=[
                    ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)
                ],
            )
            expected_evidence_ids.update(
                {str(connection.id), str(members[0].id)}
            )

        endpoint_a_id = endpoint_a.id
        endpoint_b_id = endpoint_b.id
        passive_point_1_id = passive_point_1.id
        passive_point_2_id = passive_point_2.id

    response = httpx.post(
        f"{BASE_URL}/v1/traces/l1",
        json={
            "from": {"point_id": str(endpoint_a_id), "member_index": 1},
            "to": {"point_id": str(endpoint_b_id), "member_index": 1},
        },
        timeout=5,
    )

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "REACHABLE"
    assert artifact["gaps"] == []
    assert len(artifact["edges"]) == 3
    assert [edge["from_node_id"] for edge in artifact["edges"]] == [
        f"l1-state:{endpoint_a_id}:1",
        f"l1-state:{passive_point_1_id}:1",
        f"l1-state:{passive_point_2_id}:1",
    ]
    assert [edge["to_node_id"] for edge in artifact["edges"]] == [
        f"l1-state:{passive_point_1_id}:1",
        f"l1-state:{passive_point_2_id}:1",
        f"l1-state:{endpoint_b_id}:1",
    ]
    assert {ref["entity_id"] for ref in artifact["evidence_refs"]} == expected_evidence_ids


def test_corrupt_connection_cardinality_is_model_error_not_trace():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        object_a = repository.add_physical_object()
        object_b = repository.add_physical_object()
        point_a = repository.add_connection_point(object_a.id, cardinality=2)
        point_b = repository.add_connection_point(object_b.id, cardinality=2)
        connection = Connection(
            point_a_id=point_a.id,
            point_b_id=point_b.id,
            cardinality=2,
        )
        session.add(connection)
        session.flush()
        session.add(
            ConnectionMember(
                connection_id=connection.id,
                index=1,
                point_a_member=1,
                point_b_member=1,
            )
        )
        source_id = point_a.id
        target_id = point_b.id
        connection_id = connection.id

    response = httpx.post(
        f"{BASE_URL}/v1/traces/l1",
        json={
            "from": {"point_id": str(source_id), "member_index": 1},
            "to": {"point_id": str(target_id), "member_index": 1},
        },
        timeout=5,
    )

    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "MODEL_ERROR"
    assert body["error"]["details"] == {
        "connection_id": str(connection_id),
        "cardinality": 2,
        "member_count": 1,
    }
