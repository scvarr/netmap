"""D2 locking guarantees using independent real PostgreSQL transactions."""
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.exc import OperationalError

from app import models as m
from app.database import SessionLocal
from app.main import reconcile_base_template_objects
from app.object_reconciliation import ObjectReconciliation
from tests.test_hardware_configuration import create_base, create_object, create_module, install
from tests.test_object_reconciliation import add_dependency, add_slot, connect, endpoint, oid, package, reconcile, revision


def apply_request(template_id):
    with SessionLocal() as session:
        return reconcile_base_template_objects(uuid.UUID(template_id), session)


def test_committing_connection_writer_is_seen_after_endpoint_lock_wait():
    template_id, _ = create_base(); obj = create_object(template_id)
    revision(template_id, lambda d: d.update(slots=[]))
    attempting_lock = threading.Event()
    with SessionLocal() as updater, SessionLocal.begin() as writer, ThreadPoolExecutor(max_workers=1) as pool:
        connect(writer, endpoint(obj)[0]); writer.flush()
        def before_execute(connection, cursor, statement, parameters, context, executemany):
            if 'FROM connection_points' in statement and 'FOR UPDATE' in statement:
                attempting_lock.set()
        def after_begin(session, transaction, connection):
            event.listen(connection, 'before_cursor_execute', before_execute)
        event.listen(updater, 'after_begin', after_begin)
        future = pool.submit(reconcile_base_template_objects, uuid.UUID(template_id), updater)
        assert attempting_lock.wait(5)
        writer.commit()
        result = future.result(timeout=5)['objects'][0]
    assert result['status'] == 'requires_intervention'
    assert 'CONNECTIONS' in result['reasons'][0]['dependencies']
    assert len(package()['canonical']['Connection']) == 1
    assert package()['authoring']['ObjectConfiguration'][0]['base_revision_id'] == obj['version_ref']['entity_id']


def test_existing_metadata_update_committed_during_preflight_is_rechecked():
    template_id, _ = create_base(); obj = create_object(template_id)
    revision(template_id, lambda d: d.update(slots=[]))
    attempting_metadata_lock = threading.Event()
    with SessionLocal() as updater, SessionLocal.begin() as writer, ThreadPoolExecutor(max_workers=1) as pool:
        add_dependency(writer, obj, 'interface_alias'); writer.flush()
        def before_execute(connection, cursor, statement, parameters, context, executemany):
            if 'FROM entity_metadata' in statement and 'FOR UPDATE' in statement:
                attempting_metadata_lock.set()
        def after_begin(session, transaction, connection):
            event.listen(connection, 'before_cursor_execute', before_execute)
        event.listen(updater, 'after_begin', after_begin)
        future = pool.submit(reconcile_base_template_objects, uuid.UUID(template_id), updater)
        assert attempting_metadata_lock.wait(5)
        writer.commit()
        result = future.result(timeout=5)['objects'][0]
    assert result['status'] == 'requires_intervention'
    assert 'ENTITY_METADATA' in result['reasons'][0]['dependencies']
    assert any(r['value'] == 'User alias' for r in package()['canonical']['EntityMetadata'])


@pytest.mark.parametrize('dependency', ['connection', 'interface_alias', 'binding', 'security', 'routing'])
def test_preflight_locks_protect_against_new_fk_json_and_existing_row_writers(monkeypatch, dependency):
    template_id, _ = create_base(); obj = create_object(template_id)
    revision(template_id, lambda d: d.update(slots=[]))
    preflight_done, release = threading.Event(), threading.Event()
    original = ObjectReconciliation._remove_endpoint
    def pause(self, mapping):
        preflight_done.set()
        assert release.wait(5)
        return original(self, mapping)
    monkeypatch.setattr(ObjectReconciliation, '_remove_endpoint', pause)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(apply_request, template_id)
        try:
            assert preflight_done.wait(5)
            with pytest.raises(OperationalError) as error:
                with SessionLocal.begin() as writer:
                    writer.execute(text("SET LOCAL lock_timeout = '200ms'"))
                    add_dependency(writer, obj, dependency)
                    writer.flush()
            assert error.value.orig.sqlstate == '55P03'
        finally:
            release.set()
        assert future.result(timeout=5)['objects'][0]['status'] == 'updated'
    assert package()['canonical']['ConnectionPoint'] == []
    assert package()['canonical']['Connection'] == []


