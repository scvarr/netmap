"""E2 atomic module publication and retained installation provenance."""
import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from app.database import SessionLocal
from app.hardware_catalog import HardwareCatalog
from app.module_template_review import ModuleTemplateReview
from tests.test_module_template_review import open_draft, save, check, setup_installations
from tests.test_hardware_configuration import client, create_base, create_module, create_object, install


def publish(template_id, candidate_id):
    return client.post(f'/v1/library/module-templates/{template_id}/candidates/{candidate_id}/publish')


def prepared(template_id):
    draft = open_draft(template_id)
    return check(template_id, save(template_id, draft, {**draft['definition'], 'name': 'Published module'}))


def test_publication_preserves_history_runtime_and_retry():
    _, module, _ = setup_installations(1)
    tid = module['template_id']
    checked = prepared(tid)
    before = client.get('/v1/workspace/package').json()
    response = publish(tid, checked['review']['candidate_id'])
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['version_number'] == 2
    after = client.get('/v1/workspace/package').json()
    assert after['canonical'] == before['canonical']
    for key in ('ModuleInstallation', 'ModuleEndpointMapping', 'ModuleTemplateCandidate', 'ObjectConfiguration'):
        assert after['authoring'][key] == before['authoring'][key]
    draft = open_draft(tid)
    assert draft['source_revision_id'] == result['revision_id']
    assert draft['generation'] == checked['generation'] + 1
    assert draft['publication_state']['awaiting_update_count'] == 1
    latest = client.get('/v1/library/module-templates').json()['modules']
    assert len(latest) == 1 and latest[0]['revision_id'] == result['revision_id']
    assert latest[0]['name'] == 'Published module'
    save(tid, draft, {**draft['definition'], 'name': 'Later edit'})
    snapshot = client.get('/v1/workspace/package').json()
    assert publish(tid, checked['review']['candidate_id']).json() == result
    assert client.get('/v1/workspace/package').json() == snapshot
    assert client.delete('/v1/workspace/dataset').status_code == 204
    assert client.post('/v1/workspace/package', json=snapshot).status_code == 204
    assert client.get('/v1/workspace/package').json() == snapshot
    assert publish(tid, checked['review']['candidate_id']).json() == result


@pytest.mark.parametrize('same', [True, False])
def test_concurrent_publications(same):
    module = create_module(); tid = module['template_id']
    first = prepared(tid)
    second = first if same else check(tid, first)
    barrier = threading.Barrier(2)
    def run(cid):
        barrier.wait(timeout=10)
        return publish(tid, cid)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, [first['review']['candidate_id'], second['review']['candidate_id']]))
    assert sorted(r.status_code for r in results) == ([200, 200] if same else [200, 409])
    package = client.get('/v1/workspace/package').json()['authoring']
    assert len(package['ModuleTemplateRevision']) == 2
    assert len(package['ModuleTemplatePublication']) == 1


@pytest.mark.parametrize('change', ['draft', 'inputs', 'source', 'foreign'])
def test_stale_and_foreign_candidates(change):
    module = create_module(); tid = module['template_id']; checked = prepared(tid)
    if change == 'draft':
        save(tid, checked, {**checked['definition'], 'name': 'New draft'})
    elif change == 'inputs':
        create_module()
    elif change == 'source':
        other = check(tid, checked)
        assert publish(tid, other['review']['candidate_id']).status_code == 200
    else:
        tid = create_module()['template_id']
    before = client.get('/v1/workspace/package').json()
    response = publish(tid, checked['review']['candidate_id'])
    assert response.status_code == (422 if change == 'foreign' else 409), response.text
    if change != 'foreign':
        assert response.json()['error']['details']['recheck_required']
    assert client.get('/v1/workspace/package').json() == before


def test_partial_failure_rolls_back(monkeypatch):
    module = create_module(); tid = module['template_id']; checked = prepared(tid)
    before = client.get('/v1/workspace/package').json()
    original = HardwareCatalog._create_module_revision
    def fail(catalog, *args):
        original(catalog, *args)
        raise RuntimeError('injected failure')
    monkeypatch.setattr(HardwareCatalog, '_create_module_revision', fail)
    with pytest.raises(RuntimeError):
        publish(tid, checked['review']['candidate_id'])
    assert client.get('/v1/workspace/package').json() == before


