import uuid
from sqlalchemy import select
from app.database import SessionLocal
from app.models import MapPlacement, MapViewPosition, Cable, Connection, ConnectionPoint
from app.location_frame_geometry import contains, overlaps
from tests.test_map_location_states_e2e import client, location, detail, assign
from tests.l1_builders import create_map, create_object_with_point, create_endpoint_cable, put_cable_route


def state(map_id, variant=None):
    doc = detail(map_id, variant)
    return doc, {s["location_ref"]["entity_id"]: s["geometry"] for s in doc["location_states"]}


def move(map_id, variant, loc, geometry):
    return client.put(f"/v1/maps/{map_id}/presentation-variants/{variant}/locations/{loc}/geometry", json=geometry)


def position(doc, obj):
    return next(p["positions"]["L1/PHYSICAL_OBJECT"] for p in doc["placements"] if p["physical_object_ref"]["entity_id"] == obj)


def test_assignment_addition_all_existing_scopes_container_move_and_identity():
    root = location("808")
    target = location("U42", root)
    sibling = location("U43", root)
    maps = [create_map(client, name) for name in ("T1", "T2", "No placement")]
    obj, point = create_object_with_point(client, "PP1")
    other, other_point = create_object_with_point(client, "PP2")
    cable = create_endpoint_cable(client, point, other_point)
    with SessionLocal() as session:
        identities = (list(session.scalars(select(Cable.id))), list(session.scalars(select(Connection.id))), list(session.scalars(select(ConnectionPoint.id))))
    scopes = []
    for map_id in maps[:2]:
        assert client.post(f"/v1/maps/{map_id}/placements", json={"physical_object_id": obj, "x": 8000, "y": 8000}).status_code == 201
        primary = detail(map_id)["active_variant_ref"]["entity_id"]
        copy = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Copy", "source_variant_id": primary}).json()["variant_ref"]["entity_id"]
        scopes.extend([(map_id, primary), (map_id, copy)])
    assign(obj, target)
    for map_id, variant in scopes:
        doc, frames = state(map_id, variant)
        g = position(doc, obj)
        assert contains(frames[target], dict(g, width=212, height=144))
        assert contains(frames[root], frames[target])
        assert not overlaps(frames[target], frames[sibling])
    assert not detail(maps[2])["placements"]
    # Object already assigned before initial placement, with another object in the same room.
    assign(other, target)
    assert client.post(f"/v1/maps/{maps[0]}/placements", json={"physical_object_id": other, "x": -999, "y": -999}).status_code == 201
    map_id, variant = scopes[0]
    before, frames = state(map_id, variant)
    assert contains(frames[target], dict(position(before, other), width=212, height=144))
    assert frames[target]["height"] < 500
    assert not overlaps(dict(position(before, obj), width=212, height=144), dict(position(before, other), width=212, height=144))
    # Internal saved route follows the same transaction as container and placements.
    cable_id = cable["cable_ref"]["entity_id"]
    put_cable_route(client, map_id, cable_id, [{"x": frames[target]["x"] + 60, "y": frames[target]["y"] + 70}])
    before, frames = state(map_id, variant)
    original_other_variant = detail(map_id, scopes[1][1])
    ids = {s["location_ref"]["entity_id"]: s["boundary_point_id"] for s in before["location_states"]}
    response = move(map_id, variant, root, dict(frames[root], x=frames[root]["x"] + 500, y=frames[root]["y"] + 100))
    assert response.status_code == 200, response.text
    assert response.json() == detail(map_id, variant)
    assert all("display_width" not in position["positions"]["L1/PHYSICAL_OBJECT"] for position in response.json()["placements"])
    after, moved = state(map_id, variant)
    for key in (obj, other):
        assert position(after, key)["x"] == position(before, key)["x"] + 500
        assert position(after, key)["y"] == position(before, key)["y"] + 100
    assert after["cable_routes"][0]["waypoints"][0]["x"] == before["cable_routes"][0]["waypoints"][0]["x"] + 500
    assert detail(map_id, scopes[1][1]) == original_other_variant
    assert {s["location_ref"]["entity_id"]: s["boundary_point_id"] for s in after["location_states"]} == ids
    # Locked contents reject the whole move, preserving every frame/position/route.
    with SessionLocal.begin() as session:
        pos = session.scalar(select(MapViewPosition).join(MapPlacement).where(MapPlacement.map_id == uuid.UUID(map_id), MapPlacement.physical_object_id == uuid.UUID(obj), MapViewPosition.variant_id == uuid.UUID(variant)))
        pos.locked = True
    locked = detail(map_id, variant)
    rejected = move(map_id, variant, root, dict(moved[root], x=moved[root]["x"] + 10))
    assert rejected.status_code == 422, rejected.text
    assert detail(map_id, variant) == locked
    overflow = move(map_id, variant, root, dict(moved[root], x=1e308, width=1e308))
    assert overflow.status_code == 422, overflow.text
    assert detail(map_id, variant) == locked
    with SessionLocal() as session:
        assert identities == (list(session.scalars(select(Cable.id))), list(session.scalars(select(Connection.id))), list(session.scalars(select(ConnectionPoint.id))))


