from tests.l1_builders import create_object_details
import copy
import json
import uuid
from pathlib import Path

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
        objects.append(create_object_details(client, name))
    point_ids = [item['connection_points'][0]['connection_point_ref']['entity_id'] for item in objects]
    object_ids = [item['physical_object']['source_ref']['entity_id'] for item in objects]
    cable = create_endpoint_cable(client, point_ids[0], point_ids[1])
    blueprint = client.post('/v1/library/base-templates', json={
        'name': 'Test blueprint', 'body': {'kind': 'RECTANGLE', 'width': 100, 'height': 40},
        'panels': [{'panel_key': 'panel-1', 'panel_number': 1, 'display_name': 'Панель 1', 'x': 0, 'y': 0, 'width': 100, 'height': 40}],
        'slots': [
            {'key': 'point-1', 'display_name': 'P1', 'kind': 'CONNECTION_POINT', 'panel_key': 'panel-1', 'rendered_position': {'x': .2, 'y': .3}},
            {'key': 'port-1', 'display_name': 'N1', 'kind': 'NETWORK_PORT', 'panel_key': 'panel-1', 'rendered_position': {'x': .7, 'y': .8}},
        ],
        'internal_links': [],
    })
    assert blueprint.status_code == 201, blueprint.text
    template_id = blueprint.json()['blueprint_ref']['entity_id']
    version_id = blueprint.json()['version_ref']['entity_id']
    instantiated = client.post("/v1/topology/physical-objects", json={"base_template_id": template_id, 'display_name': 'From blueprint'})
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
    assert empty['format_version'] == 5
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
    assert len(before['authoring']['ObjectConfiguration']) == 1
    assert len(before['authoring']['BuiltInEndpointDefinition']) == 2
    assert before['authoring']['PresentationPanel'][0]['panel_key'] == 'panel-1'
    assert 'PortBlockVersion' not in before['authoring']
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
    unsupported['format_version'] = 1
    assert client.post('/v1/workspace/package', json=unsupported).status_code == 422
    unsupported['format_version'] = 2
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


def c_archive():
    # Actual exporter output from main 1e733319 / schema 0002, not a D1
    # package with two fields removed. See fixtures/README.md for provenance.
    return json.loads((Path(__file__).parent / 'fixtures/workspace_09_6_c_v5.json').read_text(encoding='utf-8'))


def test_real_c_v5_archive_restores_ids_configuration_review_and_maps_on_0003():
    from sqlalchemy import text
    from app.workspace_portability import validate_package
    with SessionLocal() as session:
        assert session.scalar(text('SELECT version_num FROM alembic_version')) == '0003'
    archive = c_archive()
    untouched = copy.deepcopy(archive)
    assert 'BaseTemplatePublication' not in archive['authoring']
    assert all('name' not in r for r in archive['authoring']['BaseTemplateRevision'])
    assert archive['authoring']['BaseTemplateDraft'] and archive['authoring']['BaseTemplateCandidate']
    assert archive['authoring']['ObjectConfiguration'] and archive['presentation']['SavedMap']
    assert archive['canonical']['Cable'] and archive['canonical']['InterfacePhysicalBinding']
    validate_package(archive)
    assert archive == untouched  # Import adaptation must not rewrite the archive.
    response = client.post('/v1/workspace/package', json=archive)
    assert response.status_code == 204, response.text
    current = snapshot()
    expected = copy.deepcopy(archive)
    expected['authoring']['BaseTemplatePublication'] = []
    names = {t['id']: t['name'] for t in archive['authoring']['BaseTemplate']}
    for revision in expected['authoring']['BaseTemplateRevision']:
        revision['name'] = names[revision['template_id']]
    assert current == expected  # Every old row/ID/snapshot/configuration unchanged.
    assert current['format_version'] == 5
    assert client.post('/v1/workspace/package', json=archive).status_code == 409
    assert snapshot() == current
    assert client.delete('/v1/workspace/dataset').status_code == 204
    assert client.post('/v1/workspace/package', json=current).status_code == 204
    assert snapshot() == current


def test_empty_c_v5_archive_reexports_the_current_explicit_shape():
    current = snapshot()
    historical = copy.deepcopy(current)
    del historical['authoring']['BaseTemplatePublication']
    assert client.post('/v1/workspace/package', json=historical).status_code == 204
    assert snapshot() == current


