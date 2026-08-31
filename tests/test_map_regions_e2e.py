from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import MapRegion
from tests.l1_builders import create_map, create_object_with_point


client = TestClient(app)

STYLE = {
    "fill_color": "#123456",
    "fill_opacity": 0.25,
    "stroke_color": "#abcdef",
    "stroke_width": 2,
    "stroke_style": "dashed",
    "label_color": "#fedcba",
}


def region_payload(label: str = "Zone A", *, z_order: int = 4, points: list[dict[str, float]] | None = None) -> dict:
    return {
        "label": label,
        "points": points or [{"x": 0, "y": 0}, {"x": 80, "y": 0}, {"x": 30, "y": 20}, {"x": 0, "y": 60}],
        "label_position": {"x": 10, "y": 12},
        "style": STYLE,
        "z_order": z_order,
    }


def test_regions_are_saved_map_presentation_state_and_replace_preserves_identity():
    map_id = create_map(client, "Regions")
    created = client.post(f"/v1/maps/{map_id}/regions", json=region_payload("  North  "))
    assert created.status_code == 201, created.text
    region_id = created.json()["region_ref"]["entity_id"]

    saved = client.get(f"/v1/maps/{map_id}")
    assert saved.status_code == 200
    assert saved.json()["regions"] == [{
        "region_ref": {"entity_type": "MapRegion", "entity_id": region_id},
        **region_payload("North"),
    }]


def test_region_location_association_is_explicit_replaceable_and_deletion_does_not_block_location():
    map_id = create_map(client, "Region location assistance")
    root = client.post("/v1/locations", json={"name": "Building", "type": "Anything"})
    assert root.status_code == 201
    root_ref = root.json()["location_ref"]
    replacement_location = client.post("/v1/locations", json={"name": "Floor", "parent_location_id": root_ref["entity_id"]})
    assert replacement_location.status_code == 201
    replacement_ref = replacement_location.json()["location_ref"]

    payload = {**region_payload(), "location_id": root_ref["entity_id"]}
    created = client.post(f"/v1/maps/{map_id}/regions", json=payload)
    assert created.status_code == 201
    region_id = created.json()["region_ref"]["entity_id"]
    assert created.json()["location_ref"] == root_ref
    assert client.get(f"/v1/maps/{map_id}").json()["regions"][0]["location_ref"] == root_ref

    changed = {**payload, "location_id": replacement_ref["entity_id"]}
    assert client.put(f"/v1/maps/{map_id}/regions/{region_id}", json=changed).json()["location_ref"] == replacement_ref
    cleared = {**changed, "location_id": None}
    assert "location_ref" not in client.put(f"/v1/maps/{map_id}/regions/{region_id}", json=cleared).json()
    assert "location_ref" not in client.get(f"/v1/maps/{map_id}").json()["regions"][0]

    associated = client.put(f"/v1/maps/{map_id}/regions/{region_id}", json=changed)
    assert associated.status_code == 200
    # The Region reference is SET NULL, whereas a PhysicalObject assignment remains a canonical blocker.
    assert client.delete(f"/v1/locations/{replacement_ref['entity_id']}").status_code == 204
    saved = client.get(f"/v1/maps/{map_id}").json()
    assert "location_ref" not in saved["regions"][0]


def test_saved_map_placement_returns_live_location_context_without_presentation_membership():
    map_id = create_map(client, "Bulk location context")
    location = client.post("/v1/locations", json={"name": "Room"}).json()["location_ref"]
    object_id, _ = create_object_with_point(client, "Located placement")
    assert client.put(f"/v1/topology/physical-objects/{object_id}/location", json={"location_id": location["entity_id"]}).status_code == 200
    assert client.post(f"/v1/maps/{map_id}/placements", json={"physical_object_id": object_id, "x": 1, "y": 2}).status_code == 201
    placement = client.get(f"/v1/maps/{map_id}").json()["placements"][0]
    assert placement["location_ref"] == location

    replacement = region_payload("South", z_order=-2)
    replacement.update({
        "points": [{"x": -5, "y": -5}, {"x": 45, "y": -5}, {"x": 45, "y": 45}],
        "label_position": None,
        "style": {**STYLE, "fill_opacity": 1, "stroke_style": "dotted", "label_color": None},
    })
    updated = client.put(f"/v1/maps/{map_id}/regions/{region_id}", json=replacement)
    assert updated.status_code == 200, updated.text
    assert updated.json()["region_ref"]["entity_id"] == region_id
    assert client.get(f"/v1/maps/{map_id}").json()["regions"] == [{
        "region_ref": {"entity_type": "MapRegion", "entity_id": region_id},
        "label": "South",
        "points": replacement["points"],
        "style": {key: value for key, value in replacement["style"].items() if value is not None},
        "z_order": -2,
    }]


def test_region_delete_leaves_placements_and_other_regions_unchanged():
    map_id = create_map(client, "Delete only region")
    object_id, _ = create_object_with_point(client, "Placed object")
    assert client.post(
        f"/v1/maps/{map_id}/placements", json={"physical_object_id": object_id, "x": 4, "y": 8}
    ).status_code == 201
    first = client.post(f"/v1/maps/{map_id}/regions", json=region_payload("First", z_order=1)).json()
    second = client.post(f"/v1/maps/{map_id}/regions", json=region_payload("Second", z_order=2, points=[
        {"x": 100, "y": 0}, {"x": 180, "y": 0}, {"x": 130, "y": 20}, {"x": 100, "y": 60},
    ])).json()

    assert client.delete(f"/v1/maps/{map_id}/regions/{first['region_ref']['entity_id']}").status_code == 204
    saved = client.get(f"/v1/maps/{map_id}").json()
    assert [placement["physical_object_ref"]["entity_id"] for placement in saved["placements"]] == [object_id]
    assert [region["region_ref"]["entity_id"] for region in saved["regions"]] == [second["region_ref"]["entity_id"]]


