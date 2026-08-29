import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import (
    Connection,
    ConnectionMember,
    ConnectionPoint,
    InterfaceAddress,
    InterfacePhysicalBinding,
    L2Binding,
    L3Binding,
    PhysicalObject,
)
from app.repository import CanonicalRepository
from app.repository import ConnectionMemberInput
from tests.test_object_blueprints_e2e import create_blueprint, instantiate, slot


client = TestClient(app)


def create_device(name: str, interface_name: str) -> tuple[str, str]:
    response = client.post(
        "/v1/topology/devices",
        json={
            "display_name": name,
            "initial_interface": {"display_name": interface_name},
        },
    )
    assert response.status_code == 201
    document = response.json()
    return (
        document["device"]["source_ref"]["entity_id"],
        document["interfaces"][0]["interface_ref"]["entity_id"],
    )


def create_physical_object(name: str, point_name: str) -> tuple[str, str]:
    response = client.post(
        "/v1/topology/physical-objects",
        json={
            "display_name": name,
            "initial_connection_point": {"display_name": point_name},
        },
    )
    assert response.status_code == 201
    document = response.json()
    return (
        document["physical_object"]["source_ref"]["entity_id"],
        document["connection_points"][0]["connection_point_ref"]["entity_id"],
    )


def interface_endpoint(interface_id: str) -> dict[str, str]:
    return {"kind": "NETWORK_INTERFACE", "network_interface_id": interface_id}


def point_endpoint(point_id: str) -> dict[str, str | int]:
    return {
        "kind": "CONNECTION_POINT",
        "connection_point_id": point_id,
        "member_index": 1,
    }


def connect(source: dict, target: dict, cable_name: str = "cable"):
    return client.post(
        "/v1/topology/physical-connections",
        json={
            "source": source,
            "target": target,
        },
    )


def physical_projection() -> dict:
    response = client.post(
        "/v1/topology/projection",
        json={
            "layer": "L1",
            "detail_level": "PHYSICAL_OBJECT",
            "scope": {"include_location_subtrees": [], "include_entities": []},
        },
    )
    assert response.status_code == 200
    return response.json()


def test_blueprint_patch_panel_internal_pair_allows_one_external_attachment_per_side():
    pc_id, pc_interface_id = create_device("PC1", "eth0")
    switch_id, switch_interface_id = create_device("SW1", "eth1")
    blueprint_id, version_id = create_blueprint([slot("Front01"), slot("Rear01")], [{"from_slot_key": "Front01", "to_slot_key": "Rear01"}], name="Patch panel", body={"kind": "RECTANGLE", "width": 300, "height": 80})
    panel = instantiate(blueprint_id, version_id, "PP1")
    panel_id = panel["physical_object_ref"]["entity_id"]
    front_point, rear_point = [item["connection_point_ref"]["entity_id"] for item in panel["slots"]]

    responses = (
        connect(
            interface_endpoint(pc_interface_id),
            point_endpoint(front_point),
            "cable-1",
        ),
        connect(
            point_endpoint(rear_point),
            interface_endpoint(switch_interface_id),
            "cable-2",
        ),
        connect(
            point_endpoint(front_point),
            point_endpoint(rear_point),
            "cable-3",
        ),
    )
    assert [response.status_code for response in responses] == [201, 201, 422]
    assert responses[2].json()["error"]["details"]["reason"] == "CONNECTION_POINT_MEMBER_OCCUPIED"
    assert responses[0].json()["source"]["interface_binding_ref"]
    assert responses[1].json()["target"]["interface_binding_ref"]

    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection)) == 3
        assert session.scalar(select(func.count()).select_from(ConnectionMember)) == 3
        assert session.scalar(
            select(func.count()).select_from(InterfacePhysicalBinding)
        ) == 2
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 3
        for model in (L2Binding, L3Binding, InterfaceAddress):
            assert session.scalar(select(func.count()).select_from(model)) == 0

    panel = client.get(f"/v1/topology/physical-objects/{panel_id}").json()
    details_by_label = {point["label"]: point for point in panel["connection_points"]}
    assert details_by_label["Front01"]["incident_connection_count"] == 2
    assert details_by_label["Front01"]["external_connection_count"] == 1
    assert details_by_label["Rear01"]["incident_connection_count"] == 2
    assert details_by_label["Rear01"]["external_connection_count"] == 1

    trace = client.post("/v1/traces/l1", json={
        "from": {"point_id": front_point, "member_index": 1},
        "to": {"point_id": rear_point, "member_index": 1},
    })
    assert trace.status_code == 200 and trace.json()["verdict"] == "REACHABLE"

    projection = physical_projection()
    assert {node["label"] for node in projection["nodes"]} == {"PC1", "PP1", "SW1"}
    assert len(projection["edges"]) == 2
    assert all(
        edge["attributes"]["supporting_connection_count"] == 1
        and edge["attributes"]["supporting_member_pair_count"] == 1
        for edge in projection["edges"]
    )



