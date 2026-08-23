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
            "cable_display_name": cable_name,
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


def test_endpoint_connections_build_reusable_passive_l1_chain():
    pc_id, pc_interface_id = create_device("PC1", "eth0")
    outlet_id, outlet_point_id = create_physical_object("Outlet1", "Port")
    panel_id, panel_point_id = create_physical_object("PP1", "Port01")
    switch_id, switch_interface_id = create_device("SW1", "eth1")

    responses = (
        connect(
            interface_endpoint(pc_interface_id),
            point_endpoint(outlet_point_id),
            "cable-1",
        ),
        connect(
            point_endpoint(outlet_point_id),
            point_endpoint(panel_point_id),
            "cable-2",
        ),
        connect(
            point_endpoint(panel_point_id),
            interface_endpoint(switch_interface_id),
            "cable-3",
        ),
    )
    assert [response.status_code for response in responses] == [201, 201, 201]
    assert [response.json()["source"]["kind"] for response in responses] == [
        "NETWORK_INTERFACE",
        "CONNECTION_POINT",
        "CONNECTION_POINT",
    ]
    assert responses[0].json()["source"]["interface_binding_ref"]
    assert "interface_binding_ref" not in responses[0].json()["target"]
    assert responses[2].json()["target"]["interface_binding_ref"]
    assert all(len(response.json()["connection_refs"]) == 3 for response in responses)

    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection)) == 9
        assert session.scalar(select(func.count()).select_from(ConnectionMember)) == 9
        assert session.scalar(
            select(func.count()).select_from(InterfacePhysicalBinding)
        ) == 2
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 7
        for model in (L2Binding, L3Binding, InterfaceAddress):
            assert session.scalar(select(func.count()).select_from(model)) == 0

    outlet = client.get(f"/v1/topology/physical-objects/{outlet_id}").json()
    panel = client.get(f"/v1/topology/physical-objects/{panel_id}").json()
    assert outlet["connection_points"][0]["incident_connection_count"] == 2
    assert panel["connection_points"][0]["incident_connection_count"] == 2

    projection = physical_projection()
    assert {node["label"] for node in projection["nodes"]} == {
        "PC1",
        "Outlet1",
        "PP1",
        "SW1",
        "cable-1",
        "cable-2",
        "cable-3",
    }
    assert len(projection["edges"]) == 6
    assert all(
        edge["attributes"]["supporting_connection_count"] == 1
        and edge["attributes"]["supporting_member_pair_count"] == 1
        for edge in projection["edges"]
    )

    trace = client.post(
        "/v1/traces/interfaces/physical",
        json={
            "from_interface_id": pc_interface_id,
            "to_interface_id": switch_interface_id,
        },
    )
    assert trace.status_code == 200
    assert trace.json()["verdict"] == "REACHABLE"
    assert {pc_id, outlet_id, panel_id, switch_id} <= {
        ref["entity_id"]
        for node in projection["nodes"]
        for ref in node["source_refs"]
        if ref["entity_type"] == "PhysicalObject"
    }


def test_existing_connection_point_can_be_connected_again():
    _, first_interface = create_device("PC1", "eth0")
    _, second_interface = create_device("SW1", "eth1")
    object_id, point_id = create_physical_object("Outlet1", "Port")

    first = connect(interface_endpoint(first_interface), point_endpoint(point_id), "a")
    second = connect(point_endpoint(point_id), interface_endpoint(second_interface), "b")

    assert first.status_code == 201
    assert second.status_code == 201
    details = client.get(f"/v1/topology/physical-objects/{object_id}").json()
    assert details["connection_points"][0]["incident_connection_count"] == 2


