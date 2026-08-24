import os

import httpx

from app.database import SessionLocal
from app.repository import CanonicalRepository, ConnectionMemberInput


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def trace(source_id, target_id, source_point_id=None, target_point_id=None):
    payload = {
        "from_physical_object_id": str(source_id),
        "to_physical_object_id": str(target_id),
    }
    if source_point_id is not None:
        payload["from_connection_point_id"] = str(source_point_id)
    if target_point_id is not None:
        payload["to_connection_point_id"] = str(target_point_id)
    return httpx.post(f"{BASE_URL}/v1/traces/physical-objects/l1", json=payload, timeout=5)


def connect(repository, point_a, point_b):
    return repository.add_connection(
        point_a.id,
        point_b.id,
        cardinality=1,
        members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
    )


def test_physical_objects_direct_l1_path_is_reachable():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source, target = (repository.add_physical_object() for _ in range(2))
        source_point = repository.add_connection_point(source.id, 1)
        target_point = repository.add_connection_point(target.id, 1)
        connection, members = connect(repository, source_point, target_point)
        source_id, target_id = source.id, target.id

    response = trace(source_id, target_id)

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["branches"]) == 1
    assert {ref["entity_id"] for ref in artifact["evidence_refs"]} >= {
        str(source_point.id), str(target_point.id), str(connection.id), str(members[0].id)
    }


def test_unused_connection_points_are_excluded_from_object_candidates():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source, target = (repository.add_physical_object() for _ in range(2))
        unused_source_point = repository.add_connection_point(source.id, 1)
        internally_connected_source_point = repository.add_connection_point(source.id, 1)
        used_source_point = repository.add_connection_point(source.id, 1)
        target_point = repository.add_connection_point(target.id, 1)
        connect(repository, internally_connected_source_point, used_source_point)
        connect(repository, used_source_point, target_point)
        source_id, target_id = source.id, target.id

    artifact = trace(source_id, target_id).json()

    assert artifact["verdict"] == "REACHABLE"
    assert {
        (candidate["point_id"], candidate["member_index"])
        for candidate in artifact["source_candidates"]
    } == {
        (str(internally_connected_source_point.id), 1),
        (str(used_source_point.id), 1),
    }
    assert str(unused_source_point.id) not in {
        candidate["point_id"] for candidate in artifact["source_candidates"]
    }


def test_unused_members_of_connection_point_are_excluded_from_object_candidates():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source, target = (repository.add_physical_object() for _ in range(2))
        source_point = repository.add_connection_point(source.id, 2)
        target_point = repository.add_connection_point(target.id, 1)
        repository.add_connection(
            source_point.id,
            target_point.id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=2, point_b_member=1)],
        )
        source_id, target_id = source.id, target.id

    artifact = trace(source_id, target_id).json()

    assert artifact["source_candidates"] == [
        {"point_id": str(source_point.id), "member_index": 2}
    ]


def test_participating_member_of_exact_connection_point_remains_traceable():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source, target = (repository.add_physical_object() for _ in range(2))
        source_point = repository.add_connection_point(source.id, 2)
        target_point = repository.add_connection_point(target.id, 1)
        repository.add_connection(
            source_point.id,
            target_point.id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=2, point_b_member=1)],
        )
        source_id, target_id, source_point_id = source.id, target.id, source_point.id

    artifact = trace(source_id, target_id, source_point_id=source_point_id).json()

    assert artifact["verdict"] == "REACHABLE"
    assert artifact["branches"][0]["source"] == {
        "point_id": str(source_point_id),
        "member_index": 2,
    }


def test_object_without_participating_members_is_unknown_with_empty_candidates():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source, target = (repository.add_physical_object() for _ in range(2))
        repository.add_connection_point(source.id, 1)
        repository.add_connection_point(target.id, 1)
        source_id, target_id = source.id, target.id

    artifact = trace(source_id, target_id).json()

    assert artifact["verdict"] == "UNKNOWN"
    assert artifact["source_candidates"] == []
    assert artifact["target_candidates"] == []


def test_physical_objects_trace_through_passive_object_without_interfaces():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source, passive, target = (repository.add_physical_object() for _ in range(3))
        points = [
            repository.add_connection_point(source.id, 1),
            repository.add_connection_point(passive.id, 1),
            repository.add_connection_point(passive.id, 1),
            repository.add_connection_point(target.id, 1),
        ]
        for left, right in zip(points, points[1:]):
            connect(repository, left, right)
        source_id, target_id = source.id, target.id

    artifact = trace(source_id, target_id).json()

    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["branches"][0]["edge_ids"]) == 3


def test_multiple_object_endpoint_branches_remain_separate():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source, target = (repository.add_physical_object() for _ in range(2))
        source_points = [repository.add_connection_point(source.id, 1) for _ in range(2)]
        target_points = [repository.add_connection_point(target.id, 1) for _ in range(2)]
        for left, right in zip(source_points, target_points):
            connect(repository, left, right)
        source_id, target_id = source.id, target.id

    artifact = trace(source_id, target_id).json()

    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["source_candidates"]) == 2
    assert len(artifact["target_candidates"]) == 2
    assert len(artifact["branches"]) == 2
    assert len({branch["branch_id"] for branch in artifact["branches"]}) == 2


def test_exact_connection_point_constrains_object_endpoint_candidates():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source, target = (repository.add_physical_object() for _ in range(2))
        source_points = [repository.add_connection_point(source.id, 1) for _ in range(2)]
        target_points = [repository.add_connection_point(target.id, 1) for _ in range(2)]
        for left, right in zip(source_points, target_points):
            connect(repository, left, right)
        source_id, target_id, exact_point_id = source.id, target.id, source_points[1].id

    artifact = trace(source_id, target_id, source_point_id=exact_point_id).json()

    assert artifact["verdict"] == "REACHABLE"
    assert artifact["source_candidates"] == [{"point_id": str(exact_point_id), "member_index": 1}]
    assert len(artifact["branches"]) == 1


def test_connection_point_from_another_object_is_validation_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source, target, other = (repository.add_physical_object() for _ in range(3))
        other_point = repository.add_connection_point(other.id, 1)
        source_id, target_id, other_point_id = source.id, target.id, other_point.id

    response = trace(source_id, target_id, source_point_id=other_point_id)

    assert response.status_code == 422
    assert "does not belong" in response.json()["error"]["message"]


def test_no_proven_object_path_is_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source, target = (repository.add_physical_object() for _ in range(2))
        repository.add_connection_point(source.id, 1)
        repository.add_connection_point(target.id, 1)
        source_id, target_id = source.id, target.id

    artifact = trace(source_id, target_id).json()

    assert artifact["verdict"] == "UNKNOWN"
    assert artifact["branches"] == []
    assert artifact["gaps"][0]["code"] == "L1_TOPOLOGY_INCOMPLETE"


def test_physical_cycle_terminates_and_is_explicitly_reported():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        objects = [repository.add_physical_object() for _ in range(3)]
        points = [repository.add_connection_point(item.id, 1) for item in objects]
        for left, right in ((points[0], points[1]), (points[1], points[2]), (points[2], points[0])):
            connect(repository, left, right)
        source_id, target_id = objects[0].id, objects[1].id

    artifact = trace(source_id, target_id).json()

    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["cycles"]) == 1
    assert len(artifact["cycles"][0]["edge_ids"]) == 3
    assert len(artifact["cycles"][0]["state_node_ids"]) == 4
