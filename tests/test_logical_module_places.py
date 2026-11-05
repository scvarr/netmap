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
