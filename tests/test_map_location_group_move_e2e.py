from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import Cable, Connection, ConnectionPoint, Location, MapCableRoute, MapLocationState, MapPlacement, MapPresentationVariant, MapViewKey, MapViewPosition, PhysicalObject, SavedMap
from app.saved_map_catalog import SavedMapCatalog


client = TestClient(app)


def scene():
    with SessionLocal.begin() as session:
        room = Location(name="room")
        rack = Location(name="rack", parent=room)
        outside = Location(name="outside")
        session.add_all([room, rack, outside])
        objects = {name: PhysicalObject(location=location) for name, location in [
            ("direct", room), ("hidden", rack), ("external", outside), ("other", outside),
        ]}
        session.add_all(objects.values())
        saved = SavedMap(name="group move")
        session.add(saved)
        session.flush()
        variant = MapPresentationVariant(map_id=saved.id, name="Основной")
        session.add(variant)
        session.flush()
        session.add(MapLocationState(variant_id=variant.id, location_id=rack.id, collapsed=True, visible_direct_elements=[]))
        coordinates = {"direct": (0, 0), "hidden": (0, 100), "external": (500, 0), "other": (500, 300)}
        for name, obj in objects.items():
            placement = MapPlacement(map_id=saved.id, physical_object_id=obj.id)
            placement.view_positions.append(MapViewPosition(variant_id=variant.id, view_key=MapViewKey.PHYSICAL, x=coordinates[name][0], y=coordinates[name][1], display_width=180 if name == "hidden" else None))
            session.add(placement)
        def cable(left, right, waypoints):
            a = ConnectionPoint(physical_object=objects[left], cardinality=1)
            b = ConnectionPoint(physical_object=objects[right], cardinality=1)
            session.add_all([a, b]); session.flush()
            connection = Connection(point_a_id=a.id, point_b_id=b.id, cardinality=1)
            session.add(connection); session.flush()
            identity = Cable(connection_id=connection.id)
            session.add(identity); session.flush()
            if waypoints is not None:
                session.add(MapCableRoute(map_id=saved.id, variant_id=variant.id, cable_id=identity.id, view_key=MapViewKey.PHYSICAL, waypoints=waypoints))
            return identity.id
        internal = cable("direct", "hidden", [{"x": 70, "y": 80}])
        boundary = cable("direct", "external", [{"x": 100, "y": 30}, {"x": 360, "y": 30}])
        external = cable("external", "other", [{"x": 550, "y": 200}])
        no_route = cable("hidden", "external", None)
        return {
            "map": saved.id, "variant": variant.id, "room": room.id, "rack": rack.id,
            "objects": {name: obj.id for name, obj in objects.items()},
            "cables": {"internal": internal, "boundary": boundary, "external": external, "no_route": no_route},
        }


def request(ids, dx=40, dy=20, boundary=True):
    geometry = {"direct": (0, 0), "hidden": (0, 100), "external": (500, 0), "other": (500, 300)}
    payload = {
        "delta_x": dx, "delta_y": dy,
        "frame": {"x": -20, "y": -20, "width": 240, "height": 260},
        "footprints": [{"physical_object_id": str(ids["objects"][name]), "x": x, "y": y, "width": 100, "height": 60} for name, (x, y) in geometry.items()],
        "boundary_routes": [{"cable_id": str(ids["cables"]["boundary"]), "moving_endpoint_is_source": True, "moving_endpoint": {"x": 50, "y": 30}, "external_endpoint": {"x": 500, "y": 30}}] if boundary else [],
    }
    return payload


def move(ids, payload):
    return client.post(f'/v1/maps/{ids["map"]}/presentation-variants/{ids["variant"]}/locations/{ids["room"]}/group-move', json=payload)


def snapshot(ids):
    with SessionLocal() as session:
        positions = dict(session.execute(select(MapPlacement.physical_object_id, MapViewPosition)
            .join(MapViewPosition, MapViewPosition.placement_id == MapPlacement.id)
            .where(MapPlacement.map_id == ids["map"])).all())
        routes = {route.cable_id: route.waypoints for route in session.scalars(select(MapCableRoute).where(MapCableRoute.map_id == ids["map"]))}
        membership = dict(session.execute(select(PhysicalObject.id, PhysicalObject.location_id)).all())
        hierarchy = dict(session.execute(select(Location.id, Location.parent_location_id)).all())
        return {name: (positions[object_id].x, positions[object_id].y, positions[object_id].display_width) for name, object_id in ids["objects"].items()}, routes, membership, hierarchy