def test_saved_map_delete_cascades_regions():
    map_id = create_map(client, "Region cascade")
    assert client.post(f"/v1/maps/{map_id}/regions", json=region_payload()).status_code == 201
    assert client.delete(f"/v1/maps/{map_id}").status_code == 204
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapRegion)) == 0


def test_invalid_region_polygon_contract_is_rejected():
    map_id = create_map(client, "Invalid region")
    invalid = region_payload()
    invalid["points"] = [{"x": 0, "y": 0}, {"x": 40, "y": 40}, {"x": 0, "y": 40}, {"x": 40, "y": 0}]
    assert client.post(f"/v1/maps/{map_id}/regions", json=invalid).status_code == 422

    too_few = region_payload()
    too_few["points"] = [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
    assert client.post(f"/v1/maps/{map_id}/regions", json=too_few).status_code == 422

    zero_area = region_payload()
    zero_area["points"] = [{"x": 0, "y": 0}, {"x": 40, "y": 40}, {"x": 80, "y": 80}]
    assert client.post(f"/v1/maps/{map_id}/regions", json=zero_area).status_code == 422


def test_region_create_accepts_disjoint_and_strictly_nested_polygons():
    map_id = create_map(client, "Laminar create")
    outer = region_payload("Outer", points=[
        {"x": 0, "y": 0}, {"x": 100, "y": 0}, {"x": 100, "y": 100}, {"x": 0, "y": 100},
    ])
    nested = region_payload("Nested", points=[
        {"x": 20, "y": 20}, {"x": 40, "y": 20}, {"x": 40, "y": 40}, {"x": 20, "y": 40},
    ])
    disjoint = region_payload("Disjoint", points=[
        {"x": 120, "y": 0}, {"x": 140, "y": 0}, {"x": 140, "y": 20}, {"x": 120, "y": 20},
    ])
    assert client.post(f"/v1/maps/{map_id}/regions", json=outer).status_code == 201
    assert client.post(f"/v1/maps/{map_id}/regions", json=nested).status_code == 201
    assert client.post(f"/v1/maps/{map_id}/regions", json=disjoint).status_code == 201


def test_region_create_rejects_overlap_and_touch_with_stable_reason():
    map_id = create_map(client, "Spatial conflicts")
    first = region_payload("First", points=[
        {"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 10}, {"x": 0, "y": 10},
    ])
    assert client.post(f"/v1/maps/{map_id}/regions", json=first).status_code == 201
    overlap = region_payload("Overlap", points=[
        {"x": 5, "y": 5}, {"x": 15, "y": 5}, {"x": 15, "y": 15}, {"x": 5, "y": 15},
    ])
    touch = region_payload("Touch", points=[
        {"x": 10, "y": 10}, {"x": 14, "y": 10}, {"x": 14, "y": 14}, {"x": 10, "y": 14},
    ])
    for payload in (overlap, touch):
        response = client.post(f"/v1/maps/{map_id}/regions", json=payload)
        assert response.status_code == 422
        assert response.json()["error"]["details"]["reason"] == "MAP_REGION_SPATIAL_CONFLICT"
        assert response.json()["error"]["details"]["conflicting_region_id"]


def test_region_replace_allows_nesting_excludes_self_and_preserves_conflict_free_state():
    map_id = create_map(client, "Laminar replace")
    outer = client.post(f"/v1/maps/{map_id}/regions", json=region_payload("Outer", points=[
        {"x": 0, "y": 0}, {"x": 100, "y": 0}, {"x": 100, "y": 100}, {"x": 0, "y": 100},
    ])).json()
    inner = client.post(f"/v1/maps/{map_id}/regions", json=region_payload("Inner", points=[
        {"x": 120, "y": 0}, {"x": 140, "y": 0}, {"x": 140, "y": 20}, {"x": 120, "y": 20},
    ])).json()
    inner_id = inner["region_ref"]["entity_id"]

    nested = region_payload("Inner nested", points=[
        {"x": 20, "y": 20}, {"x": 40, "y": 20}, {"x": 40, "y": 40}, {"x": 20, "y": 40},
    ])
    assert client.put(f"/v1/maps/{map_id}/regions/{inner_id}", json=nested).status_code == 200
    assert client.put(f"/v1/maps/{map_id}/regions/{inner_id}", json=nested).status_code == 200

    conflict = region_payload("Conflicting", points=[
        {"x": 90, "y": 90}, {"x": 120, "y": 90}, {"x": 120, "y": 120}, {"x": 90, "y": 120},
    ])
    response = client.put(f"/v1/maps/{map_id}/regions/{inner_id}", json=conflict)
    assert response.status_code == 422
    assert response.json()["error"]["details"]["reason"] == "MAP_REGION_SPATIAL_CONFLICT"
    saved = client.get(f"/v1/maps/{map_id}").json()
    assert next(region for region in saved["regions"] if region["region_ref"]["entity_id"] == inner_id)["points"] == nested["points"]
    assert outer["region_ref"]["entity_id"] != inner_id
