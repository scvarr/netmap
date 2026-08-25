import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import Connection, ConnectionMember, MapCableRoute, MapPlacement


client = TestClient(app)


def create_object(name: str) -> dict:
    response = client.post("/v1/topology/physical-objects", json={
        "display_name": name,
        "initial_connection_point": {"display_name": "p1"},
    })
    assert response.status_code == 201
    return response.json()


def object_id(document: dict) -> str:
    return document["physical_object"]["source_ref"]["entity_id"]


def create_cable(name: str = "Cable") -> dict:
    cable = create_object(name)
    assert client.put(
        f"/v1/topology/physical-objects/{object_id(cable)}/class",
        json={"value": "cable"},
    ).status_code == 200
    return cable


def create_device(name: str) -> dict:
    response = client.post("/v1/topology/devices", json={
        "display_name": name,
        "initial_interface": {"display_name": "eth0"},
    })
    assert response.status_code == 201
    return response.json()


def create_simple_cable(name: str) -> str:
    left, right = create_device("Cable endpoint A"), create_device("Cable endpoint B")
    response = client.post("/v1/topology/physical-links", json={
        "source_interface_id": left["interfaces"][0]["interface_ref"]["entity_id"],
        "target_interface_id": right["interfaces"][0]["interface_ref"]["entity_id"],
        "cable_display_name": name,
    })
    assert response.status_code == 201
    return response.json()["cable_ref"]["entity_id"]


def create_map(name: str) -> dict:
    response = client.post("/v1/maps", json={"name": name})
    assert response.status_code == 201
    return response.json()


def route(map_identifier: str, cable_identifier: str, waypoints: list[dict]) -> dict:
    response = client.put(
        f"/v1/maps/{map_identifier}/cable-routes/{cable_identifier}",
        json={"view": "physical", "waypoints": waypoints},
    )
    assert response.status_code == 200
    return response.json()


def map_id(document: dict) -> str:
    return document["map_ref"]["entity_id"]


def test_cable_route_read_is_empty_then_distinguishes_zero_waypoints_from_no_route():
    saved_map = create_map("Routes")
    cable = create_cable()
    saved_map_id, cable_id = map_id(saved_map), object_id(cable)
    assert saved_map["cable_routes"] == []

    stored = route(saved_map_id, cable_id, [])
    assert stored["placements"] == []
    assert stored["cable_routes"] == [{
        "cable_ref": {"ref_type": "CANONICAL_FACT", "entity_type": "PhysicalObject", "entity_id": cable_id},
        "view": "L1/PHYSICAL_OBJECT",
        "waypoints": [],
    }]
    assert client.delete(f"/v1/maps/{saved_map_id}/cable-routes/{cable_id}").status_code == 204
    assert client.get(f"/v1/maps/{saved_map_id}").json()["cable_routes"] == []
    assert client.delete(f"/v1/maps/{saved_map_id}/cable-routes/{cable_id}").status_code == 422


def test_cable_route_replaces_the_full_ordered_list_without_placement_or_topology_mutation():
    saved_map, cable = create_map("Full replace"), create_cable()
    saved_map_id, cable_id = map_id(saved_map), object_id(cable)
    first = [{"x": 20, "y": 10}, {"x": -4, "y": 8}, {"x": 0, "y": 0}]
    with SessionLocal() as session:
        before = (
            session.scalar(select(func.count()).select_from(Connection)),
            session.scalar(select(func.count()).select_from(ConnectionMember)),
            session.scalar(select(func.count()).select_from(MapPlacement)),
        )
    assert route(saved_map_id, cable_id, first)["cable_routes"][0]["waypoints"] == first
    replacement = [{"x": 9.5, "y": -2}]
    assert route(saved_map_id, cable_id, replacement)["cable_routes"][0]["waypoints"] == replacement
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapCableRoute)) == 1
        assert (
            session.scalar(select(func.count()).select_from(Connection)),
            session.scalar(select(func.count()).select_from(ConnectionMember)),
            session.scalar(select(func.count()).select_from(MapPlacement)),
        ) == before


