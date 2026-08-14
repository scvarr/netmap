import os

import httpx

from app.database import SessionLocal
from app.models import InterfacePhysicalBinding, NetworkInterfaceRealization
from app.repository import CanonicalRepository, ConnectionMemberInput


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def trace_interfaces(source_id, target_id):
    return httpx.post(
        f"{BASE_URL}/v1/traces/interfaces/physical",
        json={
            "from_interface_id": str(source_id),
            "to_interface_id": str(target_id),
        },
        timeout=5,
    )


def test_two_interfaces_directly_connected_through_l1_are_reachable():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        objects = [repository.add_physical_object() for _ in range(2)]
        points = [
            repository.add_connection_point(physical_object.id, cardinality=1)
            for physical_object in objects
        ]
        connection, members = repository.add_connection(
            points[0].id,
            points[1].id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        interfaces = [repository.add_network_interface() for _ in range(2)]
        bindings = [
            repository.add_interface_physical_binding(interfaces[index].id, points[index].id, 1)
            for index in range(2)
        ]
        source_id, target_id = (interface.id for interface in interfaces)
        expected_refs = {
            ("NetworkInterface", str(interfaces[0].id)),
            ("NetworkInterface", str(interfaces[1].id)),
            ("InterfacePhysicalBinding", str(bindings[0].id)),
            ("InterfacePhysicalBinding", str(bindings[1].id)),
            ("Connection", str(connection.id)),
            ("ConnectionMember", str(members[0].id)),
        }

    response = trace_interfaces(source_id, target_id)

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "REACHABLE"
    assert artifact["gaps"] == []
    assert [edge["transition_kind"] for edge in artifact["edges"]] == [
        "INTERFACE_PHYSICAL_BIND",
        "L1_TRAVERSE",
        "INTERFACE_PHYSICAL_BIND",
    ]
    assert {
        (ref["entity_type"], ref["entity_id"])
        for ref in artifact["evidence_refs"]
    } == expected_refs


def test_interfaces_across_passive_pass_through_are_reachable():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        endpoint_a_object = repository.add_physical_object()
        passive_object = repository.add_physical_object()
        endpoint_b_object = repository.add_physical_object()
        points = [
            repository.add_connection_point(endpoint_a_object.id, 1),
            repository.add_connection_point(passive_object.id, 1),
            repository.add_connection_point(passive_object.id, 1),
            repository.add_connection_point(endpoint_b_object.id, 1),
        ]
        l1_ref_ids = set()
        for point_a, point_b in zip(points, points[1:]):
            connection, members = repository.add_connection(
                point_a.id,
                point_b.id,
                cardinality=1,
                members=[
                    ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)
                ],
            )
            l1_ref_ids.update({str(connection.id), str(members[0].id)})
        interfaces = [repository.add_network_interface() for _ in range(2)]
        bindings = [
            repository.add_interface_physical_binding(interfaces[0].id, points[0].id, 1),
            repository.add_interface_physical_binding(interfaces[1].id, points[3].id, 1),
        ]
        source_id, target_id = (interface.id for interface in interfaces)
        expected_ref_ids = l1_ref_ids | {
            str(interfaces[0].id),
            str(interfaces[1].id),
            str(bindings[0].id),
            str(bindings[1].id),
        }

    response = trace_interfaces(source_id, target_id)

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "REACHABLE"
    assert [edge["transition_kind"] for edge in artifact["edges"]] == [
        "INTERFACE_PHYSICAL_BIND",
        "L1_TRAVERSE",
        "L1_TRAVERSE",
        "L1_TRAVERSE",
        "INTERFACE_PHYSICAL_BIND",
    ]
    assert {ref["entity_id"] for ref in artifact["evidence_refs"]} == expected_ref_ids


