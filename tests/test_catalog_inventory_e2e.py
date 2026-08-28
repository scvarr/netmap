from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

def device(name: str) -> tuple[str, str]:
    response = client.post('/v1/topology/devices', json={'display_name': name, 'initial_interface': {'display_name': 'eth0'}})
    assert response.status_code == 201
    body = response.json()
    return body['device']['source_ref']['entity_id'], body['interfaces'][0]['interface_ref']['entity_id']

def test_inventory_authoritatively_separates_equipment_from_canonical_cables():
    source_object, source_interface = device('SW1')
    target_object, target_interface = device('FW1')
    created = client.post('/v1/topology/physical-links', json={'source_interface_id': source_interface, 'target_interface_id': target_interface})
    assert created.status_code == 201
    cable_id = created.json()['cable_ref']['entity_id']
    document = client.get('/v1/catalog/inventory')
    assert document.status_code == 200
    body = document.json()
    equipment = {item['physical_object_ref']['entity_id']: item for item in body['equipment']}
    assert set((source_object, target_object)) <= set(equipment)
    cable = next(item for item in body['cables'] if item['cable_ref']['entity_id'] == cable_id)
    assert cable['cable_ref']['entity_type'] == 'Cable'
    assert cable['connection_ref']['entity_type'] == 'Connection'
    assert cable['resolution'] == 'RESOLVED'
    assert cable['endpoint_a']['remote_physical_object_ref']['entity_type'] == 'PhysicalObject'
    assert cable['endpoint_b']['remote_connection_point_ref']['entity_type'] == 'ConnectionPoint'

def test_inventory_has_no_cable_as_physical_object_rows():
    first, first_interface = device('A')
    second, second_interface = device('B')
    created = client.post('/v1/topology/physical-links', json={'source_interface_id': first_interface, 'target_interface_id': second_interface}).json()
    cable_id = created['cable_ref']['entity_id']
    body = client.get('/v1/catalog/inventory').json()
    assert cable_id not in {item['physical_object_ref']['entity_id'] for item in body['equipment']}
    assert {first, second} <= {item['physical_object_ref']['entity_id'] for item in body['equipment']}
