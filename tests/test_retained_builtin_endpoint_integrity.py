"""D2 corrective: retained NETWORK_PORT ownership/binding and write safety."""
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.exc import OperationalError

from app import models as m
from app.database import SessionLocal
from app.main import reconcile_base_template_objects
from app.schemas import BaseTemplateImpactResult
from app.workspace_portability import export_package
from tests.test_base_template_review import check, open_draft
from tests.test_hardware_configuration import create_base, create_object
from tests.test_object_reconciliation import endpoint, oid, package, reconcile, revision


def damage(session, obj, case):
    _, interface_id = endpoint(obj)
    owner = session.scalar(select(m.NetworkInterfacePhysicalOwner).where(
        m.NetworkInterfacePhysicalOwner.interface_id == interface_id))
    binding = session.scalar(select(m.InterfacePhysicalBinding).where(
        m.InterfacePhysicalBinding.interface_id == interface_id))
    if case in ('missing_owner', 'missing_both'):
        session.delete(owner)
    elif case == 'foreign_owner':
        other = m.PhysicalObject(); session.add(other); session.flush()
        owner.physical_object_id = other.id
    if case in ('missing_binding', 'missing_both'):
        session.delete(binding)
    elif case == 'wrong_point':
        # A different owner also avoids acquiring a FK lock on the target object
        # in the concurrency test: the writer must contend on the binding row.
        other = m.PhysicalObject(); session.add(other); session.flush()
        point = m.ConnectionPoint(physical_object_id=other.id, cardinality=1)
        session.add(point); session.flush()
        binding.point_id = point.id
    elif case == 'wrong_interface':
        other = m.NetworkInterface(); session.add(other); session.flush()
        binding.interface_id = other.id
    elif case == 'wrong_member':
        binding.point_member = 2
    session.flush()


def expected_reason(obj, case):
    dependencies = []
    if case in ('missing_owner', 'foreign_owner', 'missing_both'):
        dependencies.append('NETWORK_INTERFACE_PHYSICAL_OWNERS')
    if case in ('missing_binding', 'wrong_point', 'wrong_interface', 'wrong_member', 'missing_both'):
        dependencies.append('INTERFACE_PHYSICAL_BINDINGS')
    return {'code': 'INVALID_ENDPOINT_MAPPING', 'key': obj['slots'][0]['slot_key'],
            'endpoint_name': 'MGMT', 'dependencies': dependencies}


@pytest.mark.parametrize('case', [
    'missing_owner', 'foreign_owner', 'missing_binding', 'wrong_point',
    'wrong_interface', 'wrong_member', 'missing_both',
])
def test_invalid_retained_port_refuses_advisory_and_apply_without_repair_and_valid_peer_updates(case):
    template_id, _ = create_base()
    broken, valid = create_object(template_id), create_object(template_id)
    target = revision(template_id, lambda d: d['body'].update(width=210))
    with SessionLocal.begin() as session:
        damage(session, broken, case)
    review = check(template_id, open_draft(template_id))['review']['result']
    # Diagnostics are persisted review data under the existing v5 contract.
    BaseTemplateImpactResult.model_validate(review)
    advisory = {r['physical_object_id']: r for r in review['objects']}
    reason = expected_reason(broken, case)
    assert advisory[oid(broken)]['classification'] == 'requires_intervention'
    assert advisory[oid(broken)]['reasons'] == [reason]
    assert advisory[oid(valid)]['classification'] == 'potentially_safe'
    before = package()
    results = reconcile(template_id)
    assert results[oid(broken)]['status'] == 'requires_intervention'
    assert results[oid(broken)]['reasons'] == [reason]
    assert results[oid(valid)]['status'] == 'updated'
    after = package()
    assert after['canonical'] == before['canonical']  # Includes all corrupt facts: no silent repair.
    configs = {c['physical_object_id']: c for c in before['authoring']['ObjectConfiguration']}
    broken_config, valid_config = configs[oid(broken)], configs[oid(valid)]
    for config in after['authoring']['ObjectConfiguration']:
        assert config == (broken_config if config['physical_object_id'] == oid(broken)
                          else {**valid_config, 'base_revision_id': target})
    for mapping in before['authoring']['BuiltInEndpointMapping']:
        current = next(r for r in after['authoring']['BuiltInEndpointMapping'] if r['id'] == mapping['id'])
        if mapping['configuration_id'] == broken_config['id']:
            assert current == mapping
        else:
            assert current['definition_id'] != mapping['definition_id']
            assert {**current, 'definition_id': mapping['definition_id']} == mapping
    # After reload the same diagnosis is derived from actual configuration/facts.
    state = open_draft(template_id)['publication_state']
    assert state['requires_intervention_count'] == 1
    assert state['objects'][0]['reasons'] == [reason]
    assert reconcile(template_id)[oid(broken)]['status'] == 'requires_intervention'
    assert package() == after


