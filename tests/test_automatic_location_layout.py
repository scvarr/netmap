from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_variant_automatic_settings_copy_isolation_and_manual_roundtrip():
    created = client.post('/v1/maps', json={"name": "Auto layout"}).json()
    map_id = created['map_ref']['entity_id']
    variant = created['active_variant_ref']['entity_id']
    endpoint = f'/v1/maps/{map_id}/presentation-variants/{variant}/automatic-layout'
    settings = {"hide_empty": True, "containers": {"root": {"direction": "HORIZONTAL", "order": []}}}
    response = client.put(endpoint, json=settings)
    assert response.status_code == 200, response.text
    assert response.json()['variants'][0]['automatic_layout'] == settings
    copied = client.post(f'/v1/maps/{map_id}/presentation-variants', json={"name": "Copy", "source_variant_id": variant})
    assert copied.status_code == 201, copied.text
    assert copied.json()['automatic_layout'] == settings
    assert client.put(endpoint, json={"containers": {"root": {"direction": "INVALID"}}}).status_code == 422
    assert client.put(endpoint, json={"containers": {"root": {"direction": "VERTICAL", "order": ["Location:missing"]}}}).status_code == 422
    assert client.get(f'/v1/maps/{map_id}').json()['variants'][0]['automatic_layout'] == settings
    assert client.put(endpoint, content='null', headers={'Content-Type': 'application/json'}).status_code == 200
    variants = client.get(f'/v1/maps/{map_id}').json()['variants']
    assert next(v for v in variants if v['name'] == 'Copy')['automatic_layout'] == settings
    assert next(v for v in variants if v['name'] == 'Основной').get('automatic_layout') is None


def test_automatic_opt_in_preserves_canonical_data_boundary_and_manual_state():
    from tests.test_map_location_states_e2e import location, assign, detail
    from tests.l1_builders import create_map, create_object_with_point, create_endpoint_cable
    from app.database import SessionLocal
    from app.models import Cable, Connection
    from sqlalchemy import select
    map_id = create_map(client, "Invariants")
    parent = location("Building")
    child = location("Room", parent)
    obj, point = create_object_with_point(client, "Inside")
    other, other_point = create_object_with_point(client, "Outside")
    assign(obj, child)
    create_endpoint_cable(client, point, other_point)
    assert client.post(f'/v1/maps/{map_id}/placements', json={"physical_object_id": obj, "x": 100, "y": 100}).status_code == 201
    before = detail(map_id)
    variant = before['active_variant_ref']['entity_id']
    endpoint = f'/v1/maps/{map_id}/presentation-variants/{variant}'
    settings = {"hide_empty": True, "containers": {parent: {"direction": "HORIZONTAL", "order": [f"Location:{child}"]}, child: {"direction": "VERTICAL", "order": [f"PhysicalObject:{obj}"]}}}
    with SessionLocal() as session:
        identities = (list(session.scalars(select(Cable.id))), list(session.scalars(select(Connection.id))))
    assert client.put(endpoint + '/automatic-layout', json=settings).status_code == 200
    assert client.put(endpoint + f'/locations/{parent}/geometry', json={"x": 0,"y": 0,"width": 500,"height": 500,"edge": "right","offset": .5}).status_code == 422
    assert client.put(f'/v1/maps/{map_id}/placements/{obj}/positions/physical?variant_id={variant}', json={"x": 0,"y": 0}).status_code == 422
    assert client.get(f'/v1/locations/{child}').json()['parent_location_ref']['entity_id'] == parent
    during = detail(map_id)
    assert during['placements'] == before['placements']
    assert during['location_states'] == before['location_states']
    with SessionLocal() as session:
        assert identities == (list(session.scalars(select(Cable.id))), list(session.scalars(select(Connection.id))))
    assert client.put(endpoint + '/automatic-layout', content='null', headers={'Content-Type': 'application/json'}).status_code == 200
    assert detail(map_id)['placements'] == before['placements']


def test_historical_manual_workspace_variant_remains_readable():
    from app.database import SessionLocal
    from app.workspace_portability import export_package, validate_package
    client.post('/v1/maps', json={"name": "Historical manual"})
    with SessionLocal() as session:
        package = export_package(session)
    for variant in package['presentation']['MapPresentationVariant']:
        variant.pop('automatic_layout')
    validate_package(package)
