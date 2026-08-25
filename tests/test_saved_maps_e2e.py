import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import Connection, MapPlacement, MapViewPosition, PhysicalObject, SavedMap
from app.repository import CanonicalRepository, ConnectionMemberInput


client = TestClient(app)


def create_object(name: str) -> dict:
    response = client.post("/v1/topology/physical-objects", json={
        "display_name": name, "initial_connection_point": {"display_name": "p1"},
    })
    assert response.status_code == 201
    return response.json()


def object_id(document: dict) -> str:
    return document["physical_object"]["source_ref"]["entity_id"]


def point_id(document: dict) -> str:
    return document["connection_points"][0]["connection_point_ref"]["entity_id"]


def create_map(name: str) -> dict:
    response = client.post("/v1/maps", json={"name": name})
    assert response.status_code == 201
    return response.json()


def map_id(document: dict) -> str:
    return document["map_ref"]["entity_id"]


def placements(map_identifier: str) -> list[dict]:
    response = client.get(f"/v1/maps/{map_identifier}/placements")
    assert response.status_code == 200
    return response.json()["placements"]


def test_create_list_and_detail_saved_maps_are_empty_and_use_presentation_refs():
    created = create_map("  Серверная  ")
    assert created["name"] == "Серверная"
    assert created["map_ref"] == {"entity_type": "SavedMap", "entity_id": map_id(created)}
    assert created["placements"] == []
    assert "ref_type" not in created["map_ref"]

    listed = client.get("/v1/maps")
    assert listed.status_code == 200
    assert listed.json()["maps"] == [{key: created[key] for key in ("map_ref", "name", "created_at", "updated_at")}]
    assert client.get(f"/v1/maps/{map_id(created)}").json() == created

    duplicate = client.post("/v1/maps", json={"name": "Серверная"})
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["details"]["reason"] == "SAVED_MAP_NAME_CONFLICT"
    assert client.post("/v1/maps", json={"name": "   "}).status_code == 422


def test_placements_are_per_map_and_keep_physical_and_logical_positions_independent():
    physical = create_object("PP1")
    first, second = create_map("Этаж 1"), create_map("Здание")
    first_id, second_id, physical_id = map_id(first), map_id(second), object_id(physical)

    response = client.post(f"/v1/maps/{first_id}/placements", json={
        "physical_object_id": physical_id, "x": 120, "y": 200,
    })
    assert response.status_code == 201
    assert response.json()["placements"] == [{
        "physical_object_ref": {"ref_type": "CANONICAL_FACT", "entity_type": "PhysicalObject", "entity_id": physical_id},
        "positions": {"L1/PHYSICAL_OBJECT": {"x": 120.0, "y": 200.0, "locked": False}},
    }]
    duplicate = client.post(f"/v1/maps/{first_id}/placements", json={
        "physical_object_id": physical_id, "x": 0, "y": 0,
    })
    assert duplicate.status_code == 409

    assert client.post(f"/v1/maps/{second_id}/placements", json={
        "physical_object_id": physical_id, "x": 600, "y": 80,
    }).status_code == 201
    assert placements(second_id)[0]["positions"] == {"L1/PHYSICAL_OBJECT": {"x": 600.0, "y": 80.0, "locked": False}}

    logical = client.put(f"/v1/maps/{first_id}/placements/{physical_id}/positions/logical", json={"x": 300, "y": 120})
    assert logical.status_code == 200
    assert placements(first_id)[0]["positions"] == {
        "L1/PHYSICAL_OBJECT": {"x": 120.0, "y": 200.0, "locked": False},
        "L2/DEVICE": {"x": 300.0, "y": 120.0, "locked": False},
    }
    moved = client.put(f"/v1/maps/{first_id}/placements/{physical_id}", json={"x": 180, "y": 340})
    assert moved.status_code == 200
    assert placements(first_id)[0]["positions"] == {
        "L1/PHYSICAL_OBJECT": {"x": 180.0, "y": 340.0, "locked": False},
        "L2/DEVICE": {"x": 300.0, "y": 120.0, "locked": False},
    }
    assert placements(second_id)[0]["positions"] == {"L1/PHYSICAL_OBJECT": {"x": 600.0, "y": 80.0, "locked": False}}

    for invalid in ({"x": "NaN", "y": 1}, {"x": "Infinity", "y": 1}):
        assert client.put(f"/v1/maps/{first_id}/placements/{physical_id}", json=invalid).status_code == 422
    assert placements(first_id)[0]["positions"]["L1/PHYSICAL_OBJECT"] == {"x": 180.0, "y": 340.0, "locked": False}
    assert client.put(f"/v1/maps/{first_id}/placements/{physical_id}/positions/unknown", json={"x": 1, "y": 2}).status_code == 422
    assert client.put(f"/v1/maps/{first_id}/placements/{uuid.uuid4()}/positions/logical", json={"x": 1, "y": 2}).status_code == 422
    assert client.put(f"/v1/maps/{uuid.uuid4()}/placements/{physical_id}/positions/logical", json={"x": 1, "y": 2}).status_code == 422


