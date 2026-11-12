from tests.test_map_location_states_e2e import client, location, detail
from tests.l1_builders import create_map, create_object_with_point, create_endpoint_cable
from tests.test_map_location_states_e2e import assign
from app.database import SessionLocal
from app.models import Cable, Connection
from sqlalchemy import select


def test_independent_frames_and_mandatory_identity():
    first = create_map(client, "Frames")
    second = create_map(client, "Other frames")
    parent = location("U19")
    child = location("Nested", parent)
    variant = detail(first)["active_variant_ref"]["entity_id"]
    foreign = detail(second)["active_variant_ref"]["entity_id"]
    def state(map_id, variant_id=None):
        return next(s for s in detail(map_id, variant_id)["location_states"] if s["location_ref"]["entity_id"] == parent)
    original = state(first)
    assert state(second)["boundary_point_id"] != original["boundary_point_id"]
    obj, point = create_object_with_point(client, "Inside")
    other, other_point = create_object_with_point(client, "Outside")
    assign(obj, parent)
    create_endpoint_cable(client, point, other_point)
    with SessionLocal() as session:
        identities = (list(session.scalars(select(Cable.id))), list(session.scalars(select(Connection.id))))
    geometry = dict(x=-123.5, y=300, width=450, height=120, edge="bottom", offset=0.75)
    url = f"/v1/maps/{first}/presentation-variants/{variant}/locations/{parent}/geometry"
    assert client.put(url, json=geometry).status_code == 200
    assert state(first)["geometry"] == geometry
    assert state(first)["boundary_point_id"] == original["boundary_point_id"]
    copy = client.post(f"/v1/maps/{first}/presentation-variants", json={"name": "Copy", "source_variant_id": variant}).json()["variant_ref"]["entity_id"]
    assert state(first, copy)["geometry"] == geometry
    assert state(first, copy)["boundary_point_id"] == original["boundary_point_id"]
    updated = dict(geometry, width=80, edge="left", offset=0)
    assert client.put(url, json=updated).status_code == 200
    assert state(first, copy)["geometry"] == geometry
    assert state(first)["geometry"] == updated
    for patch in ({"width": 0}, {"height": -1}, {"offset": 2}, {"edge": "middle"}, {"x": "NaN"}):
        assert client.put(url, json=dict(geometry, **patch)).status_code == 422
        assert state(first)["geometry"] == updated
    assert client.put(url.replace(variant, foreign), json=geometry).status_code == 422
    assert client.get(f"/v1/locations/{child}").json()["parent_location_ref"]["entity_id"] == parent
    assert client.delete(f"/v1/maps/{first}/presentation-variants/{copy}").status_code == 204
    assert client.delete(f"/v1/locations/{child}").status_code == 204
    with SessionLocal() as session:
        assert identities == (list(session.scalars(select(Cable.id))), list(session.scalars(select(Connection.id))))
    assert client.put(f"/v1/topology/physical-objects/{obj}/location", json={"location_id": None}).status_code == 200
    assert client.delete(f"/v1/locations/{parent}").status_code == 204
    assert not detail(first)["location_states"]
