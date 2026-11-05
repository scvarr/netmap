"""HV-01-UX-02B: individual logical places, atomic boundaries and profiles."""
import copy
import uuid
import pytest
from pydantic import ValidationError
from app.schemas import ModuleBayRequest
from app.workspace_portability import validate_package, PackageError
from tests.test_hardware_configuration import base_payload, create_base, create_object, create_module, install, client
from tests.test_module_reconciliation import package
from tests.test_module_layout import setup, revision, reconcile


def logical(bay):
    return {**{k: v for k, v in bay.items() if k not in ('x', 'y', 'width', 'height')}, 'kind': 'LOGICAL'}


def test_logical_configuration_atomic_install_and_archive():
    payload = base_payload()
    payload['bays'].append(logical({**payload['bays'][0], 'bay_key': str(uuid.uuid4())}))
    base, _ = create_base(payload)
    obj = create_object(base)['physical_object_ref']['entity_id']
    module = create_module()
    before = package()
    response = install(obj, module['template_id'], payload['bays'][1]['bay_key'])
    assert response.status_code == 409, response.text
    assert 'LOGICAL_MODULE_INSTALLATION_UNSUPPORTED' in response.text
    assert package() == before
    response = install(obj, module['template_id'], payload['bays'][0]['bay_key'])
    assert response.status_code == 201, response.text
    bays = {b['bay_key']: b for b in response.json()['bays']}
    assert bays[payload['bays'][1]['bay_key']]['installation'] is None
    assert bays[payload['bays'][1]['bay_key']]['x'] is None
    exported = package()
    assert exported['module_places_version'] == 1
    assert validate_package(exported)['module_bays']
    from app.database import SessionLocal
    from app.workspace_portability import reset_dataset
    with SessionLocal.begin() as session: reset_dataset(session)
    restored = client.post('/v1/workspace/package', json=exported)
    assert restored.status_code == 204, restored.text
    assert package() == exported
    broken = copy.deepcopy(exported)
    del broken['module_places_version']
    with pytest.raises(PackageError): validate_package(broken)


@pytest.mark.parametrize('patch', [{'kind': 'PLACED', 'x': None}, {'kind': 'LOGICAL'}, {'kind': 'OTHER'}])
def test_contradictory_places(patch):
    with pytest.raises(ValidationError): ModuleBayRequest.model_validate({**base_payload()['bays'][0], **patch})


def test_logical_validation_exact_strings():
    bay = logical(base_payload()['bays'][0])
    bay['compatibility'] = ' Ocp3 '
    result = ModuleBayRequest.model_validate(bay)
    assert result.compatibility == ' Ocp3 ' and result.x is None


def test_d2_logical_assignment_blocks_without_changes():
    base, obj, _, _ = setup()
    revision(base, lambda d: d['bays'].__setitem__(0, logical(d['bays'][0])))
    before = package()
    result = reconcile(base)[obj]
    assert result['status'] == 'requires_intervention'
    assert any(r['code'] == 'LOGICAL_MODULE_INSTALLATION_UNSUPPORTED' for r in result['reasons'])
    assert package() == before


def test_forward_migration_preserves_existing_rectangles():
    import importlib.util
    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from app.database import engine
    spec = importlib.util.spec_from_file_location('places_migration', 'alembic/versions/0008_logical_module_places.py')
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.connect() as connection:
        transaction = connection.begin()
        connection.execute(sa.text('CREATE SCHEMA migration_places_test'))
        connection.execute(sa.text('SET LOCAL search_path TO migration_places_test'))
        connection.execute(sa.text('CREATE TABLE module_bays (bay_key text PRIMARY KEY, display_name text, compatibility text, panel_key text, x float NOT NULL, y float NOT NULL, width float NOT NULL, height float NOT NULL)'))
        connection.execute(sa.text("INSERT INTO module_bays VALUES ('opaque', ' Bay ', ' OCP ', 'panel', .1, .2, .3, .4)"))
        before = connection.execute(sa.text('SELECT * FROM module_bays')).mappings().one()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        after = dict(connection.execute(sa.text('SELECT * FROM module_bays')).mappings().one())
        assert after.pop('kind') == 'PLACED'
        assert after == dict(before)
        transaction.rollback()


@pytest.mark.parametrize('change', [None, 'display_name', 'x', 'compatibility', 'logical'])
def test_pre_kind_draft_check_compares_semantics_and_preserves_snapshots(change):
    from sqlalchemy import select
    from app import models as m
    from app.database import SessionLocal
    from tests.test_base_template_review import open_draft, check
    base, _ = create_base()
    draft = open_draft(base)
    first = check(base, draft)
    with SessionLocal.begin() as session:
        stored = session.scalar(select(m.BaseTemplateDraft).where(m.BaseTemplateDraft.template_id == uuid.UUID(base)))
        raw = copy.deepcopy(stored.definition)
        raw['bays'][0].pop('kind')
        if change == 'logical': raw['bays'][0] = logical(raw['bays'][0])
        elif change == 'x': raw['bays'][0]['x'] = .1
        elif change: raw['bays'][0][change] += ' changed '
        stored.definition = raw
        frozen = session.get(m.BaseTemplateCandidate, uuid.UUID(first['review']['candidate_id']))
        old = copy.deepcopy(frozen.definition)
        old['bays'][0].pop('kind')
        frozen.definition = old
    before = package()
    checked = check(base, open_draft(base))
    changes = [c for c in checked['review']['result']['changes'] if c['section'] == 'bays']
    assert len(changes) == (0 if change is None else 1)
    if changes:
        assert changes[0]['operation'] == 'changed'
        assert changes[0]['key'] == raw['bays'][0]['bay_key']
    after = package()
    assert after['authoring']['BaseTemplateDraft'] == before['authoring']['BaseTemplateDraft']
    old_id = first['review']['candidate_id']
    assert next(c for c in after['authoring']['BaseTemplateCandidate'] if c['id'] == old_id) == next(c for c in before['authoring']['BaseTemplateCandidate'] if c['id'] == old_id)
    assert checked['review']['definition'] == raw
    assert after['canonical'] == before['canonical']


