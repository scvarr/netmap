import copy
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select

from app.database import SessionLocal, engine
from app.main import app
from app.models import (ConnectionPoint, NetworkInterface, NetworkInterfacePhysicalOwner,
                        InterfacePhysicalBinding, ObjectConfiguration, ModuleInstallation)

client = TestClient(app)


def base_payload():
    panel_key = str(uuid.uuid4())
    return {"name": " Base exact ", "body": {"kind": "RECTANGLE", "width": 160, "height": 60},
            "panels": [{"panel_key": panel_key, "panel_number": 1, "display_name": "Панель", "x": 0, "y": 0, "width": 160, "height": 60}],
            "slots": [{"key": str(uuid.uuid4()), "display_name": "MGMT", "kind": "NETWORK_PORT", "panel_key": panel_key, "rendered_position": {"x": .05, "y": .5}}],
            "internal_links": [], "bays": [{"bay_key": str(uuid.uuid4()), "display_name": " Bay exact ", "compatibility": "OCP3", "panel_key": panel_key, "x": .2, "y": .1, "width": .6, "height": .8}]}


def create_base(payload=None):
    payload = payload or base_payload()
    response = client.post('/v1/library/base-templates', json=payload)
    assert response.status_code == 201, response.text
    return response.json()['blueprint_ref']['entity_id'], payload


def create_module(compatibility='OCP3'):
    response = client.post('/v1/library/module-templates', json={"name": " NIC exact ", "compatibility": compatibility, "endpoints": [{"key": str(uuid.uuid4()), "display_name": name, "kind": "NETWORK_PORT"} for name in ['P1', 'P2']]})
    assert response.status_code == 201, response.text
    return response.json()


def create_object(template_id):
    response = client.post('/v1/topology/physical-objects', json={"base_template_id": template_id, "display_name": "Server", "class": "server"})
    assert response.status_code == 201, response.text
    return response.json()


def install(object_id, module_id, bay_key, orientation='HORIZONTAL'):
    return client.post(f'/v1/topology/physical-objects/{object_id}/module-installations', json={"module_template_id": module_id, "bay_key": bay_key, "orientation": orientation})


def counts():
    with SessionLocal() as session:
        return tuple(session.scalar(select(func.count()).select_from(model)) for model in (ConnectionPoint, NetworkInterface, NetworkInterfacePhysicalOwner, InterfacePhysicalBinding, ModuleInstallation))


@pytest.mark.parametrize('orientation', ['HORIZONTAL', 'VERTICAL'])
def test_materialization_identity_binding_geometry_and_round_trip(orientation):
    template_id, payload = create_base()
    module = create_module()
    objects = [create_object(template_id) for _ in range(2)]
    object_ids = [o['physical_object_ref']['entity_id'] for o in objects]
    bay = payload['bays'][0]
    endpoints = []
    installation_ids = []
    for obj, object_id in zip(objects, object_ids):
        assert len(obj['slots']) == 1 and obj['slots'][0]['network_interface_ref']
        response = install(object_id, module['template_id'], bay['bay_key'], orientation)
        assert response.status_code == 201, response.text
        installation = response.json()['bays'][0]['installation']
        installation_ids.append(installation['id'])
        endpoints.extend(installation['endpoints'])
        assert [e['display_name'] for e in installation['endpoints']] == ['P1', 'P2']
        for index, endpoint in enumerate(installation['endpoints']):
            expected = (.2 + .6 * (index + 1) / 3, .5) if orientation == 'HORIZONTAL' else (.5, .1 + .8 * (index + 1) / 3)
            assert (endpoint['x'], endpoint['y']) == pytest.approx(expected)
            point_id, interface_id = uuid.UUID(endpoint['connection_point_id']), uuid.UUID(endpoint['network_interface_id'])
            with SessionLocal() as session:
                assert session.get(ConnectionPoint, point_id).physical_object_id == uuid.UUID(object_id)
                assert session.scalar(select(NetworkInterfacePhysicalOwner).where(NetworkInterfacePhysicalOwner.interface_id == interface_id)).physical_object_id == uuid.UUID(object_id)
                binding = session.scalar(select(InterfacePhysicalBinding).where(InterfacePhysicalBinding.interface_id == interface_id))
                assert binding.point_id == point_id and binding.point_member == 1
        details = client.get(f'/v1/topology/physical-objects/{object_id}').json()
        assert len(details['connection_points']) == 3
    assert len(set(installation_ids)) == 2
    assert len({e['connection_point_id'] for e in endpoints}) == 4
    assert len({e['network_interface_id'] for e in endpoints}) == 4
    package = client.get('/v1/workspace/package').json()
    assert package['format_version'] == 4
    assert 'ModuleInstallation' in package['authoring']
    assert 'ObjectBlueprint' not in package['authoring']
    before = client.get(f'/v1/topology/physical-objects/{object_ids[0]}/configuration').json()
    reset = client.delete('/v1/workspace/dataset')
    assert reset.status_code == 204, reset.text
    imported = client.post('/v1/workspace/package', json=package)
    assert imported.status_code == 204, imported.text
    assert client.get(f'/v1/topology/physical-objects/{object_ids[0]}/configuration').json() == before
    assert client.get('/v1/workspace/package').json() == package


