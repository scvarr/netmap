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
    assert "cable_routes" not in response.json()
    openapi = client.get("/openapi.json").json()
    paths = openapi["paths"]
    assert not any("/cable-routes" in path for path in paths)
    schemas = openapi["components"]["schemas"]
    assert not {"SetMapCableRouteRequest", "MapCableRouteDocument", "MapCableRouteWaypoint",
                "MapLocationBoundaryAnchor", "GroupMoveBoundaryRoute"} & schemas.keys()
    assert "boundary_routes" not in schemas["GroupMoveLocationRequest"]["properties"]
    former_route = f"/v1/maps/{map_id}/cable-routes/{map_id}"
    assert client.put(former_route, json={"view": "physical", "waypoints": []}).status_code == 404
    assert client.delete(former_route).status_code == 404
    assert not any("/composites" in path or "/regions" in path for path in paths)


def test_migrated_schema_keeps_retained_map_tables_only():
    tables = set(inspect(engine).get_table_names())
    assert not tables.intersection({
        "map_composite_visible_placements",
        "map_composite_presentations",
        "map_composite_members",
        "map_composites",
        "map_regions",
        "map_cable_routes",
    })
    assert {
        "saved_maps",
        "map_presentation_variants",
        "map_placements",
        "map_view_positions",
        "map_text_annotations",
        "locations",
        "physical_objects",
    } <= tables
