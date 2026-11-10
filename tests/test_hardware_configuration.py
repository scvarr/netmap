from tests.port_type_fixtures import ensure_port_type_id
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
            "slots": [{"key": str(uuid.uuid4()), "display_name": "MGMT", 'port_type_id': ensure_port_type_id(), "kind": "NETWORK_PORT", "panel_key": panel_key, "rendered_position": {"x": .05, "y": .5}}],
            "internal_links": [], "bays": [{"bay_key": str(uuid.uuid4()), "display_name": " Bay exact ", "compatibility": "OCP3", "panel_key": panel_key, "x": .2, "y": .1, "width": .6, "height": .8}]}


def create_base(payload=None):
    payload = payload or base_payload()
    response = client.post('/v1/library/base-templates', json=payload)
    assert response.status_code == 201, response.text
    return response.json()['blueprint_ref']['entity_id'], payload


def create_module(compatibility='OCP3', names=('P1', 'P2')):
    payload = {"name": " NIC exact ", "compatibility": compatibility, "endpoints": [{"key": str(uuid.uuid4()), "display_name": name, 'port_type_id': ensure_port_type_id(), "kind": "NETWORK_PORT"} for name in names]}
    from app.module_geometry import initial_geometry
    payload["geometry"] = initial_geometry(e["key"] for e in payload["endpoints"])
    response = client.post('/v1/library/module-templates', json=payload)
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
        assert [e['local_display_name'] for e in installation['endpoints']] == ['P1', 'P2']
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
    assert package['format_version'] == 7
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
    payload['panels'][0]['display_name'] = 'Back'
    payload['bays'][0]['display_name'] = 'PCIe1'
    payload['bays'].append({**payload['bays'][0], 'bay_key': str(uuid.uuid4()), 'display_name': 'PCIe2'})
    template_id, payload = create_base(payload)
    module = create_module(names=('feth1', 'feth2'))
    object_id = create_object(template_id)['physical_object_ref']['entity_id']
    for bay in payload['bays']:
        assert install(object_id, module['template_id'], bay['bay_key']).status_code == 201
    configuration = client.get(f'/v1/topology/physical-objects/{object_id}/configuration').json()
    installations = [b['installation'] for b in configuration['bays']]
    assert len({i['id'] for i in installations}) == 2
    endpoints = [e for i in installations for e in i['endpoints']]
    assert len({e['connection_point_id'] for e in endpoints}) == 4
    assert len({e['network_interface_id'] for e in endpoints}) == 4
    expected = {f'Back / PCIe{bay} / feth{port}' for bay in (1, 2) for port in (1, 2)}
    assert {e['contextual_display_name'] for e in endpoints} == expected
    assert {e['local_display_name'] for e in endpoints} == {'feth1', 'feth2'}
    assert [e['display_name'] for e in module['endpoints']] == ['feth1', 'feth2']
    details = client.get(f'/v1/topology/physical-objects/{object_id}').json()
    assert {p['label'] for p in details['connection_points']} == expected | {'MGMT'}
    module_points = [p for p in details['connection_points'] if p['label'] in expected]
    assert {p['direct_interface_bindings'][0]['label'] for p in module_points} == expected
    devices = client.get(f'/v1/topology/devices/{object_id}').json()
    assert {i['label'] for i in devices['interfaces']} == expected | {'MGMT'}
    projection = client.post('/v1/topology/projection', json={"layer": "L1", "detail_level": "PHYSICAL_OBJECT", "scope": {"include_location_subtrees": [], "include_entities": []}})
    assert projection.status_code == 200, projection.text
    node = next(n for n in projection.json()['nodes'] if any(r['entity_id'] == object_id for r in n['source_refs']))
    slots = node['attributes']['blueprint_presentation']['slots']
    assert len(slots) == 5
    assert {e['connection_point_id'] for e in endpoints} <= {s['connection_point_id'] for s in slots}
    assert len({s['slot_key'] for s in slots}) == 5
    assert {p['display_name'] for p in node['attributes']['connection_points']} == expected | {'MGMT'}
    assert sorted(s['display_name'] for s in slots) == ['MGMT', 'feth1', 'feth1', 'feth2', 'feth2']
    # Read-state changes demonstrate derivation without an authoring API for published revisions.
    from app.hardware_catalog import HardwareCatalog
    from app.module_endpoint_names import module_endpoint_contexts
    from app.models import EntityMetadata, ModuleBay, PresentationPanel
    from sqlalchemy import event
    with SessionLocal() as session:
        metadata = session.scalars(select(EntityMetadata).where(EntityMetadata.connection_point_id.in_([uuid.UUID(e['connection_point_id']) for e in endpoints]))).all()
        assert {m.value for m in metadata} == {'feth1', 'feth2'}
        interface_metadata = session.scalars(select(EntityMetadata).where(EntityMetadata.network_interface_id.in_([uuid.UUID(e['network_interface_id']) for e in endpoints]))).all()
        assert {m.value for m in interface_metadata} == {'feth1', 'feth2'}
        statements = []
        def capture(*args):
            statements.append(args[2])
        event.listen(session.bind, 'before_cursor_execute', capture)
        try:
            contexts = module_endpoint_contexts(session, connection_point_ids=[uuid.UUID(e['connection_point_id']) for e in endpoints])
            assert len(statements) == 1 and len(contexts) == 4
            statements.clear()
            HardwareCatalog(session).configuration_document(uuid.UUID(object_id))
            assert len(statements) <= 8  # Bounded batches, independent of installation count.
        finally:
            event.remove(session.bind, 'before_cursor_execute', capture)
        session.scalar(select(PresentationPanel)).display_name = 'Rear'
        bay = session.scalar(select(ModuleBay).where(ModuleBay.bay_key == payload['bays'][0]['bay_key']))
        bay.display_name = 'Renamed'
        renamed = HardwareCatalog(session).configuration_document(uuid.UUID(object_id))
        changed = next(b['installation']['endpoints'] for b in renamed['bays'] if b['bay_key'] == bay.bay_key)
        assert {e['contextual_display_name'] for e in changed} == {'Rear / Renamed / feth1', 'Rear / Renamed / feth2'}
        assert {e['connection_point_id'] for b in renamed['bays'] for e in b['installation']['endpoints']} == {e['connection_point_id'] for e in endpoints}
        assert {e['network_interface_id'] for b in renamed['bays'] for e in b['installation']['endpoints']} == {e['network_interface_id'] for e in endpoints}
        session.rollback()
    remote = create_object(template_id)
    remote_id = remote['physical_object_ref']['entity_id']
    source = endpoints[0]
    connection = client.post('/v1/topology/physical-connections', json={
        'source': {'kind': 'CONNECTION_POINT', 'connection_point_id': source['connection_point_id'], 'member_index': 1},
        'target': {'kind': 'CONNECTION_POINT', 'connection_point_id': remote['slots'][0]['connection_point_ref']['entity_id'], 'member_index': 1},
    })
    assert connection.status_code == 201, connection.text
    remote_details = client.get(f'/v1/topology/physical-objects/{remote_id}').json()
    assert remote_details['connection_points'][0]['external_physical_attachments'][0]['remote_connection_point_label'] == source['contextual_display_name']
    inventory = client.get('/v1/catalog/inventory').json()
    assert source['contextual_display_name'] in {e['remote_connection_point_label'] for c in inventory['cables'] for e in (c['endpoint_a'], c['endpoint_b'])}
    scoped = client.post('/v1/topology/projection', json={
        'layer': 'L1', 'detail_level': 'PHYSICAL_OBJECT', 'include_cable_continuations': True,
        'scope': {'include_location_subtrees': [], 'include_entities': [{'ref_type': 'CANONICAL_FACT', 'entity_type': 'PhysicalObject', 'entity_id': object_id}]},
    })
    assert scoped.status_code == 200, scoped.text
    assert scoped.json()['l1_off_map_continuations'][0]['local_connection_point_display_name'] == source['contextual_display_name']


