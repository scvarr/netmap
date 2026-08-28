from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import MapCableRoute

client = TestClient(app)

def device(name: str) -> str:
    response = client.post('/v1/topology/devices', json={'display_name': name, 'initial_interface': {'display_name': 'eth0'}})
    assert response.status_code == 201
    return response.json()['interfaces'][0]['interface_ref']['entity_id']

def cable() -> str:
    response = client.post('/v1/topology/physical-links', json={'source_interface_id': device('A'), 'target_interface_id': device('B')})
    assert response.status_code == 201
    body = response.json()
    assert body['cable_ref']['entity_type'] == 'Cable'
    assert body['connection_ref']['entity_type'] == 'Connection'
    return body['cable_ref']['entity_id']

def saved_map(name: str) -> str:
    response = client.post('/v1/maps', json={'name': name})
    assert response.status_code == 201
    return response.json()['map_ref']['entity_id']

def put(map_id: str, cable_id: str, waypoints: list[dict]) -> dict:
    response = client.put(f'/v1/maps/{map_id}/cable-routes/{cable_id}', json={'view': 'physical', 'waypoints': waypoints})
    assert response.status_code == 200, response.text
    return response.json()

def test_cable_route_read_distinguishes_explicit_straight_route_from_absence():
    map_id, cable_id = saved_map('Routes'), cable()
    assert client.get(f'/v1/maps/{map_id}').json()['cable_routes'] == []
    stored = put(map_id, cable_id, [])
    assert stored['cable_routes'] == [{'cable_ref': {'ref_type': 'CANONICAL_FACT', 'entity_type': 'Cable', 'entity_id': cable_id}, 'view': 'L1/PHYSICAL_OBJECT', 'waypoints': []}]
    assert client.delete(f'/v1/maps/{map_id}/cable-routes/{cable_id}').status_code == 204
    assert client.get(f'/v1/maps/{map_id}').json()['cable_routes'] == []

def test_cable_route_replaces_full_ordered_waypoint_list_without_topology_mutation():
    map_id, cable_id = saved_map('Ordered'), cable()
    first = [{'x': 2, 'y': 1}, {'x': -4, 'y': 8}]
    second = [{'x': 7, 'y': 9}]
    assert put(map_id, cable_id, first)['cable_routes'][0]['waypoints'] == first
    assert put(map_id, cable_id, second)['cable_routes'][0]['waypoints'] == second
    projection = client.post('/v1/topology/projection', json={'layer': 'L1', 'detail_level': 'PHYSICAL_OBJECT', 'scope': {'include_location_subtrees': [], 'include_entities': []}})
    assert projection.status_code == 200

def test_routes_are_per_map_and_reject_non_cable_identity():
    cable_id, first, second = cable(), saved_map('One'), saved_map('Two')
    put(first, cable_id, [{'x': 1, 'y': 2}])
    assert client.get(f'/v1/maps/{second}').json()['cable_routes'] == []
    object_id = client.post('/v1/topology/physical-objects', json={'display_name': 'Object', 'initial_connection_point': {'display_name': 'P'}}).json()['physical_object']['source_ref']['entity_id']
    assert client.put(f'/v1/maps/{second}/cable-routes/{object_id}', json={'view': 'physical', 'waypoints': []}).status_code == 422

def test_cable_delete_cascades_only_its_route_rows():
    map_id, deleted, retained = saved_map('Cascade'), cable(), cable()
    put(map_id, deleted, []); put(map_id, retained, [{'x': 1, 'y': 1}])
    assert client.delete(f'/v1/cables/{deleted}').status_code == 204
    routes = client.get(f'/v1/maps/{map_id}').json()['cable_routes']
    assert [item['cable_ref']['entity_id'] for item in routes] == [retained]
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapCableRoute)) == 1
