import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import MapComposite, MapCompositeVisiblePlacement
from tests.l1_builders import create_map, create_object_with_point


client = TestClient(app)


def prepared_map(name="Visible"):
    map_id = create_map(client, name)
    object_ids = [create_object_with_point(client, f"{name}-{index}")[0] for index in range(3)]
    for object_id in object_ids:
        assert client.post(f"/v1/maps/{map_id}/placements", json={"physical_object_id": object_id, "x": 1, "y": 2}).status_code == 201
    composite_id = client.post(f"/v1/maps/{map_id}/composites", json={"name": "Pair", "physical_object_ids": object_ids[:2]}).json()["composite_ref"]["entity_id"]
    return map_id, composite_id, object_ids


def visible(map_id, composite_id):
    detail = client.get(f"/v1/maps/{map_id}").json()
    composite = next(item for item in detail["composites"] if item["composite_ref"]["entity_id"] == composite_id)
    return {item["entity_id"] for item in composite["visible_when_collapsed_refs"]}


def test_visible_members_replace_read_clear_and_are_shared_between_variants():
    map_id, composite_id, objects = prepared_map()
    response = client.put(f"/v1/maps/{map_id}/composites/{composite_id}/visible-members", json={"physical_object_ids": objects[:2]})
    assert response.status_code == 204
    assert visible(map_id, composite_id) == set(objects[:2])
    primary = client.get(f"/v1/maps/{map_id}").json()["active_variant_ref"]["entity_id"]
    variant = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Copy", "source_variant_id": primary}).json()["variant_ref"]["entity_id"]
    assert {item["entity_id"] for item in next(item for item in client.get(f"/v1/maps/{map_id}?variant_id={variant}").json()["composites"] if item["composite_ref"]["entity_id"] == composite_id)["visible_when_collapsed_refs"]} == set(objects[:2])
    assert client.put(f"/v1/maps/{map_id}/composites/{composite_id}/visible-members", json={"physical_object_ids": []}).status_code == 204
    assert visible(map_id, composite_id) == set()


def test_visible_members_reject_nonmember_foreign_and_preserve_existing_set():
    map_id, composite_id, objects = prepared_map("Reject")
    assert client.put(f"/v1/maps/{map_id}/composites/{composite_id}/visible-members", json={"physical_object_ids": [objects[0]]}).status_code == 204
    assert client.put(f"/v1/maps/{map_id}/composites/{composite_id}/visible-members", json={"physical_object_ids": [objects[2]]}).status_code == 422
    foreign_map, _, foreign_objects = prepared_map("Foreign")
    assert client.put(f"/v1/maps/{map_id}/composites/{composite_id}/visible-members", json={"physical_object_ids": [foreign_objects[0]]}).status_code == 422
    assert client.put(f"/v1/maps/{map_id}/composites/{uuid.uuid4()}/visible-members", json={"physical_object_ids": [objects[0]]}).status_code == 422
    assert visible(map_id, composite_id) == {objects[0]}


def test_delete_composite_cascades_visible_members():
    map_id, composite_id, objects = prepared_map("Cascade")
    assert client.put(f"/v1/maps/{map_id}/composites/{composite_id}/visible-members", json={"physical_object_ids": [objects[0]]}).status_code == 204
    assert client.delete(f"/v1/maps/{map_id}/composites/{composite_id}").status_code == 204
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapCompositeVisiblePlacement)) == 0
