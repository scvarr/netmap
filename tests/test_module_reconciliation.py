"""E3 live preflight, identity, independent commits and v5 provenance."""
import copy
import uuid

import pytest
from sqlalchemy import select, delete
from app import models as m
from app.database import SessionLocal
from app.module_reconciliation import ModuleReconciliation, reconcile_installations
from tests.test_module_template_review import setup_installations, open_draft, save, check
from tests.test_module_template_publication import publish
from tests.test_hardware_configuration import client


def revision(tid, transform):
    draft = open_draft(tid)
    definition = copy.deepcopy(draft['definition'])
    transform(definition)
    candidate = check(tid, save(tid, draft, definition))
    response = publish(tid, candidate['review']['candidate_id'])
    assert response.status_code == 200, response.text
    return response.json()


def apply(tid):
    response = client.post(f'/v1/library/module-templates/{tid}/reconcile')
    assert response.status_code == 200, response.text
    return response.json()['installations']


def package():
    return client.get('/v1/workspace/package').json()


def test_skipped_revisions_identity_add_remove_and_retry():
    _, module, ids = setup_installations(1)
    tid = module['template_id']
    before = package()
    revision(tid, lambda d: d.update(name='Second'))
    def edit(d):
        d['endpoints'].reverse()
        d['endpoints'][0]['display_name'] = 'Renamed'
        d['endpoints'].append({'key': str(uuid.uuid4()), 'display_name': 'Added', 'kind': 'NETWORK_PORT'})
    target = revision(tid, edit)
    assert apply(tid)[0]['status'] == 'updated'
    after = package()
    assert before['authoring']['ObjectConfiguration'] == after['authoring']['ObjectConfiguration']
    old = {r['id']: r for r in before['authoring']['ModuleEndpointMapping']}
    new = {r['id']: r for r in after['authoring']['ModuleEndpointMapping']}
    for key, row in old.items():
        assert {k:v for k,v in row.items() if k != 'definition_id'} == {k:v for k,v in new[key].items() if k != 'definition_id'}
    for section in before['canonical']:
        assert all(r in after['canonical'][section] for r in before['canonical'][section])
    assert apply(tid)[0]['status'] == 'already_current'
    revision(tid, lambda d: d['endpoints'].pop())
    assert apply(tid)[0]['status'] == 'updated'
    assert package()['canonical'] == before['canonical']


@pytest.mark.parametrize('blocker', ['metadata', 'json', 'fk', 'binding', 'kind', 'missing', 'compatibility'])
def test_refusal_is_atomic(blocker):
    _, module, ids = setup_installations(1)
    tid = module['template_id']
    with SessionLocal.begin() as session:
        mapping = session.scalar(select(m.ModuleEndpointMapping).where(m.ModuleEndpointMapping.installation_id == ids[0]))
        key = session.get(m.ModuleEndpointDefinition, mapping.definition_id).definition_key
        if blocker == 'metadata':
            session.scalar(select(m.EntityMetadata).where(m.EntityMetadata.connection_point_id == mapping.connection_point_id)).value = 'Keep'
        if blocker == 'json':
            policy = m.SecurityPolicy(default_action='PERMIT', configured_completeness='COMPLETE'); session.add(policy); session.flush()
            session.add(m.SecurityPolicyAttachment(policy_id=policy.id, stage_order=1, scope={'ingress_network_interface_ids': [str(mapping.network_interface_id)]}))
        if blocker == 'fk':
            other = m.NetworkInterface(); session.add(other); session.flush()
            session.add(m.NetworkInterfaceRealization(upper_interface_id=other.id, lower_interface_id=mapping.network_interface_id))
        if blocker == 'binding':
            session.execute(delete(m.InterfacePhysicalBinding).where(m.InterfacePhysicalBinding.point_id == mapping.connection_point_id))
        if blocker == 'missing':
            session.delete(mapping)
    def edit(d):
        if blocker == 'compatibility':
            d['compatibility'] = 'different'
        elif blocker == 'kind':
            e = next(e for e in d['endpoints'] if e['key'] == key)
            e['kind'] = 'CONNECTION_POINT' if e['kind'] == 'NETWORK_PORT' else 'NETWORK_PORT'
        elif blocker != 'binding':
            d['endpoints'] = [e for e in d['endpoints'] if e['key'] != key]
    revision(tid, edit)
    before = package()
    assert apply(tid)[0]['status'] == 'requires_intervention'
    assert package() == before