def test_module_install_committed_while_object_lock_waited_causes_fresh_capacity_refusal():
    from app.hardware_catalog import HardwareCatalog
    from app.schemas import InstallModuleRequest
    template_id, payload = create_base(); obj = create_object(template_id); module = create_module()
    revision(template_id, lambda d: d.update(bays=[]))
    attempting_object_lock = threading.Event()
    with SessionLocal() as updater, SessionLocal.begin() as writer, ThreadPoolExecutor(max_workers=1) as pool:
        HardwareCatalog(writer).install_module(uuid.UUID(oid(obj)), InstallModuleRequest(
            module_template_id=uuid.UUID(module['template_id']), bay_key=payload['bays'][0]['bay_key'], orientation='VERTICAL'))
        def before_execute(connection, cursor, statement, parameters, context, executemany):
            if 'FROM physical_objects' in statement and 'FOR UPDATE' in statement:
                attempting_object_lock.set()
        def after_begin(session, transaction, connection):
            event.listen(connection, 'before_cursor_execute', before_execute)
        event.listen(updater, 'after_begin', after_begin)
        future = pool.submit(reconcile_base_template_objects, uuid.UUID(template_id), updater)
        assert attempting_object_lock.wait(5)
        writer.commit()
        result = future.result(timeout=5)['objects'][0]
    assert result['status'] == 'requires_intervention'
    assert result['reasons'][0]['code'] == 'INSUFFICIENT_COMPATIBLE_CAPACITY'
    after = package()
    assert after['authoring']['ModuleInstallation'][0]['orientation'] == 'VERTICAL'
    assert after['authoring']['ObjectConfiguration'][0]['base_revision_id'] == obj['version_ref']['entity_id']


def test_module_uninstall_and_reconciliation_share_object_lock_order(monkeypatch):
    from app.module_installation_deletion import ModuleInstallationDeletionCatalog
    template_id, payload = create_base(); obj = create_object(template_id); module = create_module()
    installed = install(oid(obj), module['template_id'], payload['bays'][0]['bay_key']).json()['bays'][0]['installation']
    revision(template_id, lambda d: add_slot(d))
    paused, release = threading.Event(), threading.Event()
    original = ObjectReconciliation._add_endpoint
    def pause(self, config, definition):
        paused.set()
        assert release.wait(5)
        return original(self, config, definition)
    monkeypatch.setattr(ObjectReconciliation, '_add_endpoint', pause)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(apply_request, template_id)
        try:
            assert paused.wait(5)
            with pytest.raises(OperationalError) as error:
                with SessionLocal.begin() as writer:
                    writer.execute(text("SET LOCAL lock_timeout = '200ms'"))
                    ModuleInstallationDeletionCatalog(writer).delete(uuid.UUID(oid(obj)), uuid.UUID(installed['id']))
            assert error.value.orig.sqlstate == '55P03'
        finally:
            release.set()
        assert future.result(timeout=5)['objects'][0]['status'] == 'updated'
    with SessionLocal.begin() as writer:
        ModuleInstallationDeletionCatalog(writer).delete(uuid.UUID(oid(obj)), uuid.UUID(installed['id']))
    assert package()['authoring']['ModuleInstallation'] == []


def test_additive_update_uses_no_global_writer_locks_and_other_objects_can_update(monkeypatch):
    template_id, _ = create_base(); first, second = sorted([create_object(template_id), create_object(template_id)], key=oid)
    target = revision(template_id, lambda d: add_slot(d))
    original = ObjectReconciliation._add_endpoint
    checked = []
    def inspect_locks(self, config, definition):
        if str(config.physical_object_id) == oid(first):
            modes = self.session.scalars(text("SELECT mode FROM pg_locks WHERE pid=pg_backend_pid() AND relation IS NOT NULL")).all()
            assert not {'ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'} & set(modes)
            with SessionLocal.begin() as other:
                other.execute(text("SET LOCAL lock_timeout = '200ms'"))
                result = ObjectReconciliation(other).apply(uuid.UUID(template_id), uuid.UUID(oid(second)), uuid.UUID(target))
                assert result['status'] == 'updated'
            checked.append(True)
        return original(self, config, definition)
    monkeypatch.setattr(ObjectReconciliation, '_add_endpoint', inspect_locks)
    result = reconcile(template_id)
    assert result[oid(first)]['status'] == 'updated'
    assert result[oid(second)]['status'] in ('updated', 'already_current')
    assert checked


def test_busy_object_fails_safely_without_blocking_other_objects():
    template_id, _ = create_base(); objects = [create_object(template_id) for _ in range(2)]
    revision(template_id, lambda d: add_slot(d))
    with SessionLocal.begin() as writer:
        writer.execute(select(m.PhysicalObject).where(m.PhysicalObject.id == uuid.UUID(oid(objects[0]))).with_for_update())
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(apply_request, template_id)
            result = {r['physical_object_id']: r for r in future.result(timeout=6)['objects']}
    assert result[oid(objects[0])]['reasons'] == [{'code': 'CONCURRENT_CHANGE'}]
    assert result[oid(objects[1])]['status'] == 'updated'
    after = package()
    assert len(after['canonical']['ConnectionPoint']) == 3
    assert next(c for c in after['authoring']['ObjectConfiguration'] if c['physical_object_id'] == oid(objects[0]))['base_revision_id'] == objects[0]['version_ref']['entity_id']


def test_simultaneous_retries_materialize_once():
    template_id, _ = create_base(); obj = create_object(template_id)
    revision(template_id, lambda d: add_slot(d))
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(apply_request, template_id) for _ in range(2)]
        statuses = [f.result(timeout=6)['objects'][0]['status'] for f in futures]
    assert sorted(statuses) == ['already_current', 'updated']
    after = package()
    assert len(after['canonical']['ConnectionPoint']) == len(after['authoring']['BuiltInEndpointMapping']) == 2