@pytest.mark.parametrize('damage', ['mixed_name', 'mixed_collection', 'later_revision', 'missing_template', 'unknown_revision_field', 'missing_other_collection'])
def test_c_profile_is_exact_and_does_not_hide_corrupt_or_mixed_packages(damage):
    archive = c_archive()
    revision = archive['authoring']['BaseTemplateRevision'][0]
    if damage == 'mixed_name':
        revision['name'] = 'Not a C revision field'
    elif damage == 'mixed_collection':
        archive['authoring']['BaseTemplatePublication'] = []
    elif damage == 'later_revision':
        revision['version_number'] = 2
    elif damage == 'missing_template':
        revision['template_id'] = str(uuid.uuid4())
    elif damage == 'unknown_revision_field':
        revision['publication'] = None
    else:
        del archive['authoring']['BaseTemplateCandidate']
    before = snapshot()
    response = client.post('/v1/workspace/package', json=archive)
    assert response.status_code == 422, response.text
    assert snapshot() == before


@pytest.fixture
def published_c_archive():
    from tests.test_base_template_review import check, open_draft
    from tests.test_base_template_publication import publish
    archive = c_archive()
    assert client.post('/v1/workspace/package', json=archive).status_code == 204
    template_id = archive['authoring']['BaseTemplate'][0]['id']
    checked = check(template_id, open_draft(template_id))
    response = publish(template_id, checked['review']['candidate_id'])
    assert response.status_code == 200, response.text
    package = snapshot()
    assert package['canonical'] == archive['canonical']
    assert package['presentation'] == archive['presentation']
    assert package['authoring']['ObjectConfiguration'] == archive['authoring']['ObjectConfiguration']
    assert len(package['authoring']['BaseTemplatePublication']) == 1
    return package


def test_c_archive_after_d1_publication_roundtrips_without_changing_topology(published_c_archive):
    assert client.delete('/v1/workspace/dataset').status_code == 204
    response = client.post('/v1/workspace/package', json=published_c_archive)
    assert response.status_code == 204, response.text
    assert snapshot() == published_c_archive


@pytest.mark.parametrize('damage', ['missing_collection', 'stripped_to_c', 'empty_receipts', 'null_receipts', 'missing_candidate', 'missing_revision', 'wrong_source', 'wrong_owner', 'changed_content', 'duplicate_receipt', 'duplicate_revision', 'unknown_receipt_field'])
def test_invalid_publication_receipts_cannot_pass_as_c_or_current_v5(published_c_archive, damage):
    package = copy.deepcopy(published_c_archive)
    authoring = package['authoring']
    receipt = authoring['BaseTemplatePublication'][0]
    candidate = next(c for c in authoring['BaseTemplateCandidate'] if c['id'] == receipt['id'])
    revision = next(r for r in authoring['BaseTemplateRevision'] if r['id'] == receipt['revision_id'])
    if damage in ('missing_collection', 'stripped_to_c'):
        del authoring['BaseTemplatePublication']
        if damage == 'stripped_to_c':
            for row in authoring['BaseTemplateRevision']:
                del row['name']
    elif damage == 'empty_receipts':
        authoring['BaseTemplatePublication'] = []
    elif damage == 'null_receipts':
        authoring['BaseTemplatePublication'] = None
    elif damage == 'missing_candidate':
        receipt['id'] = str(uuid.uuid4())
    elif damage == 'missing_revision':
        receipt['revision_id'] = str(uuid.uuid4())
    elif damage == 'wrong_source':
        candidate['source_revision_id'] = revision['id']
    elif damage == 'wrong_owner':
        template_id = str(uuid.uuid4())
        authoring['BaseTemplate'].append({'id': template_id, 'name': 'Foreign template'})
        candidate['template_id'] = template_id
    elif damage == 'changed_content':
        revision['name'] = 'Different from immutable candidate'
    elif damage == 'duplicate_receipt':
        authoring['BaseTemplatePublication'].append(copy.deepcopy(receipt))
    elif damage == 'duplicate_revision':
        other = next(c for c in authoring['BaseTemplateCandidate'] if c['id'] != receipt['id'])
        authoring['BaseTemplatePublication'].append({'id': other['id'], 'revision_id': revision['id']})
    else:
        receipt['unknown'] = True
    assert client.delete('/v1/workspace/dataset').status_code == 204
    before = snapshot()
    response = client.post('/v1/workspace/package', json=package)
    assert response.status_code == 422, response.text
    assert snapshot() == before