@pytest.mark.parametrize('damage', ['receipt', 'names', 'both', 'definition', 'number', 'owner'])
def test_invalid_e2_archive_rejected(damage):
    module = create_module(); tid = module['template_id']; checked = prepared(tid)
    assert publish(tid, checked['review']['candidate_id']).status_code == 200
    package = client.get('/v1/workspace/package').json(); invalid = copy.deepcopy(package)
    authoring = invalid['authoring']
    if damage in ('receipt', 'both'):
        del authoring['ModuleTemplatePublication']
    if damage in ('names', 'both'):
        for r in authoring['ModuleTemplateRevision']: del r['name']
    if damage == 'definition': authoring['ModuleTemplateCandidate'][0]['definition']['endpoints'].reverse()
    if damage == 'number': authoring['ModuleTemplateRevision'][-1]['version_number'] = 9
    if damage == 'owner': authoring['ModuleTemplatePublication'][0]['revision_id'] = module['revision_id']
    assert client.post('/v1/workspace/package', json=invalid).status_code == 422
    assert client.get('/v1/workspace/package').json() == package


@pytest.mark.parametrize('compatibility', ['OCP3', 'ocp3', ' OCP3', 'OCP3 '])
def test_new_installation_pins_latest_with_exact_compatibility(compatibility):
    base_id, payload = create_base(); module = create_module(); tid = module['template_id']
    draft = open_draft(tid)
    checked = check(tid, save(tid, draft, {**draft['definition'], 'compatibility': compatibility}))
    result = publish(tid, checked['review']['candidate_id']).json()
    obj = create_object(base_id)
    response = install(obj['physical_object_ref']['entity_id'], tid, payload['bays'][0]['bay_key'])
    assert response.status_code == (201 if compatibility == 'OCP3' else 409), response.text
    if compatibility == 'OCP3':
        assert response.json()['bays'][0]['installation']['module_revision_id'] == result['revision_id']


def test_input_writers_blocked_during_publication(monkeypatch):
    from sqlalchemy import text
    from sqlalchemy.exc import OperationalError
    _, module, _ = setup_installations(1); tid = module['template_id']; checked = prepared(tid)
    original = ModuleTemplateReview._inputs
    blocked = []
    def inputs(review):
        result = original(review)
        with SessionLocal() as writer:
            writer.execute(text("SET LOCAL lock_timeout = '100ms'"))
            with pytest.raises(OperationalError) as error:
                writer.execute(text('UPDATE module_templates SET name = name'))
            assert error.value.orig.sqlstate == '55P03'
            blocked.append(True)
        return result
    monkeypatch.setattr(ModuleTemplateReview, '_inputs', inputs)
    assert publish(tid, checked['review']['candidate_id']).status_code == 200
    assert blocked == [True]

def test_diagnostics_intervention_and_delete_publication():
    _, module, _ = setup_installations(1); tid = module['template_id']
    draft = open_draft(tid)
    checked = check(tid, save(tid, draft, {**draft['definition'], 'compatibility': 'ocp3'}))
    assert publish(tid, checked['review']['candidate_id']).status_code == 200
    state = open_draft(tid)['publication_state']
    assert state['awaiting_update_count'] == 0 and state['requires_intervention_count'] == 1
    assert state['installations'][0]['source_revision_id'] == module['revision_id']
    assert state['installations'][0]['reasons'][0]['code'] == 'BAY_COMPATIBILITY_MISMATCH'
    assert client.delete(f'/v1/library/module-templates/{tid}').status_code == 409
    unused = create_module(); checked = prepared(unused['template_id'])
    assert publish(unused['template_id'], checked['review']['candidate_id']).status_code == 200
    assert client.delete(f"/v1/library/module-templates/{unused['template_id']}").status_code == 204
    assert len(client.get('/v1/workspace/package').json()['authoring']['ModuleTemplatePublication']) == 1