def test_repeated_bay_names_on_different_panels_use_full_context():
    payload = base_payload()
    payload['panels'][0]['display_name'] = 'Front'
    back = {**payload['panels'][0], 'panel_key': str(uuid.uuid4()), 'panel_number': 2, 'display_name': 'Back'}
    payload['panels'].append(back)
    payload['bays'][0]['display_name'] = 'Slot 1'
    payload['bays'].append({**payload['bays'][0], 'bay_key': str(uuid.uuid4()), 'panel_key': back['panel_key']})
    template_id, _ = create_base(payload)
    module = create_module(names=('feth1', 'feth2'))
    object_id = create_object(template_id)['physical_object_ref']['entity_id']
    for bay in payload['bays']:
        assert install(object_id, module['template_id'], bay['bay_key']).status_code == 201
    document = client.get(f'/v1/topology/physical-objects/{object_id}/configuration').json()
    assert {e['contextual_display_name'] for b in document['bays'] for e in b['installation']['endpoints']} == {f'{panel} / Slot 1 / feth{port}' for panel in ('Front', 'Back') for port in (1, 2)}


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


def test_runtime_port_types_follow_pinned_base_and_module_without_port_queries():
    from sqlalchemy import event
    from tests.test_l1_physical_projection_e2e import projection_query, node_by_object

    template_id, payload = create_base()
    module = create_module()
    obj = create_object(template_id)
    object_id = obj['physical_object_ref']['entity_id']
    installed = install(object_id, module['template_id'], payload['bays'][0]['bay_key'])
    assert installed.status_code == 201
    expected = {obj['slots'][0]['connection_point_ref']['entity_id']: payload['slots'][0]['port_type_id']}
    expected.update({e['connection_point_id']: e['port_type_id'] for e in installed.json()['bays'][0]['installation']['endpoints']})
    before = counts()
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(engine, 'before_cursor_execute', capture)
    try:
        response = client.post('/v1/topology/projection', json=projection_query([object_id]))
    finally:
        event.remove(engine, 'before_cursor_execute', capture)
    assert response.status_code == 200, response.text
    presentation = node_by_object(response.json(), object_id)['attributes']['blueprint_presentation']
    assert {s['connection_point_id']: s['port_type_id'] for s in presentation['slots']} == expected
    assert counts() == before
    assert not any('FROM port_type' in statement for statement in statements)