def apply_request(template_id):
    with SessionLocal() as session:
        return reconcile_base_template_objects(uuid.UUID(template_id), session)


@pytest.mark.parametrize('case,table', [
    ('missing_owner', 'network_interface_physical_owners'),
    ('foreign_owner', 'network_interface_physical_owners'),
    ('missing_binding', 'interface_physical_bindings'),
    ('wrong_point', 'interface_physical_bindings'),
])
def test_committed_owner_or_binding_change_is_seen_after_row_lock_wait(case, table):
    template_id, _ = create_base(); obj = create_object(template_id)
    revision(template_id, lambda d: d['body'].update(width=210))
    safe_review = check(template_id, open_draft(template_id))['review']['result']['objects'][0]
    assert safe_review['classification'] == 'potentially_safe'
    before = package()
    attempting_row_lock = threading.Event()
    with SessionLocal() as updater, SessionLocal.begin() as writer, ThreadPoolExecutor(max_workers=1) as pool:
        damage(writer, obj, case)
        expected_canonical = export_package(writer)['canonical']
        def before_execute(connection, cursor, statement, parameters, context, executemany):
            if f'FROM {table}' in statement and 'FOR SHARE' in statement:
                attempting_row_lock.set()
        def after_begin(session, transaction, connection):
            event.listen(connection, 'before_cursor_execute', before_execute)
        event.listen(updater, 'after_begin', after_begin)
        future = pool.submit(reconcile_base_template_objects, uuid.UUID(template_id), updater)
        assert attempting_row_lock.wait(5)
        writer.commit()
        result = future.result(timeout=5)['objects'][0]
    assert result['status'] == 'requires_intervention'
    assert result['reasons'] == [expected_reason(obj, case)]
    after = package()
    assert after['canonical'] == expected_canonical
    for name in ('ObjectConfiguration', 'BuiltInEndpointMapping'):
        assert after['authoring'][name] == before['authoring'][name]


@pytest.mark.parametrize('case', ['missing_owner', 'foreign_owner', 'missing_binding', 'wrong_member'])
def test_retained_tuple_rows_cannot_change_between_successful_preflight_and_commit(monkeypatch, case):
    import app.object_reconciliation as reconciliation
    template_id, _ = create_base(); obj = create_object(template_id)
    revision(template_id, lambda d: d['body'].update(width=210))
    before = package()
    preflight_done, release = threading.Event(), threading.Event()
    original = reconciliation.analyze_object
    def pause(session, config, definition):
        result = original(session, config, definition)
        assert result['classification'] == 'potentially_safe'
        preflight_done.set()
        assert release.wait(5)
        return result
    monkeypatch.setattr(reconciliation, 'analyze_object', pause)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(apply_request, template_id)
        try:
            assert preflight_done.wait(5)
            with pytest.raises(OperationalError) as error:
                with SessionLocal.begin() as writer:
                    writer.execute(text("SET LOCAL lock_timeout = '200ms'"))
                    damage(writer, obj, case)
            assert error.value.orig.sqlstate == '55P03'
        finally:
            release.set()
        assert future.result(timeout=5)['objects'][0]['status'] == 'updated'
    assert package()['canonical'] == before['canonical']
