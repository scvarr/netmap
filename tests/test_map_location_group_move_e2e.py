from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import Cable, Connection, ConnectionPoint, Location, MapLocationState, MapPlacement, MapPresentationVariant, MapViewKey, MapViewPosition, PhysicalObject, SavedMap
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
        def cable(left, right):
            a = ConnectionPoint(physical_object=objects[left], cardinality=1)
            b = ConnectionPoint(physical_object=objects[right], cardinality=1)
            session.add_all([a, b]); session.flush()
            connection = Connection(point_a_id=a.id, point_b_id=b.id, cardinality=1)
            session.add(connection); session.flush()
            identity = Cable(connection_id=connection.id)
            session.add(identity); session.flush()
            return identity.id
        crossing = cable("direct", "external")
        return {
            "map": saved.id, "variant": variant.id, "room": room.id, "rack": rack.id,
            "crossing": crossing,
            "objects": {name: obj.id for name, obj in objects.items()},
        }


def request(ids, dx=40, dy=20):
    geometry = {"direct": (0, 0), "hidden": (0, 100), "external": (500, 0), "other": (500, 300)}
    payload = {
        "delta_x": dx, "delta_y": dy,
        "footprints": [{"physical_object_id": str(ids["objects"][name]), "x": x, "y": y, "width": 100, "height": 60} for name, (x, y) in geometry.items()],
    }
    return payload


def move(ids, payload):
    return client.post(f'/v1/maps/{ids["map"]}/presentation-variants/{ids["variant"]}/locations/{ids["room"]}/group-move', json=payload)


def snapshot(ids):
    with SessionLocal() as session:
        positions = dict(session.execute(select(MapPlacement.physical_object_id, MapViewPosition)
            .join(MapViewPosition, MapViewPosition.placement_id == MapPlacement.id)
            .where(MapPlacement.map_id == ids["map"])).all())
        membership = dict(session.execute(select(PhysicalObject.id, PhysicalObject.location_id)).all())
        hierarchy = dict(session.execute(select(Location.id, Location.parent_location_id)).all())
        return {name: (positions[object_id].x, positions[object_id].y, positions[object_id].display_width) for name, object_id in ids["objects"].items()}, membership, hierarchy


def test_group_move_moves_hidden_descendant_without_touching_canonical_or_external():
    ids = scene()
    before = snapshot(ids)
    response = move(ids, request(ids))
    assert response.status_code == 204, response.text
    positions, membership, hierarchy = snapshot(ids)
    assert positions["direct"][:2] == (40, 20)
    assert positions["hidden"] == (40, 120, 180)
    assert positions["external"] == before[0]["external"]
    assert membership == before[1] and hierarchy == before[2]
    with SessionLocal() as session:
        assert session.get(Cable, ids["crossing"]) is not None


def test_group_move_rejects_locked_collision_atomically():
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
    assert snapshot(ids) == before


def test_group_move_allows_preexisting_overlap_inside_group():
    ids = scene()
    with SessionLocal.begin() as session:
        hidden = session.scalar(select(MapViewPosition).join(MapPlacement).where(MapPlacement.physical_object_id == ids["objects"]["hidden"]))
        hidden.y = 0
    payload = request(ids)
    next(item for item in payload["footprints"] if item["physical_object_id"] == str(ids["objects"]["hidden"]))["y"] = 0
    assert move(ids, payload).status_code == 204
    assert snapshot(ids)[0]["direct"][:2] == snapshot(ids)[0]["hidden"][:2]
    assert move(ids, payload).status_code == 422  # Stale position snapshot.


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


def test_group_move_write_failure_rolls_back_positions(monkeypatch):
    ids = scene()
    before = snapshot(ids)
    def fail(_self):
        raise RuntimeError("write failed")
    monkeypatch.setattr(SavedMapCatalog, "_flush", fail)
    with TestClient(app, raise_server_exceptions=False) as non_raising:
        response = non_raising.post(f'/v1/maps/{ids["map"]}/presentation-variants/{ids["variant"]}/locations/{ids["room"]}/group-move', json=request(ids))
    assert response.status_code == 500
    assert snapshot(ids) == before