def test_empty_move_child_expansion_and_no_parent_shrink():
    root = location("808")
    child = location("823", root)
    leaf = location("U19", child)
    sibling = location("821", root)
    map_id = create_map(client, "Empty")
    doc, frames = state(map_id)
    variant = doc["active_variant_ref"]["entity_id"]
    assert frames[leaf]["width"] < 300 and frames[leaf]["height"] < 100
    assert frames[leaf]["width"] > frames[leaf]["height"]
    response = move(map_id, variant, leaf, dict(frames[leaf], x=frames[leaf]["x"] - 100, width=350, height=160))
    assert response.status_code == 200, response.text
    _, grown = state(map_id)
    assert contains(grown[child], grown[leaf]) and contains(grown[root], grown[child])
    assert not overlaps(grown[child], grown[sibling])
    assert grown[child]["x"] < frames[child]["x"]
    assert move(map_id, variant, leaf, dict(grown[leaf], width=140, height=64)).status_code == 200
    _, reduced = state(map_id)
    assert contains(reduced[root], reduced[child]) and contains(reduced[child], reduced[leaf])
    assert move(map_id, variant, root, dict(reduced[root], x=1000, y=700)).status_code == 200
    _, moved = state(map_id)
    dx, dy = 1000 - reduced[root]["x"], 700 - reduced[root]["y"]
    for key in moved:
        assert moved[key]["x"] == reduced[key]["x"] + dx
        assert moved[key]["y"] == reduced[key]["y"] + dy


def test_locked_variant_assignment_and_sibling_push_roll_back_atomically():
    from app.models import PhysicalObject
    root = location("Root")
    target = location("Target", root)
    sibling = location("Sibling", root)
    map_id = create_map(client, "Atomic")
    obj, _ = create_object_with_point(client, "Unassigned")
    assert client.post(f"/v1/maps/{map_id}/placements", json={"physical_object_id": obj, "x": 7000, "y": 7000}).status_code == 201
    primary = detail(map_id)["active_variant_ref"]["entity_id"]
    copy = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Copy", "source_variant_id": primary}).json()["variant_ref"]["entity_id"]
    with SessionLocal.begin() as session:
        session.scalar(select(MapViewPosition).join(MapPlacement).where(MapPlacement.physical_object_id == uuid.UUID(obj), MapViewPosition.variant_id == uuid.UUID(copy))).locked = True
    snapshots = [detail(map_id, v) for v in (primary, copy)]
    response = client.put(f"/v1/topology/physical-objects/{obj}/location", json={"location_id": target})
    assert response.status_code == 422, response.text
    assert [detail(map_id, v) for v in (primary, copy)] == snapshots
    with SessionLocal.begin() as session:
        assert session.get(PhysicalObject, uuid.UUID(obj)).location_id is None
        session.scalar(select(MapViewPosition).join(MapPlacement).where(MapPlacement.physical_object_id == uuid.UUID(obj), MapViewPosition.variant_id == uuid.UUID(copy))).locked = False
    assign(obj, sibling)
    with SessionLocal.begin() as session:
        session.scalar(select(MapViewPosition).join(MapPlacement).where(MapPlacement.physical_object_id == uuid.UUID(obj), MapViewPosition.variant_id == uuid.UUID(primary))).locked = True
    before, frames = state(map_id, primary)
    response = move(map_id, primary, target, dict(frames[target], y=frames[sibling]["y"], height=500))
    assert response.status_code == 422, response.text
    assert detail(map_id, primary) == before


