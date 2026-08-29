from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import MapCableRoute
from tests.l1_builders import create_interface_cable, create_map, create_object_with_point, put_cable_route


client = TestClient(app)


def test_cable_route_api_preserves_per_map_geometry_and_explicit_route_lifecycle():
    cable_id = create_interface_cable(client)["cable_ref"]["entity_id"]
    first, second = create_map(client, "One"), create_map(client, "Two")

    assert client.get(f"/v1/maps/{first}").json()["cable_routes"] == []
    first_route = [{"x": 2, "y": 1}, {"x": -4, "y": 8}]
    assert put_cable_route(client, first, cable_id, first_route)["cable_routes"][0]["waypoints"] == first_route
    assert client.get(f"/v1/maps/{second}").json()["cable_routes"] == []
    assert client.delete(f"/v1/maps/{first}/cable-routes/{cable_id}").status_code == 204
    assert client.get(f"/v1/maps/{first}").json()["cable_routes"] == []


def test_cable_delete_cascades_its_routes_and_non_cables_cannot_be_routed():
    map_id = create_map(client, "Cascade")
    deleted = create_interface_cable(client, "A", "B")["cable_ref"]["entity_id"]
    retained = create_interface_cable(client, "C", "D")["cable_ref"]["entity_id"]
    put_cable_route(client, map_id, deleted, [])
    put_cable_route(client, map_id, retained, [{"x": 1, "y": 1}])
    object_id, _ = create_object_with_point(client, "Object")
    assert client.put(
        f"/v1/maps/{map_id}/cable-routes/{object_id}",
        json={"view": "physical", "waypoints": []},
    ).status_code == 422

    assert client.delete(f"/v1/cables/{deleted}").status_code == 204
    routes = client.get(f"/v1/maps/{map_id}").json()["cable_routes"]
    assert [route["cable_ref"]["entity_id"] for route in routes] == [retained]
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapCableRoute)) == 1