def test_rejected_installations_are_atomic():
    template_id, payload = create_base()
    module = create_module()
    incompatible = create_module('ocp3')
    object_id = create_object(template_id)['physical_object_ref']['entity_id']
    bay_key = payload['bays'][0]['bay_key']
    for module_id, key, expected in [(incompatible['template_id'], bay_key, 409), (module['template_id'], str(uuid.uuid4()), 422), (str(uuid.uuid4()), bay_key, 422)]:
        before = counts()
        response = install(object_id, module_id, key)
        assert response.status_code == expected, response.text
        assert counts() == before
    assert install(object_id, module['template_id'], bay_key).status_code == 201
    before = counts()
    assert install(object_id, module['template_id'], bay_key).status_code == 409
    assert counts() == before
    assert install(str(uuid.uuid4()), module['template_id'], bay_key).status_code == 422
    assert counts() == before


def test_two_installations_in_one_object_have_distinct_definition_mappings_and_projection():
    payload = base_payload()
    payload['bays'].append({**payload['bays'][0], 'bay_key': str(uuid.uuid4()), 'display_name': 'Second'})
    template_id, payload = create_base(payload)
    module = create_module()
    object_id = create_object(template_id)['physical_object_ref']['entity_id']
    for bay in payload['bays']:
        assert install(object_id, module['template_id'], bay['bay_key']).status_code == 201
    configuration = client.get(f'/v1/topology/physical-objects/{object_id}/configuration').json()
    installations = [b['installation'] for b in configuration['bays']]
    assert len({i['id'] for i in installations}) == 2
    endpoints = [e for i in installations for e in i['endpoints']]
    assert len({e['connection_point_id'] for e in endpoints}) == 4
    assert len({e['network_interface_id'] for e in endpoints}) == 4
    projection = client.post('/v1/topology/projection', json={"layer": "L1", "detail_level": "PHYSICAL_OBJECT", "scope": {"include_location_subtrees": [], "include_entities": []}})
    assert projection.status_code == 200, projection.text
    node = next(n for n in projection.json()['nodes'] if any(r['entity_id'] == object_id for r in n['source_refs']))
    slots = node['attributes']['blueprint_presentation']['slots']
    assert len(slots) == 5
    assert {e['connection_point_id'] for e in endpoints} <= {s['connection_point_id'] for s in slots}
    assert len({s['slot_key'] for s in slots}) == 5


def test_base_internal_links_are_canonical_and_metadata_is_preserved():
    payload = base_payload()
    first = payload['slots'][0]
    second = {**first, 'key': str(uuid.uuid4()), 'display_name': 'peer', 'kind': 'CONNECTION_POINT'}
    payload['slots'].append(second)
    payload['internal_links'] = [{'from_slot_key': first['key'], 'to_slot_key': second['key']}]
    template_id, _ = create_base(payload)
    obj = create_object(template_id)
    object_id = obj['physical_object_ref']['entity_id']
    details = client.get(f'/v1/topology/physical-objects/{object_id}').json()
    assert details['physical_object']['label'] == 'Server'
    assert details['physical_object']['class'] == 'server'
    assert all(len(p['internal_physical_counterparts']) == 1 for p in details['connection_points'])
    with SessionLocal() as session:
        assert session.scalar(select(ObjectConfiguration)).base_revision_id == uuid.UUID(obj['version_ref']['entity_id'])


@pytest.mark.parametrize('change', [{'x': .5, 'width': .6}, {'height': 0}, {'x': -1}, {'panel_key': 'missing'}, {'compatibility': ' '}])
def test_invalid_bays_are_rejected_before_materialization(change):
    payload = base_payload()
    payload['bays'][0].update(change)
    before = counts()
    assert client.post('/v1/library/base-templates', json=payload).status_code == 422
    assert counts() == before


def test_creation_requires_root_base_template_and_published_editing_is_closed():
    assert client.post('/v1/topology/physical-objects', json={'display_name': 'manual', 'initial_connection_point': {'display_name': 'p'}}).status_code == 422
    assert client.post('/v1/topology/devices', json={'display_name': 'manual', 'initial_interface': {'display_name': 'p'}}).status_code in (404, 405)
    template_id, _ = create_base()
    assert client.post(f'/v1/library/base-templates/{template_id}/versions', json={}).status_code in (404, 405)
    assert client.post('/v1/library/object-blueprints', json={}).status_code == 404
    assert client.post(f'/v1/library/base-templates/{template_id}/versions/{uuid.uuid4()}/instantiate', json={}).status_code == 404
    bad = client.post('/v1/topology/physical-objects', json={'base_template_id': str(uuid.uuid4()), 'display_name': 'missing'})
    assert bad.status_code == 422
    assert counts() == (0, 0, 0, 0, 0)
    package = client.get('/v1/workspace/package').json()
    package['format_version'] = 3
    assert client.post('/v1/workspace/package', json=package).status_code == 422


def test_baseline_schema_is_current_and_seeded():
    tables = set(inspect(engine).get_table_names())
    assert {'module_bays', 'module_installations', 'module_endpoint_mappings', 'object_configurations'} <= tables
    assert not {'object_blueprints', 'blueprint_instances'} & tables
    from app.models import CableLabelSettings
    with SessionLocal() as session:
        assert session.get(CableLabelSettings, 1) is not None