def test_interface_without_physical_binding_is_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        physical_object = repository.add_physical_object()
        point = repository.add_connection_point(physical_object.id, 1)
        target_binding = repository.add_interface_physical_binding(target.id, point.id, 1)
        source_id = source.id
        target_id = target.id

    response = trace_interfaces(source_id, target_id)

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "UNKNOWN"
    assert artifact["source_binding_candidates"] == []
    assert len(artifact["target_binding_candidates"]) == 1
    assert artifact["target_binding_candidates"][0]["binding_id"] == str(target_binding.id)
    assert artifact["gaps"] == [
        {
            "code": "INTERFACE_PHYSICAL_BINDING_UNKNOWN",
            "node_id": f"interface-state:{source_id}",
            "evidence_refs": [
                {
                    "ref_type": "CANONICAL_FACT",
                    "entity_type": "NetworkInterface",
                    "entity_id": str(source_id),
                }
            ],
        }
    ]


def test_corrupt_binding_above_cardinality_is_model_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        objects = [repository.add_physical_object() for _ in range(2)]
        points = [repository.add_connection_point(obj.id, 1) for obj in objects]
        interfaces = [repository.add_network_interface() for _ in range(2)]
        corrupt_binding = InterfacePhysicalBinding(
            interface_id=interfaces[0].id,
            point_id=points[0].id,
            point_member=2,
        )
        session.add(corrupt_binding)
        repository.add_interface_physical_binding(interfaces[1].id, points[1].id, 1)
        source_id, target_id = (interface.id for interface in interfaces)
        session.flush()
        corrupt_binding_id = corrupt_binding.id

    response = trace_interfaces(source_id, target_id)

    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "MODEL_ERROR"
    assert body["error"]["details"]["binding_id"] == str(corrupt_binding_id)


def test_upper_to_lower_realizations_on_both_sides_are_reachable():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        objects = [repository.add_physical_object() for _ in range(2)]
        points = [repository.add_connection_point(obj.id, 1) for obj in objects]
        connection, members = repository.add_connection(
            points[0].id,
            points[1].id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        source_upper = repository.add_network_interface()
        source_lower = repository.add_network_interface()
        target_upper = repository.add_network_interface()
        target_lower = repository.add_network_interface()
        source_realization = repository.add_network_interface_realization(
            source_upper.id, source_lower.id
        )
        target_realization = repository.add_network_interface_realization(
            target_upper.id, target_lower.id
        )
        source_binding = repository.add_interface_physical_binding(
            source_lower.id, points[0].id, 1
        )
        target_binding = repository.add_interface_physical_binding(
            target_lower.id, points[1].id, 1
        )
        source_id = source_upper.id
        target_id = target_upper.id
        expected_ids = {
            str(source_upper.id),
            str(source_lower.id),
            str(target_upper.id),
            str(target_lower.id),
            str(source_realization.id),
            str(target_realization.id),
            str(source_binding.id),
            str(target_binding.id),
            str(connection.id),
            str(members[0].id),
        }

    response = trace_interfaces(source_id, target_id)

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["branches"]) == 1
    assert len(artifact["source_binding_candidates"][0]["realization_path"]) == 1
    assert len(artifact["target_binding_candidates"][0]["realization_path"]) == 1
    assert [edge["transition_kind"] for edge in artifact["edges"]] == [
        "INTERFACE_REALIZATION_DOWN",
        "INTERFACE_PHYSICAL_BIND",
        "L1_TRAVERSE",
        "INTERFACE_PHYSICAL_BIND",
        "INTERFACE_REALIZATION_UP",
    ]
    assert {ref["entity_id"] for ref in artifact["evidence_refs"]} == expected_ids


def test_multi_level_realization_resolves_to_physical_binding():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        objects = [repository.add_physical_object() for _ in range(2)]
        points = [repository.add_connection_point(obj.id, 1) for obj in objects]
        repository.add_connection(
            points[0].id,
            points[1].id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        source_upper = repository.add_network_interface()
        source_middle = repository.add_network_interface()
        source_lower = repository.add_network_interface()
        target = repository.add_network_interface()
        first = repository.add_network_interface_realization(
            source_upper.id, source_middle.id
        )
        second = repository.add_network_interface_realization(
            source_middle.id, source_lower.id
        )
        repository.add_interface_physical_binding(source_lower.id, points[0].id, 1)
        repository.add_interface_physical_binding(target.id, points[1].id, 1)
        source_id = source_upper.id
        target_id = target.id
        realization_ids = {str(first.id), str(second.id)}

    response = trace_interfaces(source_id, target_id)

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["source_binding_candidates"][0]["realization_path"]) == 2
    assert {
        ref["entity_id"]
        for ref in artifact["evidence_refs"]
        if ref["entity_type"] == "NetworkInterfaceRealization"
    } == realization_ids