def test_cable_routes_are_per_map_and_survive_unrelated_placement_removal():
    cable = create_cable()
    equipment = create_object("Equipment")
    first, second = create_map("A"), create_map("B")
    cable_id, equipment_id = object_id(cable), object_id(equipment)
    assert route(map_id(first), cable_id, [{"x": 1, "y": 2}])["cable_routes"][0]["waypoints"] == [{"x": 1.0, "y": 2.0}]
    assert route(map_id(second), cable_id, [{"x": 3, "y": 4}])["cable_routes"][0]["waypoints"] == [{"x": 3.0, "y": 4.0}]
    assert client.post(f"/v1/maps/{map_id(first)}/placements", json={"physical_object_id": equipment_id, "x": 1, "y": 2}).status_code == 201
    assert client.delete(f"/v1/maps/{map_id(first)}/placements/{equipment_id}").status_code == 204
    assert client.get(f"/v1/maps/{map_id(first)}").json()["cable_routes"][0]["waypoints"] == [{"x": 1.0, "y": 2.0}]


def test_route_accepts_unresolved_catalog_cable_but_rejects_equipment_and_invalid_scope():
    saved_map = create_map("Validation")
    unresolved = create_cable("Unresolved")
    equipment = create_object("Equipment")
    saved_map_id = map_id(saved_map)
    assert route(saved_map_id, object_id(unresolved), [{"x": 1, "y": 2}])["cable_routes"]
    for target in (object_id(equipment), str(uuid.uuid4())):
        response = client.put(
            f"/v1/maps/{saved_map_id}/cable-routes/{target}",
            json={"view": "physical", "waypoints": []},
        )
        assert response.status_code == 422
    assert client.put(
        f"/v1/maps/{uuid.uuid4()}/cable-routes/{object_id(unresolved)}",
        json={"view": "physical", "waypoints": []},
    ).status_code == 422
    assert client.put(
        f"/v1/maps/{saved_map_id}/cable-routes/{object_id(unresolved)}",
        json={"view": "logical", "waypoints": []},
    ).status_code == 422
    assert client.put(
        f"/v1/maps/{saved_map_id}/cable-routes/{object_id(unresolved)}",
        json={"view": "physical", "waypoints": [{"x": "Infinity", "y": 1}]},
    ).status_code == 422


def test_saved_map_and_canonical_cable_deletes_cascade_route_rows():
    cable_id = create_simple_cable("Cascade")
    first, second = create_map("Delete map"), create_map("Delete cable")
    route(map_id(first), cable_id, [])
    route(map_id(second), cable_id, [])
    assert client.delete(f"/v1/maps/{map_id(first)}").status_code == 204
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapCableRoute)) == 1
    assert client.delete(f"/v1/topology/physical-objects/{cable_id}").status_code == 204
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapCableRoute)) == 0


def test_canonical_delete_removes_only_its_exact_saved_map_presentation():
    deleted_cable_id, surviving_cable_id = create_simple_cable("Delete me"), create_simple_cable("Keep me")
    saved_map = create_map("Selective cleanup")
    saved_map_id = map_id(saved_map)
    route(saved_map_id, deleted_cable_id, [{"x": 1, "y": 2}])
    route(saved_map_id, surviving_cable_id, [{"x": 3, "y": 4}])
    for object_identifier, x in ((deleted_cable_id, 10), (surviving_cable_id, 20)):
        assert client.post(f"/v1/maps/{saved_map_id}/placements", json={"physical_object_id": object_identifier, "x": x, "y": 0}).status_code == 201
    assert client.delete(f"/v1/topology/physical-objects/{deleted_cable_id}").status_code == 204
    detail = client.get(f"/v1/maps/{saved_map_id}").json()
    assert [item["cable_ref"]["entity_id"] for item in detail["cable_routes"]] == [surviving_cable_id]
    assert [item["physical_object_ref"]["entity_id"] for item in detail["placements"]] == [surviving_cable_id]