def test_container_external_route_keeps_suffix_and_exact_connectivity():
    room = location("Room")
    map_id = create_map(client, "Boundary")
    inside, inside_point = create_object_with_point(client, "Inside")
    outside, outside_point = create_object_with_point(client, "Outside")
    assign(inside, room)
    for key, x, y in ((inside, 0, 0), (outside, 2000, 2000)):
        assert client.post(f"/v1/maps/{map_id}/placements", json={"physical_object_id": key, "x": x, "y": y}).status_code == 201
    cable = create_endpoint_cable(client, inside_point, outside_point)
    cable_id = cable["cable_ref"]["entity_id"]
    before, frames = state(map_id)
    variant = before["active_variant_ref"]["entity_id"]
    g = frames[room]
    lead = {"x": g["x"] + 60, "y": g["y"] + 70}
    anchor = {"x": g["x"] + g["width"], "y": g["y"] + g["height"] * .5, "anchor": {"location_id": room, "edge": "right", "offset": .5}}
    suffix = {"x": 1500, "y": 1600}
    points = [lead, anchor, suffix] if inside < outside else [suffix, anchor, lead]
    put_cable_route(client, map_id, cable_id, points)
    response = move(map_id, variant, room, dict(g, x=g["x"] + 100, y=g["y"] + 50))
    assert response.status_code == 200, response.text
    restored = detail(map_id)["cable_routes"][0]["waypoints"]
    oriented = restored if inside < outside else list(reversed(restored))
    assert oriented[0] == {"x": lead["x"] + 100, "y": lead["y"] + 50}
    assert oriented[-1] == suffix
    assert oriented[1]["anchor"] == anchor["anchor"]
    assert detail(map_id)["cable_routes"][0]["cable_ref"]["entity_id"] == cable_id


def test_new_equipment_uses_compact_room_instead_of_skipping_siblings():
    root = location("Root")
    children = [location(name, root) for name in ("U19", "U23", "U24")]
    map_id = create_map(client, "Compact equipment")
    for index, child in enumerate(children[:2]):
        obj, _ = create_object_with_point(client, f"PP{index}")
        assign(obj, child)
        response = client.post(f"/v1/maps/{map_id}/placements", json={"physical_object_id": obj, "x": -10000, "y": -10000})
        assert response.status_code == 201, response.text
    doc, frames = state(map_id)
    for child in children[:2]:
        assert frames[child]["height"] == 204
        assert frames[child]["width"] == 252
    assert frames[children[2]]["height"] == 64
    assert frames[root]["height"] < 650
    for child in children:
        assert contains(frames[root], frames[child])
    for index, child in enumerate(children):
        for other in children[index + 1:]:
            assert not overlaps(frames[child], frames[other])


def test_new_child_keeps_existing_sibling_equipment_attached_to_its_container():
    root = location("Root")
    upper = location("Upper", root)
    lower = location("Lower", root)
    map_id = create_map(client, "New child")
    # Choose the branch above the other one, independently of UUID ordering.
    _, frames = state(map_id)
    upper, lower = sorted((upper, lower), key=lambda key: frames[key]["y"])
    obj, _ = create_object_with_point(client, "Lower equipment")
    assign(obj, lower)
    assert client.post(f"/v1/maps/{map_id}/placements", json={"physical_object_id": obj, "x": 0, "y": 0}).status_code == 201
    before, frames = state(map_id)
    old = position(before, obj)
    old_offset = (old["x"] - frames[lower]["x"], old["y"] - frames[lower]["y"])
    for index in range(3):
        location(f"New {index}", upper)
    after, current = state(map_id)
    new = position(after, obj)
    assert contains(current[lower], dict(new, width=212, height=144))
    assert (new["x"] - current[lower]["x"], new["y"] - current[lower]["y"]) == old_offset
    assert not overlaps(current[upper], current[lower])