@pytest.mark.parametrize('damage', ['unknown', 'logical_geometry', 'partial', 'null', 'outside', 'negative', 'zero', 'missing_kind', 'marker_missing', 'marker_unknown', 'marker_bool', 'layout_marker_missing', 'historical_null', 'historical_partial'])
def test_workspace_rejects_invalid_bays_before_import(damage):
    create_base()
    archive = package()
    bay = archive['authoring']['ModuleBay'][0]
    if damage == 'unknown': bay['kind'] = 'UNKNOWN'
    elif damage == 'logical_geometry': bay['kind'] = 'LOGICAL'
    elif damage == 'partial': del bay['width']
    elif damage == 'null': bay['x'] = None
    elif damage == 'outside': bay['width'] = 1
    elif damage == 'negative': bay['x'] = -.1
    elif damage == 'zero': bay['height'] = 0
    elif damage == 'missing_kind': del bay['kind']
    elif damage == 'marker_missing': del archive['module_places_version']
    elif damage == 'marker_unknown': archive['module_places_version'] = 2
    elif damage == 'marker_bool': archive['module_places_version'] = True
    elif damage == 'layout_marker_missing': del archive['module_layout_version']
    else:
        del archive['module_places_version']
        del bay['kind']
        if damage == 'historical_null': bay['x'] = None
        else: del bay['height']
    original = copy.deepcopy(archive)
    with pytest.raises(PackageError): validate_package(archive)
    assert archive == original
    assert client.delete('/v1/workspace/dataset').status_code == 204
    before = package()
    response = client.post('/v1/workspace/package', json=archive)
    assert response.status_code == 422, response.text
    assert package() == before


def test_workspace_accepts_logical_missing_or_null_coordinates():
    create_base()
    archive = package()
    bay = archive['authoring']['ModuleBay'][0]
    bay['kind'] = 'LOGICAL'
    for coordinate in ('x', 'y', 'width', 'height'): bay.pop(coordinate)
    original = copy.deepcopy(archive)
    assert validate_package(archive)['module_bays'][0]['x'] is None
    assert archive == original
    assert client.delete('/v1/workspace/dataset').status_code == 204
    assert client.post('/v1/workspace/package', json=archive).status_code == 204
    assert package()['authoring']['ModuleBay'][0]['kind'] == 'LOGICAL'
    for coordinate in ('x', 'y', 'width', 'height'): bay[coordinate] = None
    assert validate_package(archive)['module_bays'][0]['kind'] == 'LOGICAL'


def test_historical_placed_profile_restores_saved_layout_and_frozen_snapshots():
    from app.database import SessionLocal
    from app import models as m
    from tests.test_base_template_review import open_draft, check
    base, obj, _, document = setup()
    installation = document['bays'][0]['installation']
    custom = {**installation['layout'], 'x': .01, 'y': .02, 'width': .2, 'height': .15}
    with SessionLocal.begin() as session:
        session.get(m.ModuleInstallation, uuid.UUID(installation['id'])).layout = custom
    check(base, open_draft(base))
    current = package()
    historical = copy.deepcopy(current)
    del historical['module_places_version']
    for bay in historical['authoring']['ModuleBay']: del bay['kind']
    for name in ('BaseTemplateDraft', 'BaseTemplateCandidate'):
        for row in historical['authoring'][name]:
            for bay in row['definition']['bays']: bay.pop('kind', None)
    untouched = copy.deepcopy(historical)
    validate_package(historical)
    assert historical == untouched
    assert client.delete('/v1/workspace/dataset').status_code == 204
    assert client.post('/v1/workspace/package', json=historical).status_code == 204
    exported = package()
    expected = copy.deepcopy(historical)
    expected['module_places_version'] = 1
    for bay in expected['authoring']['ModuleBay']: bay['kind'] = 'PLACED'
    assert exported == expected
    assert exported['canonical'] == current['canonical']
    assert exported['authoring']['ModuleInstallation'] == current['authoring']['ModuleInstallation']
    configuration = client.get(f'/v1/topology/physical-objects/{obj}/configuration').json()
    assert configuration['bays'][0]['installation']['layout'] == custom
    assert {e['connection_point_id'] for e in configuration['bays'][0]['installation']['endpoints']} == {e['connection_point_id'] for e in installation['endpoints']}
    assert client.delete('/v1/workspace/dataset').status_code == 204
    assert client.post('/v1/workspace/package', json=exported).status_code == 204
    assert package() == exported
