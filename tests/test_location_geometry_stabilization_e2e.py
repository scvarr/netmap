import pytest
from sqlalchemy import select
from app.database import SessionLocal
from app.models import Cable, Connection, ConnectionPoint
from app.location_frame_geometry import contains
from tests.test_base_templates_e2e import create_blueprint, instantiate, slot
from tests.test_map_location_states_e2e import client, location, detail, assign, write
from tests.l1_builders import create_map, create_object_with_point, create_endpoint_cable, put_cable_route
from tests.test_location_container_e2e import state, position, move


def test_pp24_move_response_content_bounds_manual_floor_variants_and_rollback():
    chain = []
    for name in ("8", "808", "823", "U42"):
        chain.append(location(name, chain[-1] if chain else None))
    leaf = chain[-1]
    template, version = create_blueprint([slot(f"p{i}", x=(i+1)/25, y=.5) for i in range(24)], name="PP24", body={"kind": "RECTANGLE", "width": 480, "height": 44})
    created = instantiate(template, version, "PP1")
    obj = created["physical_object_ref"]["entity_id"]
    assign(obj, leaf)
    map_id = create_map(client, "PP24 geometry")
    assert client.post(f"/v1/maps/{map_id}/placements", json={"physical_object_id": obj, "x": 0, "y": 0}).status_code == 201
    doc, frames = state(map_id)
    variant = doc["active_variant_ref"]["entity_id"]
    identity = {s["location_ref"]["entity_id"]: s["boundary_point_id"] for s in doc["location_states"]}
    assert frames[leaf]["width"] == pytest.approx(382)
    assert frames[leaf]["height"] == pytest.approx(250 * 44 / 480 + 60)  # Density floor, composition, Location header/padding.
    copy = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Copy", "source_variant_id": variant}).json()["variant_ref"]["entity_id"]
    copied = detail(map_id, copy)
    other, other_point = create_object_with_point(client, "Other")
    cable = create_endpoint_cable(client, created["slots"][0]["connection_point_ref"]["entity_id"], other_point)
    cable_id = cable["cable_ref"]["entity_id"]
    put_cable_route(client, map_id, cable_id, [{"x": 10, "y": 10}, {"x": 6000, "y": 6000}])
    with SessionLocal() as session:
        canonical = (list(session.scalars(select(Cable.id))), list(session.scalars(select(Connection.id))), list(session.scalars(select(ConnectionPoint.id))))
    url = f"/v1/maps/{map_id}/placements/{obj}/positions/physical?variant_id={variant}"
    for dx, dy in ((5, 3), (800, 0), (0, 800), (-780, -770)):
        before, old_frames = state(map_id)
        old_position = position(before, obj)
        target = {"x": old_position["x"] + dx, "y": old_position["y"] + dy}
        response = client.put(url, json=target)
        assert response.status_code == 200, response.text
        assert response.json() == detail(map_id, variant)
        current, current_frames = state(map_id)
        old_points = before['cable_routes'][0]['waypoints']
        points = current['cable_routes'][0]['waypoints']
        moving_index = 0 if obj < other else 1
        assert points[moving_index] == {**old_points[moving_index], 'x': old_points[moving_index]['x'] + dx, 'y': old_points[moving_index]['y'] + dy}
        assert points[1-moving_index] == old_points[1-moving_index]
        assert position(current, obj)["x"] == target["x"]
        assert position(current, obj)["y"] == target["y"]
        assert contains(current_frames[leaf], dict(target, width=342, height=250 * 44 / 480))
        assert current_frames[leaf]["width"] == pytest.approx(382) and current_frames[leaf]["height"] == pytest.approx(250 * 44 / 480 + 60)
        assert current_frames[leaf]["x"] == target["x"] - 20
        for parent, child in zip(chain, chain[1:]):
            assert contains(current_frames[parent], current_frames[child])
        assert {s["location_ref"]["entity_id"]: s["boundary_point_id"] for s in current["location_states"]} == identity
        assert detail(map_id, copy) == copied
    current, current_frames = state(map_id)
    pos = position(current, obj)
    response = client.put(url, json={"x": pos["x"], "y": pos["y"], "display_width": 480})
    assert response.status_code == 200
    _, resized = state(map_id)
    assert resized[leaf]["width"] == 612 and resized[leaf]["height"] == 104
    manual = dict(resized[leaf], width=800, height=400)
    assert move(map_id, variant, leaf, manual).status_code == 200
    before = detail(map_id)
    manual_area = next(s["manual_bounds"] for s in before["location_states"] if s["location_ref"]["entity_id"] == leaf)
    assert client.put(url, json={"x": pos["x"] + 20, "y": pos["y"] + 20}).status_code == 200
    current, current_frames = state(map_id)
    assert current_frames[leaf]["width"] >= 800 and current_frames[leaf]["height"] >= 400
    assert next(s["manual_bounds"] for s in current["location_states"] if s["location_ref"]["entity_id"] == leaf) == manual_area
    manual_copy = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Manual copy", "source_variant_id": variant}).json()["variant_ref"]["entity_id"]
    copied_manual = detail(map_id, manual_copy)
    assert copied_manual['location_states'] == current['location_states']
    assert client.put(url, json={"x": pos["x"] + 40, "y": pos["y"] + 40}).status_code == 200
    assert detail(map_id, manual_copy) == copied_manual
    current, current_frames = state(map_id)
    expanded = current_frames
    assert write(map_id, variant, chain[0], collapsed=True).status_code == 200
    assert state(map_id)[1] == expanded
    assert write(map_id, variant, chain[0], collapsed=False).status_code == 200
    assert state(map_id)[1] == expanded
    assert client.put(f"/v1/maps/{map_id}/placements/{obj}/locks/physical?variant_id={variant}", json={"locked": True}).status_code == 200
    locked = detail(map_id)
    assert client.put(url, json={"x": 99999, "y": 99999}).status_code == 422
    assert detail(map_id) == locked
    with SessionLocal() as session:
        assert canonical == (list(session.scalars(select(Cable.id))), list(session.scalars(select(Connection.id))), list(session.scalars(select(ConnectionPoint.id))))
