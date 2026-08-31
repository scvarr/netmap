import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import Location, PhysicalObject
from tests.l1_builders import create_map, create_object_with_point


client = TestClient(app)


def create_location(
    name: str,
    *,
    type_: str | None = None,
    parent_location_id: str | None = None,
) -> dict:
    payload: dict[str, object] = {"name": name}
    if type_ is not None:
        payload["type"] = type_
    if parent_location_id is not None:
        payload["parent_location_id"] = parent_location_id
    response = client.post("/v1/locations", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_locations_persist_trimmed_arbitrary_types_and_expose_explicit_hierarchy():
    root = create_location("  Campus North  ", type_="  arbitrary/site-label  ")
    root_id = root["location_ref"]["entity_id"]
    child = create_location("  Room 101  ", type_=" anything:42 / custom ", parent_location_id=root_id)
    child_id = child["location_ref"]["entity_id"]

    assert root == {
        "location_ref": {"ref_type": "CANONICAL_FACT", "entity_type": "Location", "entity_id": root_id},
        "name": "Campus North",
        "type": "arbitrary/site-label",
    }
    assert child == {
        "location_ref": {"ref_type": "CANONICAL_FACT", "entity_type": "Location", "entity_id": child_id},
        "name": "Room 101",
        "type": "anything:42 / custom",
        "parent_location_ref": {"ref_type": "CANONICAL_FACT", "entity_type": "Location", "entity_id": root_id},
    }

    listed = client.get("/v1/locations")
    assert listed.status_code == 200
    assert {entry["location_ref"]["entity_id"]: entry for entry in listed.json()["locations"]} == {
        root_id: root,
        child_id: child,
    }
    with SessionLocal() as session:
        stored_root = session.get(Location, uuid.UUID(root_id))
        stored_child = session.get(Location, uuid.UUID(child_id))
        assert stored_root is not None and stored_root.name == "Campus North"
        assert stored_root.type == "arbitrary/site-label"
        assert stored_child is not None and stored_child.parent_location_id == stored_root.id
        assert stored_child.type == "anything:42 / custom"

    updated = client.put(
        f"/v1/locations/{child_id}", json={"name": "  Cabinet A  ", "type": None}
    )
    assert updated.status_code == 200
    assert updated.json() == {
        "location_ref": child["location_ref"],
        "name": "Cabinet A",
        "parent_location_ref": child["parent_location_ref"],
    }


def test_location_reparent_rejects_self_and_indirect_cycles_without_changing_hierarchy():
    root = create_location("Root")
    root_id = root["location_ref"]["entity_id"]
    middle = create_location("Middle", parent_location_id=root_id)
    middle_id = middle["location_ref"]["entity_id"]
    leaf = create_location("Leaf", parent_location_id=middle_id)
    leaf_id = leaf["location_ref"]["entity_id"]

    self_parent = client.put(
        f"/v1/locations/{middle_id}/parent", json={"parent_location_id": middle_id}
    )
    assert self_parent.status_code == 422
    cycle = client.put(
        f"/v1/locations/{root_id}/parent", json={"parent_location_id": leaf_id}
    )
    assert cycle.status_code == 422
    assert cycle.json()["error"]["details"]["reason"] == "LOCATION_HIERARCHY_CYCLE"

    assert client.get(f"/v1/locations/{root_id}").json() == root
    assert client.get(f"/v1/locations/{middle_id}").json() == middle
    assert client.get(f"/v1/locations/{leaf_id}").json() == leaf

    detached = client.put(f"/v1/locations/{leaf_id}/parent", json={"parent_location_id": None})
    assert detached.status_code == 200
    assert "parent_location_ref" not in detached.json()


def test_physical_object_location_assignment_and_clear_are_explicit_and_presentation_independent():
    location = create_location("Equipment zone")
    location_id = location["location_ref"]["entity_id"]
    object_id, _ = create_object_with_point(client, "Object with location")

    assigned = client.put(
        f"/v1/topology/physical-objects/{object_id}/location", json={"location_id": location_id}
    )
    assert assigned.status_code == 200
    assert assigned.json()["location_ref"] == location["location_ref"]

    map_id = create_map(client, "Location does not follow map")
    assert client.post(
        f"/v1/maps/{map_id}/placements", json={"physical_object_id": object_id, "x": 1, "y": 2}
    ).status_code == 201
    assert client.put(
        f"/v1/maps/{map_id}/placements/{object_id}", json={"x": 100, "y": 200}
    ).status_code == 200
    read_after_move = client.get(f"/v1/topology/physical-objects/{object_id}/location")
    assert read_after_move.status_code == 200
    assert read_after_move.json()["location_ref"] == location["location_ref"]

    cleared = client.put(
        f"/v1/topology/physical-objects/{object_id}/location", json={"location_id": None}
    )
    assert cleared.status_code == 200
    assert "location_ref" not in cleared.json()
    with SessionLocal() as session:
        assert session.get(PhysicalObject, uuid.UUID(object_id)).location_id is None


def test_location_deletion_reports_child_and_assignment_conflicts_without_side_effects():
    parent = create_location("Parent")
    parent_id = parent["location_ref"]["entity_id"]
    child = create_location("Child", parent_location_id=parent_id)
    child_id = child["location_ref"]["entity_id"]

    child_conflict = client.delete(f"/v1/locations/{parent_id}")
    assert child_conflict.status_code == 409
    assert child_conflict.json()["error"]["details"]["reason"] == "LOCATION_HAS_CHILDREN"
    assert client.get(f"/v1/locations/{parent_id}").status_code == 200
    assert client.get(f"/v1/locations/{child_id}").status_code == 200

    object_id, _ = create_object_with_point(client, "Located object")
    assert client.put(
        f"/v1/topology/physical-objects/{object_id}/location", json={"location_id": child_id}
    ).status_code == 200
    object_conflict = client.delete(f"/v1/locations/{child_id}")
    assert object_conflict.status_code == 409
    assert object_conflict.json()["error"]["details"]["reason"] == "LOCATION_HAS_ASSIGNED_PHYSICAL_OBJECTS"
    assert client.get(f"/v1/topology/physical-objects/{object_id}/location").json()["location_ref"] == child["location_ref"]

    assert client.put(
        f"/v1/topology/physical-objects/{object_id}/location", json={"location_id": None}
    ).status_code == 200
    assert client.delete(f"/v1/locations/{child_id}").status_code == 204
    assert client.delete(f"/v1/locations/{parent_id}").status_code == 204
    with SessionLocal() as session:
        assert tuple(session.scalars(select(Location))) == ()
