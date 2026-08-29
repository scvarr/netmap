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


def region_payload(label: str = "Zone A", *, z_order: int = 4) -> dict:
    return {
        "label": label,
        "points": [{"x": 0, "y": 0}, {"x": 80, "y": 0}, {"x": 30, "y": 20}, {"x": 0, "y": 60}],
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
    second = client.post(f"/v1/maps/{map_id}/regions", json=region_payload("Second", z_order=2)).json()

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
