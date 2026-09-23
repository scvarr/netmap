from sqlalchemy import inspect

from app.database import engine
from app.main import app
from tests.l1_builders import create_map
from fastapi.testclient import TestClient


def test_saved_map_document_and_api_omit_removed_spatial_contracts():
    client = TestClient(app)
    map_id = create_map(client, "Spatial cleanup")
    response = client.get(f"/v1/maps/{map_id}")
    assert response.status_code == 200
    assert "composites" not in response.json()
    assert "regions" not in response.json()
    paths = {route.path for route in app.routes}
    assert not any("/composites" in path or "/regions" in path for path in paths)


def test_migrated_schema_keeps_retained_map_tables_only():
    tables = set(inspect(engine).get_table_names())
    assert not tables.intersection({
        "map_composite_visible_placements",
        "map_composite_presentations",
        "map_composite_members",
        "map_composites",
        "map_regions",
    })
    assert {
        "saved_maps",
        "map_presentation_variants",
        "map_placements",
        "map_view_positions",
        "map_cable_routes",
        "map_text_annotations",
        "locations",
        "physical_objects",
    } <= tables