def test_existing_connection_point_member_cannot_be_connected_again():
    _, first_interface = create_device("PC1", "eth0")
    _, second_interface = create_device("SW1", "eth1")
    object_id, point_id = create_physical_object("Outlet1", "Port")

    first = connect(interface_endpoint(first_interface), point_endpoint(point_id), "a")
    second = connect(point_endpoint(point_id), interface_endpoint(second_interface), "b")

    assert first.status_code == 201
    assert second.status_code == 422
    assert second.json()["error"]["details"]["reason"] == "CONNECTION_POINT_MEMBER_OCCUPIED"
    details = client.get(f"/v1/topology/physical-objects/{object_id}").json()
    assert details["connection_points"][0]["incident_connection_count"] == 1


def test_manual_two_sided_outlet_keeps_internal_topology_separate_from_external_occupancy():
    pc_id, pc_interface = create_device("PC1", "eth0")
    switch_id, switch_interface = create_device("SW1", "eth1")
    _, duplicate_interface = create_device("PC2", "eth0")
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        outlet = repository.add_physical_object()
        room = repository.add_connection_point(outlet.id, cardinality=1)
        rear = repository.add_connection_point(outlet.id, cardinality=1)
        repository.add_connection(
            room.id,
            rear.id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )

    first = connect(interface_endpoint(pc_interface), point_endpoint(str(room.id)), "room-cable")
    second = connect(point_endpoint(str(rear.id)), interface_endpoint(switch_interface), "rear-cable")
    duplicate_source = connect(interface_endpoint(duplicate_interface), point_endpoint(str(room.id)), "duplicate")

    assert [first.status_code, second.status_code, duplicate_source.status_code] == [201, 201, 422]
    assert duplicate_source.json()["error"]["details"]["reason"] == "CONNECTION_POINT_MEMBER_OCCUPIED"
    details = client.get(f"/v1/topology/physical-objects/{outlet.id}").json()
    assert {(item["incident_connection_count"], item["external_connection_count"]) for item in details["connection_points"]} == {(2, 1)}
    trace = client.post("/v1/traces/l1", json={
        "from": {"point_id": str(room.id), "member_index": 1},
        "to": {"point_id": str(rear.id), "member_index": 1},
    })
    assert trace.status_code == 200 and trace.json()["verdict"] == "REACHABLE"


def test_disconnect_deletes_cable_and_its_connection_atomically():
    _, source = create_physical_object("Source", "S")
    _, target = create_physical_object("Target", "T")
    created = connect(point_endpoint(source), point_endpoint(target))
    assert created.status_code == 201
    body = created.json()
    assert client.delete(f"/v1/topology/physical-connections/{body['connection_ref']['entity_id']}").status_code == 204
    assert client.delete(f"/v1/cables/{body['cable_ref']['entity_id']}").status_code == 422