def nested_scene(waypoints, reverse=False):
    with SessionLocal.begin() as session:
        parent = Location(name="parent")
        child = Location(name="child", parent=parent)
        outside = Location(name="outside")
        session.add_all([parent, child, outside])
        objects = {name: PhysicalObject(location=location) for name, location in [
            ("child_a", child), ("child_b", child), ("sibling", parent), ("outside", outside),
        ]}
        session.add_all(objects.values())
        saved = SavedMap(name="nested group move")
        session.add(saved); session.flush()
        variant = MapPresentationVariant(map_id=saved.id, name="Основной")
        session.add(variant); session.flush()
        coordinates = {"child_a": (0, 100), "child_b": (200, 100), "sibling": (0, 0), "outside": (900, 0)}
        for name, obj in objects.items():
            placement = MapPlacement(map_id=saved.id, physical_object_id=obj.id)
            placement.view_positions.append(MapViewPosition(variant_id=variant.id, view_key=MapViewKey.PHYSICAL, x=coordinates[name][0], y=coordinates[name][1]))
            session.add(placement)
        first = objects["outside" if reverse else "child_a"]
        second = objects["child_a" if reverse else "outside"]
        point_a = ConnectionPoint(physical_object=first, cardinality=1)
        point_b = ConnectionPoint(physical_object=second, cardinality=1)
        session.add_all([point_a, point_b]); session.flush()
        connection = Connection(point_a_id=point_a.id, point_b_id=point_b.id, cardinality=1)
        session.add(connection); session.flush()
        cable = Cable(connection_id=connection.id)
        session.add(cable); session.flush()
        if waypoints is not None:
            session.add(MapCableRoute(map_id=saved.id, variant_id=variant.id, cable_id=cable.id, view_key=MapViewKey.PHYSICAL, waypoints=waypoints))
        return {"map": saved.id, "variant": variant.id, "room": child.id,
                "objects": {name: obj.id for name, obj in objects.items()}, "cables": {"boundary": cable.id}}


def nested_request(ids, reverse=False):
    coordinates = {"child_a": (0, 100), "child_b": (200, 100), "sibling": (0, 0), "outside": (900, 0)}
    return {"delta_x": 400, "delta_y": 20,
            "frame": {"x": -20, "y": 80, "width": 340, "height": 100},
            "footprints": [{"physical_object_id": str(ids["objects"][name]), "x": x, "y": y, "width": 100, "height": 60} for name, (x, y) in coordinates.items()],
            "boundary_routes": [{"cable_id": str(ids["cables"]["boundary"]), "moving_endpoint_is_source": not reverse,
                                 "moving_endpoint": {"x": 50, "y": 130}, "external_endpoint": {"x": 900, "y": 30}}]}


@pytest.mark.parametrize("waypoints,expected", [
    (None, None),
    ([{"x": 200, "y": 130}, {"x": 400, "y": 130}], [(600, 150), (320, 130), (400, 130)]),
    ([{"x": 200, "y": 130}, {"x": 320, "y": 130}, {"x": 400, "y": 130}], [(600, 150), (320, 130), (400, 130)]),
])
def test_nested_child_move_commits_without_parent_containment_and_keeps_boundary_anchor(waypoints, expected):
    ids = nested_scene(waypoints)
    before = snapshot(ids)
    payload = nested_request(ids)
    if waypoints is None:
        payload["boundary_routes"] = []
    response = move(ids, payload)
    assert response.status_code == 204, response.text
    positions, routes, membership, hierarchy = snapshot(ids)
    assert positions["child_a"][:2] == (400, 120)
    assert positions["child_b"][:2] == (600, 120)
    assert positions["sibling"] == before[0]["sibling"]
    assert positions["outside"] == before[0]["outside"]
    saved_route = routes.get(ids["cables"]["boundary"])
    if expected is None:
        assert saved_route is None
    else:
        assert [(point["x"], point["y"]) for point in saved_route] == expected
        assert saved_route[1]["anchor"] == {"location_id": str(ids["room"]), "edge": "right", "offset": 0.5}
        authoritative = client.get(f'/v1/maps/{ids["map"]}?variant_id={ids["variant"]}')
        assert authoritative.status_code == 200, authoritative.text
        returned_route = next(route for route in authoritative.json()["cable_routes"] if route["cable_ref"]["entity_id"] == str(ids["cables"]["boundary"]))
        assert returned_route["waypoints"][1]["anchor"] == saved_route[1]["anchor"]
    assert membership == before[2] and hierarchy == before[3]