def test_branching_realization_preserves_two_candidates_and_reachable_branches():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        objects = [repository.add_physical_object() for _ in range(3)]
        points = [repository.add_connection_point(obj.id, 1) for obj in objects]
        connections = []
        members = []
        for source_point in points[:2]:
            connection, connection_members = repository.add_connection(
                source_point.id,
                points[2].id,
                cardinality=1,
                members=[
                    ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)
                ],
            )
            connections.append(connection)
            members.extend(connection_members)
        source_upper = repository.add_network_interface()
        source_lowers = [repository.add_network_interface() for _ in range(2)]
        target = repository.add_network_interface()
        realizations = [
            repository.add_network_interface_realization(source_upper.id, lower.id)
            for lower in source_lowers
        ]
        source_bindings = [
            repository.add_interface_physical_binding(lower.id, points[index].id, 1)
            for index, lower in enumerate(source_lowers)
        ]
        target_binding = repository.add_interface_physical_binding(target.id, points[2].id, 1)
        source_id = source_upper.id
        target_id = target.id
        required_ids = {
            *(str(realization.id) for realization in realizations),
            *(str(binding.id) for binding in source_bindings),
            str(target_binding.id),
            *(str(connection.id) for connection in connections),
            *(str(member.id) for member in members),
        }

    response = trace_interfaces(source_id, target_id)

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["source_binding_candidates"]) == 2
    assert len(artifact["target_binding_candidates"]) == 1
    assert len(artifact["branches"]) == 2
    assert {
        branch["source_candidate_id"] for branch in artifact["branches"]
    } == {
        candidate["candidate_id"] for candidate in artifact["source_binding_candidates"]
    }
    assert required_ids <= {ref["entity_id"] for ref in artifact["evidence_refs"]}


def test_realization_leaf_without_binding_is_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source_upper = repository.add_network_interface()
        source_leaf = repository.add_network_interface()
        realization = repository.add_network_interface_realization(
            source_upper.id, source_leaf.id
        )
        target = repository.add_network_interface()
        physical_object = repository.add_physical_object()
        target_point = repository.add_connection_point(physical_object.id, 1)
        repository.add_interface_physical_binding(target.id, target_point.id, 1)
        source_id = source_upper.id
        target_id = target.id

    response = trace_interfaces(source_id, target_id)

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "UNKNOWN"
    assert artifact["branches"] == []
    assert artifact["gaps"][0]["code"] == "INTERFACE_PHYSICAL_REALIZATION_UNKNOWN"
    assert any(
        ref["entity_type"] == "NetworkInterfaceRealization"
        and ref["entity_id"] == str(realization.id)
        for ref in artifact["gaps"][0]["evidence_refs"]
    )


def test_corrupt_realization_cycle_is_model_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source_a = repository.add_network_interface()
        source_b = repository.add_network_interface()
        target = repository.add_network_interface()
        session.add_all(
            [
                NetworkInterfaceRealization(
                    upper_interface_id=source_a.id,
                    lower_interface_id=source_b.id,
                ),
                NetworkInterfaceRealization(
                    upper_interface_id=source_b.id,
                    lower_interface_id=source_a.id,
                ),
            ]
        )
        physical_object = repository.add_physical_object()
        point = repository.add_connection_point(physical_object.id, 1)
        repository.add_interface_physical_binding(target.id, point.id, 1)
        source_id = source_a.id
        target_id = target.id

    response = trace_interfaces(source_id, target_id)

    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "MODEL_ERROR"
    assert "realization_id" in body["error"]["details"]
