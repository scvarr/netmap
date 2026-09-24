from fastapi.testclient import TestClient
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
    assert routes[ids["cables"]["boundary"]] == [{"x": 140, "y": 50}, {"x": 360, "y": 30}]
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