def test_partial_success_rollback_mixed_archive(monkeypatch):
    _, module, ids = setup_installations(2)
    tid = module['template_id']
    revision(tid, lambda d: d['endpoints'].append({'key': str(uuid.uuid4()), 'display_name': 'Added', 'kind': 'NETWORK_PORT'}))
    original = ModuleReconciliation._add_endpoint
    def fail(self, config, installation, definition):
        result = original(self, config, installation, definition)
        if installation.id == ids[0]:
            raise RuntimeError('injected after materialization')
        return result
    monkeypatch.setattr(ModuleReconciliation, '_add_endpoint', fail)
    before = package()
    rows = apply(tid)
    assert [r['status'] for r in rows] == ['requires_intervention', 'updated']
    after = package()
    assert len({r['module_revision_id'] for r in after['authoring']['ModuleInstallation']}) == 2
    for key in ('ModuleInstallation', 'ModuleEndpointMapping'):
        assert [r for r in before['authoring'][key] if r.get('installation_id', r['id']) == str(ids[0])] == [r for r in after['authoring'][key] if r.get('installation_id', r['id']) == str(ids[0])]
    assert after['format_version'] == 5
    assert client.delete('/v1/workspace/dataset').status_code == 204
    response = client.post('/v1/workspace/package', json=after)
    assert response.status_code == 204, response.text
    assert package() == after
    monkeypatch.setattr(ModuleReconciliation, '_add_endpoint', original)
    assert [r['status'] for r in apply(tid)] == ['updated', 'already_current']


def test_changed_target_refuses():
    _, module, ids = setup_installations(1)
    tid = module['template_id']
    revision(tid, lambda d: d.update(name='new'))
    before = package()
    with SessionLocal.begin() as session:
        from app.errors import ModelError
        with pytest.raises(ModelError) as error:
            ModuleReconciliation(session).apply(uuid.UUID(tid), ids[0], uuid.UUID(module['revision_id']))
        assert error.value.details['reason'] == 'TARGET_REVISION_CHANGED'
    assert package() == before


@pytest.mark.parametrize('dependency', ['owner', 'binding', 'json', 'fk'])
def test_concurrent_writers_blocked_after_preflight(monkeypatch, dependency):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from sqlalchemy import text
    from sqlalchemy.exc import OperationalError
    _, module, ids = setup_installations(1)
    tid = module['template_id']
    with SessionLocal() as session:
        mapping = session.scalar(select(m.ModuleEndpointMapping).where(
            m.ModuleEndpointMapping.installation_id == ids[0], m.ModuleEndpointMapping.network_interface_id.is_not(None)))
        point_id, interface_id = mapping.connection_point_id, mapping.network_interface_id
    removing = dependency in ('json', 'fk')
    revision(tid, lambda d: d.update(endpoints=[] if removing else d['endpoints']))
    paused, release = threading.Event(), threading.Event()
    method = '_remove_endpoint' if removing else '_add_endpoint'
    # For retained endpoints pause at final flush, after live validation.
    original = ModuleReconciliation._remove_endpoint
    from app.module_reconciliation import analyze_installation as analyze
    def pause_analysis(*args):
        result = analyze(*args)
        if not removing:
            paused.set(); assert release.wait(5)
        return result
    def pause_remove(self, mapping):
        paused.set(); assert release.wait(5)
        return original(self, mapping)
    monkeypatch.setattr('app.module_reconciliation.analyze_installation', pause_analysis)
    monkeypatch.setattr(ModuleReconciliation, '_remove_endpoint', pause_remove)
    def run():
        with SessionLocal() as session:
            return reconcile_installations(session, uuid.UUID(tid))
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(run)
        try:
            assert paused.wait(5)
            with pytest.raises(OperationalError) as error:
                with SessionLocal.begin() as writer:
                    writer.execute(text("SET LOCAL lock_timeout = '200ms'"))
                    if dependency == 'owner':
                        writer.execute(delete(m.NetworkInterfacePhysicalOwner).where(m.NetworkInterfacePhysicalOwner.interface_id == interface_id))
                    elif dependency == 'binding':
                        writer.execute(delete(m.InterfacePhysicalBinding).where(m.InterfacePhysicalBinding.interface_id == interface_id))
                    elif dependency == 'fk':
                        other = m.NetworkInterface(); writer.add(other); writer.flush()
                        writer.add(m.NetworkInterfaceRealization(upper_interface_id=other.id, lower_interface_id=interface_id))
                    else:
                        policy = m.SecurityPolicy(default_action='PERMIT', configured_completeness='COMPLETE'); writer.add(policy); writer.flush()
                        writer.add(m.SecurityPolicyAttachment(policy_id=policy.id, stage_order=1, scope={'ingress_network_interface_ids': [str(interface_id)]}))
                    writer.flush()
            assert error.value.orig.sqlstate == '55P03'
        finally:
            release.set()
        assert future.result(timeout=5)['installations'][0]['status'] == 'updated'
