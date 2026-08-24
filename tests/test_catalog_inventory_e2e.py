from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.device_catalog import DeviceCatalog
from app.main import app
from app.repository import CanonicalRepository, ConnectionMemberInput
from app.saved_map_catalog import SavedMapCatalog


client = TestClient(app)


def inventory() -> dict:
    response = client.get("/v1/catalog/inventory")
    assert response.status_code == 200
    return response.json()


def test_inventory_separates_cables_and_bulk_materializes_equipment_occupancy_and_maps():
    with SessionLocal.begin() as session:
        repository, catalog = CanonicalRepository(session), DeviceCatalog(session)
        switch = catalog.create_physical_object("SW1", "A01")
        catalog.set_physical_object_class(switch.physical_object_id, "switch")
        switch_points = [switch.connection_point_id] + [catalog.create_connection_point(switch.physical_object_id, f"A{index:02}").connection_point_id for index in range(2, 53)]
        for index in range(17):
            remote = catalog.create_physical_object(f"Remote {index}", "P")
            repository.add_connection(switch_points[index], remote.connection_point_id, 1, [ConnectionMemberInput(1, 1, 1)])
        repository.add_connection(switch_points[17], switch_points[18], 1, [ConnectionMemberInput(1, 1, 1)])
        mixed = catalog.create_physical_object("Mixed", "M1")
        from app.models import ConnectionPoint
        session.get(ConnectionPoint, mixed.connection_point_id).cardinality = 2
        map_a, map_b = SavedMapCatalog(session).create("A map"), SavedMapCatalog(session).create("B map")
        SavedMapCatalog(session).add_placement(map_b.id, switch.physical_object_id, 1, 1)
        SavedMapCatalog(session).add_placement(map_a.id, switch.physical_object_id, 2, 2)
        cable = catalog.create_physical_object("C-001", "C1")
        catalog.set_physical_object_class(cable.physical_object_id, "cable")
        cable_second = catalog.create_connection_point(cable.physical_object_id, "C2")
        left, right = catalog.create_physical_object("Left", "L1"), catalog.create_physical_object("Right", "R1")
        repository.add_connection(left.connection_point_id, cable.connection_point_id, 1, [ConnectionMemberInput(1, 1, 1)])
        repository.add_connection(cable_second.connection_point_id, right.connection_point_id, 1, [ConnectionMemberInput(1, 1, 1)])
        unresolved = catalog.create_physical_object("Broken", "C1")
        catalog.set_physical_object_class(unresolved.physical_object_id, "cable")
        catalog.create_connection_point(unresolved.physical_object_id, "C2")
        catalog.create_connection_point(unresolved.physical_object_id, "C3")

    document = inventory()
    assert document == inventory()  # output order is deterministic
    equipment = {item["label"]: item for item in document["equipment"]}
    assert equipment["SW1"]["class"] == "switch"
    assert equipment["SW1"]["occupancy"] == {"total_ports": 52, "connected_ports": 17, "free_ports": 35}
    assert [membership["name"] for membership in equipment["SW1"]["map_memberships"]] == ["A map", "B map"]
    assert equipment["Remote 0"]["map_memberships"] == []
    assert "occupancy" not in equipment["Mixed"]
    cables = {item["label"]: item for item in document["cables"]}
    simple = cables["C-001"]
    assert simple["resolution"] == "SIMPLE_CABLE"
    assert {(endpoint["remote_physical_object_label"], endpoint["remote_connection_point_label"]) for endpoint in (simple["endpoint_a"], simple["endpoint_b"])} == {("Left", "L1"), ("Right", "R1")}
    assert all(len(endpoint["evidence_refs"]) == 2 for endpoint in (simple["endpoint_a"], simple["endpoint_b"]))
    assert cables["Broken"]["resolution"] == "UNRESOLVED"
    assert "endpoint_a" not in cables["Broken"] and "endpoint_b" not in cables["Broken"]


def test_inventory_uses_technical_fallback_when_display_alias_is_absent():
    with SessionLocal.begin() as session:
        object_id = CanonicalRepository(session).add_physical_object().id
    item = next(value for value in inventory()["equipment"] if value["physical_object_ref"]["entity_id"] == str(object_id))
    assert item["label"] == f"PhysicalObject {str(object_id)[:8]}"
    assert item["label_source"] == "TECHNICAL_FALLBACK"