def test_per_view_placement_locks_preserve_coordinates_and_validate_scope():
    physical = create_object("SW1")
    saved_map = create_map("Locks")
    saved_map_id, physical_id = map_id(saved_map), object_id(physical)
    assert client.post(f"/v1/maps/{saved_map_id}/placements", json={"physical_object_id": physical_id, "x": 120, "y": 200}).status_code == 201
    assert client.put(f"/v1/maps/{saved_map_id}/placements/{physical_id}/positions/logical", json={"x": 300, "y": 400}).status_code == 200

    locked = client.put(f"/v1/maps/{saved_map_id}/placements/{physical_id}/locks/physical", json={"locked": True})
    assert locked.status_code == 200
    assert placements(saved_map_id)[0]["positions"] == {
        "L1/PHYSICAL_OBJECT": {"x": 120.0, "y": 200.0, "locked": True},
        "L2/DEVICE": {"x": 300.0, "y": 400.0, "locked": False},
    }
    unlocked = client.put(f"/v1/maps/{saved_map_id}/placements/{physical_id}/locks/logical", json={"locked": True})
    assert unlocked.status_code == 200
    assert placements(saved_map_id)[0]["positions"] == {
        "L1/PHYSICAL_OBJECT": {"x": 120.0, "y": 200.0, "locked": True},
        "L2/DEVICE": {"x": 300.0, "y": 400.0, "locked": True},
    }
    assert client.put(f"/v1/maps/{saved_map_id}/placements/{physical_id}/locks/physical", json={"locked": False}).status_code == 200
    assert placements(saved_map_id)[0]["positions"]["L1/PHYSICAL_OBJECT"] == {"x": 120.0, "y": 200.0, "locked": False}
    assert placements(saved_map_id)[0]["positions"]["L2/DEVICE"] == {"x": 300.0, "y": 400.0, "locked": True}

    assert client.put(f"/v1/maps/{saved_map_id}/placements/{physical_id}/locks/unknown", json={"locked": True}).status_code == 422
    assert client.put(f"/v1/maps/{saved_map_id}/placements/{uuid.uuid4()}/locks/physical", json={"locked": True}).status_code == 422
    assert client.put(f"/v1/maps/{uuid.uuid4()}/placements/{physical_id}/locks/physical", json={"locked": True}).status_code == 422


def test_removing_or_deleting_a_map_leaves_canonical_topology_untouched():
    left, right = create_object("left"), create_object("right")
    left_id, right_id = uuid.UUID(object_id(left)), uuid.UUID(object_id(right))
    with SessionLocal.begin() as session:
        CanonicalRepository(session).add_connection(
            uuid.UUID(point_id(left)), uuid.UUID(point_id(right)), 1,
            [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
    saved_map = create_map("Связь")
    saved_map_id = map_id(saved_map)
    assert client.post(f"/v1/maps/{saved_map_id}/placements", json={"physical_object_id": str(left_id), "x": 1, "y": 2}).status_code == 201
    assert client.put(f"/v1/maps/{saved_map_id}/placements/{left_id}/positions/logical", json={"x": 3, "y": 4}).status_code == 200
    assert client.delete(f"/v1/maps/{saved_map_id}/placements/{left_id}").status_code == 204
    with SessionLocal() as session:
        assert session.get(PhysicalObject, left_id) is not None
        assert session.scalar(select(func.count()).select_from(MapViewPosition)) == 0
        assert session.scalar(select(func.count()).select_from(Connection)) == 1

    assert client.post(f"/v1/maps/{saved_map_id}/placements", json={"physical_object_id": str(left_id), "x": 3, "y": 4}).status_code == 201
    assert client.delete(f"/v1/maps/{saved_map_id}").status_code == 204
    with SessionLocal() as session:
        assert session.get(SavedMap, uuid.UUID(saved_map_id)) is None
        assert session.scalar(select(func.count()).select_from(MapPlacement)) == 0
        assert session.scalar(select(func.count()).select_from(MapViewPosition)) == 0
        assert session.get(PhysicalObject, left_id) is not None
        assert session.get(PhysicalObject, right_id) is not None
        assert session.scalar(select(func.count()).select_from(Connection)) == 1


def test_canonical_object_delete_cascades_its_placement_and_unknown_object_is_rejected():
    physical = create_object("standalone")
    saved_map = create_map("Удаление")
    physical_id, saved_map_id = object_id(physical), map_id(saved_map)
    assert client.post(f"/v1/maps/{saved_map_id}/placements", json={"physical_object_id": physical_id, "x": 1, "y": 2}).status_code == 201
    assert client.put(f"/v1/maps/{saved_map_id}/placements/{physical_id}/positions/logical", json={"x": 3, "y": 4}).status_code == 200
    assert client.delete(f"/v1/topology/physical-objects/{physical_id}").status_code == 204
    assert placements(saved_map_id) == []
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapViewPosition)) == 0
    unknown = client.post(f"/v1/maps/{saved_map_id}/placements", json={"physical_object_id": str(uuid.uuid4()), "x": 1, "y": 2})
    assert unknown.status_code == 422


def test_maps_do_not_change_projection_or_l1_trace():
    left, right = create_object("left"), create_object("right")
    with SessionLocal.begin() as session:
        CanonicalRepository(session).add_connection(
            uuid.UUID(point_id(left)), uuid.UUID(point_id(right)), 1,
            [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
    projection_query = {
        "layer": "L1", "detail_level": "PHYSICAL_OBJECT",
        "scope": {"include_location_subtrees": [], "include_entities": []},
    }
    trace_query = {"from": {"point_id": point_id(left), "member_index": 1}, "to": {"point_id": point_id(right), "member_index": 1}}
    before_projection = client.post("/v1/topology/projection", json=projection_query).json()
    before_trace = client.post("/v1/traces/l1", json=trace_query).json()
    saved_map = create_map("Invariant")
    assert client.post(f"/v1/maps/{map_id(saved_map)}/placements", json={"physical_object_id": object_id(left), "x": 10, "y": 20}).status_code == 201
    assert client.put(f"/v1/maps/{map_id(saved_map)}/placements/{object_id(left)}/positions/logical", json={"x": 30, "y": 40}).status_code == 200
    assert client.post("/v1/topology/projection", json=projection_query).json() == before_projection
    assert client.post("/v1/traces/l1", json=trace_query).json() == before_trace
