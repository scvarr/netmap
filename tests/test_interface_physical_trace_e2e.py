import os

import httpx

from app.database import SessionLocal
from app.models import InterfacePhysicalBinding
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