def test_trace_panel_context_uses_configured_panels_and_installed_modules_without_map():
    payload = base_payload()
    front = payload['panels'][0]
    front['display_name'] = 'FRONT'
    rear = {**front, 'panel_key': str(uuid.uuid4()), 'panel_number': 2, 'display_name': 'REAR'}
    payload['panels'].append(rear)
    payload['slots'][0]['display_name'] = '1'
    payload['slots'].append({**payload['slots'][0], 'key': str(uuid.uuid4()), 'panel_key': rear['panel_key']})
    payload['bays'][0]['display_name'] = 'PCIe1'
    payload['bays'].append({**payload['bays'][0], 'bay_key': str(uuid.uuid4()), 'display_name': 'PCIe2'})
    template_id, _ = create_base(payload)
    object_id = create_object(template_id)['physical_object_ref']['entity_id']
    module = create_module(names=('1', '10', '2'))
    installed_ids = set()
    for bay in payload['bays']:
        response = install(object_id, module['template_id'], bay['bay_key'])
        assert response.status_code == 201, response.text
        installed_ids.update(e['connection_point_id'] for b in response.json()['bays'] if b['installation'] for e in b['installation']['endpoints'])
    response = client.get(f'/v1/topology/physical-objects/{object_id}')
    assert response.status_code == 200, response.text
    points = response.json()['connection_points']
    assert len(points) == 8
    built_in = [p for p in points if p['connection_point_ref']['entity_id'] not in installed_ids]
    assert {p['panel_context']['panel_name'] for p in built_in} == {'FRONT', 'REAR'}
    assert {p['panel_context']['port_name'] for p in built_in} == {'1'}
    modules = [p for p in points if p['connection_point_ref']['entity_id'] in installed_ids]
    assert len(modules) == 6
    assert {p['panel_context']['bay_name'] for p in modules} == {'PCIe1', 'PCIe2'}
    assert {p['panel_context']['module_name'] for p in modules} == {module['name']}
    assert {p['panel_context']['port_name'] for p in modules} == {'1', '2', '10'}
    assert all(p['panel_context']['panel_name'] == 'FRONT' for p in modules)