def test_nested_child_boundary_anchor_is_fixed_with_reversed_cable_orientation():
    ids = nested_scene([{"x": 400, "y": 130}, {"x": 320, "y": 130}, {"x": 200, "y": 130}], reverse=True)
    response = move(ids, nested_request(ids, reverse=True))
    assert response.status_code == 204, response.text
    saved_route = snapshot(ids)[1][ids["cables"]["boundary"]]
    assert [(point["x"], point["y"]) for point in saved_route] == [(400, 130), (320, 130), (600, 150)]
    assert saved_route[1]["anchor"] == {"location_id": str(ids["room"]), "edge": "right", "offset": 0.5}


def test_nested_child_route_reentry_still_rejects_atomically():
    ids = nested_scene([{"x": 200, "y": 130}, {"x": 400, "y": 130}, {"x": 200, "y": 130}, {"x": 400, "y": 130}])
    before = snapshot(ids)
    response = move(ids, nested_request(ids))
    assert response.status_code == 422
    assert response.json()["error"]["message"] == "Boundary route cannot be split unambiguously"
    assert snapshot(ids) == before


def test_group_move_rejects_renderer_only_endpoint_side_at_strict_api_boundary():
    ids = nested_scene([{"x": 200, "y": 130}, {"x": 400, "y": 130}])
    before = snapshot(ids)
    payload = nested_request(ids)
    payload["boundary_routes"][0]["moving_endpoint"]["side"] = "right"
    response = move(ids, payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert any(item["loc"][-1] == "side" and item["type"] == "extra_forbidden" for item in error["details"]["errors"])
    assert snapshot(ids) == before


def test_group_move_moves_hidden_descendant_and_internal_route_without_touching_canonical_or_external():
    ids = scene()
    before = snapshot(ids)
    response = move(ids, request(ids))
    assert response.status_code == 204, response.text
    positions, routes, membership, hierarchy = snapshot(ids)
    assert positions["direct"][:2] == (40, 20)
    assert positions["hidden"] == (40, 120, 180)
    assert positions["external"] == before[0]["external"]
    assert routes[ids["cables"]["internal"]] == [{"x": 110, "y": 100}]
    assert routes[ids["cables"]["external"]] == before[1][ids["cables"]["external"]]
    assert [(point["x"], point["y"]) for point in routes[ids["cables"]["boundary"]]] == [(140, 50), (220, 30), (360, 30)]
    assert routes[ids["cables"]["boundary"]][1]["anchor"]["location_id"] == str(ids["room"])
    assert ids["cables"]["no_route"] not in routes
    assert membership == before[2] and hierarchy == before[3]


def test_group_move_rejects_locked_collision_and_ambiguous_route_atomically():
    ids = scene()
    before = snapshot(ids)
    with SessionLocal.begin() as session:
        position = session.scalar(select(MapViewPosition).join(MapPlacement).where(MapPlacement.physical_object_id == ids["objects"]["hidden"]))
        position.locked = True
    assert move(ids, request(ids)).status_code == 422
    with SessionLocal.begin() as session:
        position = session.scalar(select(MapViewPosition).join(MapPlacement).where(MapPlacement.physical_object_id == ids["objects"]["hidden"]))
        position.locked = False
    collision = request(ids, dx=450)
    assert move(ids, collision).status_code == 422
    ambiguous = request(ids)
    ambiguous["frame"] = {"x": -20, "y": -20, "width": 620, "height": 260}
    assert move(ids, ambiguous).status_code == 422
    assert snapshot(ids) == before


def test_group_move_allows_preexisting_overlap_inside_group_and_rejects_route_reentry():
    ids = scene()
    with SessionLocal.begin() as session:
        hidden = session.scalar(select(MapViewPosition).join(MapPlacement).where(MapPlacement.physical_object_id == ids["objects"]["hidden"]))
        hidden.y = 0
    payload = request(ids)
    next(item for item in payload["footprints"] if item["physical_object_id"] == str(ids["objects"]["hidden"]))["y"] = 0
    assert move(ids, payload).status_code == 204
    assert snapshot(ids)[0]["direct"][:2] == snapshot(ids)[0]["hidden"][:2]
    with SessionLocal.begin() as session:
        boundary = session.scalar(select(MapCableRoute).where(MapCableRoute.cable_id == ids["cables"]["boundary"]))
        boundary.waypoints = [{"x": 100, "y": 30}, {"x": 360, "y": 30}, {"x": 100, "y": 30}, {"x": 360, "y": 30}]
    before = snapshot(ids)
    stale = request(ids, dx=10, dy=10)
    for item in stale["footprints"]:
        if item["physical_object_id"] in (str(ids["objects"]["direct"]), str(ids["objects"]["hidden"])):
            item["x"] += 40; item["y"] += 20
    assert move(ids, stale).status_code == 422
    assert snapshot(ids) == before


def test_group_move_changes_only_the_selected_variant():
    ids = scene()
    with SessionLocal.begin() as session:
        copy = SavedMapCatalog(session).create_variant(ids["map"], "Другой", ids["variant"])
        copy_id = copy.id
    assert move(ids, request(ids)).status_code == 204
    with SessionLocal() as session:
        copied = dict(session.execute(select(MapPlacement.physical_object_id, MapViewPosition)
            .join(MapViewPosition, MapViewPosition.placement_id == MapPlacement.id)
            .where(MapPlacement.map_id == ids["map"], MapViewPosition.variant_id == copy_id)).all())
        assert (copied[ids["objects"]["direct"]].x, copied[ids["objects"]["direct"]].y) == (0, 0)
        assert (copied[ids["objects"]["hidden"]].x, copied[ids["objects"]["hidden"]].y) == (0, 100)


def test_group_move_write_failure_rolls_back_positions_and_routes(monkeypatch):
    ids = scene()
    before = snapshot(ids)
    def fail(_self):
        raise RuntimeError("write failed")
    monkeypatch.setattr(SavedMapCatalog, "_flush", fail)
    with TestClient(app, raise_server_exceptions=False) as non_raising:
        response = non_raising.post(f'/v1/maps/{ids["map"]}/presentation-variants/{ids["variant"]}/locations/{ids["room"]}/group-move', json=request(ids))
    assert response.status_code == 500
    assert snapshot(ids) == before


def test_legacy_route_read_does_not_materialize_anchor():
    ids = nested_scene([{"x": 200, "y": 130}, {"x": 400, "y": 130}])
    before = snapshot(ids)
    response = client.get(f'/v1/maps/{ids["map"]}')
    assert response.status_code == 200, response.text
    assert snapshot(ids) == before
    assert before[1][ids["cables"]["boundary"]] == [{"x": 200, "y": 130}, {"x": 400, "y": 130}]


def test_explicit_route_save_persists_boundary_binding_and_variant_copy():
    ids = nested_scene([{"x": 200, "y": 130}, {"x": 400, "y": 130}])
    anchor = {"x": 320, "y": 130, "anchor": {"location_id": str(ids["room"]), "edge": "right", "offset": .5}}
    waypoints = [{"x": 200, "y": 130}, anchor, {"x": 400, "y": 130}]
    response = client.put(f'/v1/maps/{ids["map"]}/cable-routes/{ids["cables"]["boundary"]}?variant_id={ids["variant"]}', json={"view": "physical", "waypoints": waypoints})
    assert response.status_code == 200, response.text
    assert snapshot(ids)[1][ids["cables"]["boundary"]] == waypoints
    with SessionLocal.begin() as session:
        copy = SavedMapCatalog(session).create_variant(ids["map"], "Копия", ids["variant"])
        copy_id = copy.id
    with SessionLocal() as session:
        copied = session.scalar(select(MapCableRoute).where(MapCableRoute.variant_id == copy_id, MapCableRoute.cable_id == ids["cables"]["boundary"]))
        assert copied.waypoints == waypoints


def test_route_normalization_failure_rolls_back_legacy_anchor_and_positions(monkeypatch):
    ids = nested_scene([{"x": 200, "y": 130}, {"x": 400, "y": 130}])
    before = snapshot(ids)
    def fail(*_args):
        raise RuntimeError("route transformation failed")
    monkeypatch.setattr("app.saved_map_catalog.normalize_boundary_route", fail)
    with TestClient(app, raise_server_exceptions=False) as non_raising:
        response = non_raising.post(f'/v1/maps/{ids["map"]}/presentation-variants/{ids["variant"]}/locations/{ids["room"]}/group-move', json=nested_request(ids))
    assert response.status_code == 500
    assert snapshot(ids) == before
