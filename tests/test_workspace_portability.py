import copy
import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.workspace_portability import reset_dataset
from tests.conftest import require_confirmed_test_database
from tests.l1_builders import create_endpoint_cable, put_cable_route


client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def isolated_workspace():
    require_confirmed_test_database()
    with SessionLocal.begin() as session:
        reset_dataset(session)
    yield
    with SessionLocal.begin() as session:
        reset_dataset(session)


pytestmark = pytest.mark.no_database


def snapshot():
    response = client.get('/v1/workspace/package')
    assert response.status_code == 200, response.text
    assert response.headers['content-disposition'].endswith('netmap-workspace.json"')
    return response.json()


def create_graph():
    location = client.post('/v1/locations', json={'name': 'Rack', 'type': 'rack'})
    assert location.status_code == 201, location.text
    objects = []
    for name in ('SW1', 'PP1'):
        response = client.post('/v1/topology/physical-objects', json={
            'display_name': name, 'initial_connection_point': {'display_name': 'p1'},
        })
        assert response.status_code == 201, response.text
        objects.append(response.json())
    point_ids = [item['connection_points'][0]['connection_point_ref']['entity_id'] for item in objects]
    object_ids = [item['physical_object']['source_ref']['entity_id'] for item in objects]
    cable = create_endpoint_cable(client, point_ids[0], point_ids[1])
    block = client.post('/v1/library/port-blocks', json={'name': 'One port', 'ports': [
        {'local_id': 'P1', 'display_label': 'P1', 'kind': 'CONNECTION_POINT', 'row': 1, 'column': 1, 'layout_order': 1},
        {'local_id': 'N1', 'display_label': 'N1', 'kind': 'NETWORK_PORT', 'row': 1, 'column': 2, 'layout_order': 2},
    ]})
    assert block.status_code == 201, block.text
    block_version_id = block.json()['version_ref']['entity_id']
    blueprint = client.post('/v1/library/object-blueprints', json={
        'name': 'Test blueprint', 'body': {'kind': 'RECTANGLE', 'width': 100, 'height': 40},
        'composition': {'instances': [{'instance_key': 'main', 'port_block_version_ref': {
            'ref_type': 'LIBRARY_RECORD', 'entity_type': 'PortBlockVersion', 'entity_id': block_version_id,
        }, 'face': 'FRONT', 'placement': {'x': .1, 'y': .1, 'width': .3, 'height': .2}}]},
        'internal_links': [],
    })
    assert blueprint.status_code == 201, blueprint.text
    blueprint_id = blueprint.json()['blueprint_ref']['entity_id']
    version_id = blueprint.json()['version_ref']['entity_id']
    instantiated = client.post(f'/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}/instantiate', json={'display_name': 'From blueprint'})
    assert instantiated.status_code == 201, instantiated.text
    saved = client.post('/v1/maps', json={'name': 'Rack map'})
    assert saved.status_code == 201, saved.text
    map_id = saved.json()['map_ref']['entity_id']
    for index, object_id in enumerate(object_ids):
        response = client.post(f'/v1/maps/{map_id}/placements', json={
            'physical_object_id': object_id, 'x': 100 + index * 200, 'y': 50,
        })
        assert response.status_code == 201, response.text
    assert client.put(f'/v1/maps/{map_id}/placements/{object_ids[0]}/locks/physical', json={'locked': True}).status_code == 200
    put_cable_route(client, map_id, cable['cable_ref']['entity_id'], [{'x': 120, 'y': 80}])
    annotation = client.post(f'/v1/maps/{map_id}/text-annotations', json={
        'text': 'Rack note', 'position': {'x': 15, 'y': 25}, 'text_color': '#123456', 'font_size': 18,
    })
    assert annotation.status_code == 201, annotation.text
    template = client.post('/v1/cable-label-templates', json={
        'name': 'Cable IDs', 'description': 'Rack links', 'pattern': 'C-###', 'start_at': 1,
    })
    assert template.status_code == 201, template.text
    return location.json(), objects, map_id


def test_empty_export_and_roundtrip():
    empty = snapshot()
    assert empty['format'] == 'netmap-workspace'
    assert empty['format_version'] == 1
    assert all(not rows for section in ('canonical', 'authoring', 'presentation') for rows in empty[section].values())
    assert empty['settings']['CableLabelSettings'] == [{'id': 1, 'unique_labels': False}]
    assert client.post('/v1/workspace/package', json=empty).status_code == 204
    assert snapshot() == empty


def test_graph_export_reset_import_restores_all_persisted_state():
    create_graph()
    before = snapshot()
    assert len(before['canonical']['PhysicalObject']) == 3
    assert len(before['canonical']['ConnectionMember']) == 1
    assert len(before['canonical']['InterfacePhysicalBinding']) >= 1
    assert len(before['authoring']['BlueprintInstance']) == 1
    assert len(before['authoring']['PortBlockVersion']) == 1
    assert len(before['presentation']['MapPlacement']) == 2
    assert before['presentation']['MapCableRoute'][0]['waypoints'] == [{'x': 120, 'y': 80}]
    assert before['presentation']['MapTextAnnotation'][0]['text'] == 'Rack note'
    assert before['settings']['CableLabelTemplate'][0]['name'] == 'Cable IDs'
    assert any(position['locked'] is True for position in before['presentation']['MapViewPosition'])
    assert client.delete('/v1/workspace/dataset').status_code == 204
    empty = snapshot()
    assert all(not rows for section in ('canonical', 'authoring', 'presentation') for rows in empty[section].values())
    assert empty['settings']['CableLabelSettings'] == [{'id': 1, 'unique_labels': False}]
    assert client.post('/v1/workspace/package', json=before).status_code == 204
    assert snapshot() == before


def test_nonempty_import_and_bad_packages_do_not_mutate():
    create_graph()
    before = snapshot()
    assert client.post('/v1/workspace/package', json=before).status_code == 409
    assert snapshot() == before
    assert client.delete('/v1/workspace/dataset').status_code == 204
    empty = snapshot()
    unsupported = copy.deepcopy(before)
    unsupported['format_version'] = 999
    assert client.post('/v1/workspace/package', json=unsupported).status_code == 422
    incomplete = copy.deepcopy(before)
    del incomplete['canonical']['Cable']
    assert client.post('/v1/workspace/package', json=incomplete).status_code == 422
    missing_settings = copy.deepcopy(before)
    missing_settings['settings']['CableLabelSettings'] = []
    assert client.post('/v1/workspace/package', json=missing_settings).status_code == 422
    missing_ref = copy.deepcopy(before)
    missing_ref['canonical']['ConnectionPoint'][0]['physical_object_id'] = str(uuid.uuid4())
    assert client.post('/v1/workspace/package', json=missing_ref).status_code == 422
    assert client.post('/v1/workspace/package', content=b'{', headers={'Content-Type': 'application/json'}).status_code == 422
    assert snapshot() == empty


def test_database_failure_during_import_rolls_back_everything():
    create_graph()
    package = snapshot()
    assert client.delete('/v1/workspace/dataset').status_code == 204
    empty = snapshot()
    # A valid reference graph with a storage uniqueness violation fails late,
    # after earlier entity groups have been inserted in the same transaction.
    duplicate = copy.deepcopy(package['presentation']['MapPlacement'][0])
    duplicate['id'] = str(uuid.uuid4())
    package['presentation']['MapPlacement'].append(duplicate)
    assert client.post('/v1/workspace/package', json=package).status_code == 422
    assert snapshot() == empty
