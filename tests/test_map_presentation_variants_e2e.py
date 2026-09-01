from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import MapCompositeMember, MapPlacement
from tests.l1_builders import create_interface_cable, create_map, create_object_with_point


client = TestClient(app)


def test_creating_a_layout_copy_clones_only_variant_specific_presentation_state():
    map_id = create_map(client, "Layout source")
    source_id = client.get(f"/v1/maps/{map_id}").json()["active_variant_ref"]["entity_id"]
    left_id, _ = create_object_with_point(client, "Left")
    right_id, _ = create_object_with_point(client, "Right")
    for object_id, x, y, width in ((left_id, 10, 20, 320), (right_id, 30, 40, None)):
        body = {"physical_object_id": object_id, "x": x, "y": y}
        if width is not None:
            body["display_width"] = width
        assert client.post(f"/v1/maps/{map_id}/placements?variant_id={source_id}", json=body).status_code == 201
    assert client.put(f"/v1/maps/{map_id}/placements/{left_id}/positions/logical?variant_id={source_id}", json={"x": 50, "y": 60}).status_code == 200
    assert client.put(f"/v1/maps/{map_id}/placements/{left_id}/locks/physical?variant_id={source_id}", json={"locked": True}).status_code == 200
    cable_id = create_interface_cable(client)["cable_ref"]["entity_id"]
    route = [{"x": 7, "y": 8}]
    assert client.put(f"/v1/maps/{map_id}/cable-routes/{cable_id}?variant_id={source_id}", json={"view": "physical", "waypoints": route}).status_code == 200
    composite = client.post(f"/v1/maps/{map_id}/composites?variant_id={source_id}", json={"name": "Pair", "physical_object_ids": [left_id, right_id]}).json()["composites"][0]
    composite_id = composite["composite_ref"]["entity_id"]
    assert client.put(f"/v1/maps/{map_id}/composites/{composite_id}/presentation?variant_id={source_id}", json={"collapsed": True, "x": 11, "y": 12, "width": 333, "height": 222}).status_code == 200

    copied = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Copy", "source_variant_id": source_id})
    assert copied.status_code == 201, copied.text
    detail = copied.json()
    copy_id = detail["active_variant_ref"]["entity_id"]
    copied_positions = next(item["positions"] for item in detail["placements"] if item["physical_object_ref"]["entity_id"] == left_id)
    assert copied_positions == {"L1/PHYSICAL_OBJECT": {"x": 10, "y": 20, "locked": True, "display_width": 320}, "L2/DEVICE": {"x": 50, "y": 60, "locked": False, "display_width": None}}
    assert detail["cable_routes"][0]["waypoints"] == route
    assert detail["composites"][0]["presentation"] == {"variant_ref": {"entity_type": "MapPresentationVariant", "entity_id": copy_id}, "collapsed": True, "x": 11, "y": 12, "width": 333, "height": 222}
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapPlacement)) == 2
        assert session.scalar(select(func.count()).select_from(MapCompositeMember)) == 2

    assert client.put(f"/v1/maps/{map_id}/placements/{left_id}/positions/physical?variant_id={copy_id}", json={"x": 99, "y": 98, "display_width": 444}).status_code == 200
    assert client.put(f"/v1/maps/{map_id}/cable-routes/{cable_id}?variant_id={copy_id}", json={"view": "physical", "waypoints": []}).status_code == 200
    assert client.put(f"/v1/maps/{map_id}/composites/{composite_id}/presentation?variant_id={copy_id}", json={"collapsed": False, "x": 1, "y": 2, "width": 280, "height": 180}).status_code == 200
    source = client.get(f"/v1/maps/{map_id}?variant_id={source_id}").json()
    source_positions = next(item["positions"] for item in source["placements"] if item["physical_object_ref"]["entity_id"] == left_id)
    assert source_positions["L1/PHYSICAL_OBJECT"] == {"x": 10, "y": 20, "locked": True, "display_width": 320}
    assert source["cable_routes"][0]["waypoints"] == route
    assert source["composites"][0]["presentation"]["collapsed"] is True


def test_layout_copy_rejects_a_source_variant_from_another_saved_map():
    first, second = create_map(client, "First"), create_map(client, "Second")
    foreign_variant = client.get(f"/v1/maps/{second}").json()["active_variant_ref"]["entity_id"]
    response = client.post(f"/v1/maps/{first}/presentation-variants", json={"name": "Invalid", "source_variant_id": foreign_variant})
    assert response.status_code == 422