def test_endpoint_connection_materializes_exact_simple_cable_blueprint():
    blueprint = client.post("/v1/library/object-blueprints", json={"name": "Thin cable", "body": {"kind": "RECTANGLE", "width": 120, "height": 6, "fill_color": "#123456"}, "slots": [{"key": "A", "display_name": "A", "kind": "CONNECTION_POINT", "anchor": {"side": "LEFT", "offset": .5}}, {"key": "B", "display_name": "B", "kind": "CONNECTION_POINT", "anchor": {"side": "RIGHT", "offset": .5}}], "internal_links": [{"from_slot_key": "A", "to_slot_key": "B"}]}).json()
    source_id, source_point = create_physical_object("Source", "S")
    target_id, target_point = create_physical_object("Target", "T")
    response = client.post("/v1/topology/physical-connections", json={"source": point_endpoint(source_point), "target": point_endpoint(target_point), "cable_display_name": "cable-01", "cable_blueprint": {"blueprint_id": blueprint["blueprint_ref"]["entity_id"], "version_id": blueprint["version_ref"]["entity_id"]}})
    assert response.status_code == 201, response.text
    created = response.json()
    assert len(created["connection_refs"]) == 3
    projection = physical_projection()
    cable = next(node for node in projection["nodes"] if any(ref["entity_id"] == created["cable_ref"]["entity_id"] for ref in node["source_refs"]))
    assert cable["attributes"]["blueprint_presentation"]["version_ref"]["entity_id"] == blueprint["version_ref"]["entity_id"]
    trace = client.post("/v1/traces/l1", json={"from": {"point_id": source_point, "member_index": 1}, "to": {"point_id": target_point, "member_index": 1}})
    assert trace.status_code == 200 and trace.json()["verdict"] == "REACHABLE"


def test_endpoint_connection_rejects_same_or_unknown_connection_point():
    _, point_id = create_physical_object("Outlet1", "Port")

    same = connect(point_endpoint(point_id), point_endpoint(point_id))
    unknown = connect(point_endpoint(point_id), point_endpoint(str(uuid.uuid4())))

    assert same.status_code == 422
    assert "two different endpoints" in same.json()["error"]["message"]
    assert unknown.status_code == 422
    assert unknown.json()["error"]["message"] == "ConnectionPoint does not exist"
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection)) == 0


def test_endpoint_connection_rejects_rebinding_network_interface():
    _, interface_id = create_device("PC1", "eth0")
    _, first_point = create_physical_object("Outlet1", "Port")
    _, second_point = create_physical_object("Outlet2", "Port")
    assert connect(interface_endpoint(interface_id), point_endpoint(first_point)).status_code == 201

    response = connect(interface_endpoint(interface_id), point_endpoint(second_point))

    assert response.status_code == 422
    assert "already has a direct physical binding" in response.json()["error"]["message"]
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection)) == 3


def test_endpoint_connection_rejects_non_cardinality_one_point():
    _, valid_point = create_physical_object("Outlet1", "Port")
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        other_object = repository.add_physical_object()
        unsupported_point = repository.add_connection_point(other_object.id, cardinality=2)
        unsupported_point_id = str(unsupported_point.id)

    response = connect(point_endpoint(valid_point), point_endpoint(unsupported_point_id))

    assert response.status_code == 422
    assert "cardinality=1" in response.json()["error"]["message"]
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection)) == 0


def test_endpoint_connection_rolls_back_mid_operation(monkeypatch):
    _, interface_id = create_device("PC1", "eth0")
    _, point_id = create_physical_object("Outlet1", "Port")
    original = CanonicalRepository.add_connection
    calls = 0

    def fail_on_second_connection(self, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("injected endpoint connection failure")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(CanonicalRepository, "add_connection", fail_on_second_connection)
    non_raising_client = TestClient(app, raise_server_exceptions=False)
    response = non_raising_client.post(
        "/v1/topology/physical-connections",
        json={
            "source": interface_endpoint(interface_id),
            "target": point_endpoint(point_id),
            "cable_display_name": "cable-1",
        },
    )

    assert response.status_code == 500
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection)) == 0
        assert session.scalar(
            select(func.count()).select_from(InterfacePhysicalBinding)
        ) == 0
        assert session.scalar(select(func.count()).select_from(ConnectionPoint)) == 1
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 2
