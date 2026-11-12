import uuid
from sqlalchemy import select
from app.database import SessionLocal
from app.models import MapLocationState
from app.location_frame_geometry import contains
from tests.test_map_location_states_e2e import client, location, detail
from tests.l1_builders import create_map, create_object_with_point
from tests.test_map_location_states_e2e import assign


def test_spatial_hierarchy_edit_reload_new_child_and_variants():
    map_id = create_map(client, "Hierarchy")
    root = location("808")
    room = location("823", root)
    sibling = location("821", root)
    leaf = location("U19", room)
    second_leaf = location("U23", room)
    variant = detail(map_id)["active_variant_ref"]["entity_id"]
    def read(v=variant):
        return {s["location_ref"]["entity_id"]: s for s in detail(map_id, v)["location_states"]}
    def frames(v=variant):
        return {key: state["geometry"] for key, state in read(v).items()}
    def write(key, geometry, v=variant):
        return client.put(f"/v1/maps/{map_id}/presentation-variants/{v}/locations/{key}/geometry", json=geometry)
    def valid(g):
        for parent, child in ((root, room), (root, sibling), (room, leaf), (room, second_leaf)):
            assert contains(g[parent], g[child]), (parent, child, g)
    initial = frames()
    valid(initial)
    assert initial == frames()
    def separate(a, b):
        return a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"] or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"]
    assert separate(initial[room], initial[sibling])
    assert separate(initial[leaf], initial[second_leaf])
    obj, _ = create_object_with_point(client, "Stationary equipment")
    assign(obj, room)
    assert client.post(f"/v1/maps/{map_id}/placements", json={"physical_object_id": obj, "x": 123, "y": 456}).status_code == 201
    placements = detail(map_id)["placements"]
    identities = {key: state["boundary_point_id"] for key, state in read().items()}
    # Add editing room, then translate its subtree inside the expanded root.
    assert write(root, dict(initial[root], width=initial[root]["width"] + 600, height=initial[root]["height"] + 600)).status_code == 200
    before = frames()
    assert write(room, dict(before[room], x=before[room]["x"] + 100)).status_code == 200
    moved = frames()
    valid(moved)
    for key in (room, leaf, second_leaf):
        assert moved[key]["x"] == before[key]["x"] + 100
        assert moved[key]["y"] == before[key]["y"]
    assert write(room, dict(moved[room], width=moved[room]["width"] + 150, height=moved[room]["height"] + 150)).status_code == 200
    before = frames()
    assert write(leaf, dict(before[leaf], x=before[leaf]["x"] + 30)).status_code == 200
    assert frames()[leaf]["x"] == before[leaf]["x"] + 30
    copy = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Copy", "source_variant_id": variant}).json()["variant_ref"]["entity_id"]
    copied = frames(copy)
    assert copied == frames()
    before = frames()
    placements_before_root_move = detail(map_id)["placements"]
    assert write(root, dict(before[root], x=-300, y=250)).status_code == 200
    after = frames()
    dx, dy = -300 - before[root]["x"], 250 - before[root]["y"]
    for key in before:
        assert after[key]["x"] == before[key]["x"] + dx
        assert after[key]["y"] == before[key]["y"] + dy
    valid(after)
    assert frames(copy) == copied
    current_position = detail(map_id)["placements"][0]["positions"]["L1/PHYSICAL_OBJECT"]
    old_position = placements_before_root_move[0]["positions"]["L1/PHYSICAL_OBJECT"]
    assert current_position["x"] == old_position["x"] + dx
    assert current_position["y"] == old_position["y"] + dy
    assert {key: state["boundary_point_id"] for key, state in read().items()} == identities
    # Reject malformed geometry without changing any persisted record.
    with SessionLocal() as session:
        stored = [(s.location_id, dict(s.geometry)) for s in session.scalars(select(MapLocationState).order_by(MapLocationState.id))]
    for key, bad in ((leaf, dict(after[leaf], offset=2)), (root, dict(after[root], width=0)), (room, dict(after[room], height=0))):
        assert write(key, bad).status_code == 422
        assert frames() == after
    assert write(str(uuid.uuid4()), after[leaf]).status_code == 422
    foreign_map = create_map(client, "Foreign")
    foreign_variant = detail(foreign_map)["active_variant_ref"]["entity_id"]
    assert write(leaf, after[leaf], foreign_variant).status_code == 422
    with SessionLocal() as session:
        assert [(s.location_id, dict(s.geometry)) for s in session.scalars(select(MapLocationState).order_by(MapLocationState.id))] == stored
    new_child = location("U24", room)
    for v in (variant, copy):
        g = frames(v)
        valid(g)
        assert contains(g[room], g[new_child])
        assert separate(g[room], g[sibling])
        assert separate(g[new_child], g[leaf]) and separate(g[new_child], g[second_leaf])
        assert write(new_child, dict(g[new_child], edge="bottom", offset=.25), v).status_code == 200
        assert frames(v) == g | {new_child: dict(g[new_child], edge="bottom", offset=.25)}
    for key, state in read().items():
        assert 0 <= state["geometry"]["offset"] <= 1
    assert client.get(f"/v1/locations/{room}").json()["parent_location_ref"]["entity_id"] == root
