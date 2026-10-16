"""D1 publication, preservation, freshness and PostgreSQL concurrency."""
import copy
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError

from app import models as m
from app.base_template_review import BaseTemplateReview, published_definition
from app.database import SessionLocal
from app.hardware_catalog import HardwareCatalog
from tests.test_base_template_review import check, open_draft, save
from tests.test_hardware_configuration import client, create_base, create_object, create_module, install


def publish(template_id, candidate_id):
    return client.post(f'/v1/library/base-templates/{template_id}/candidates/{candidate_id}/publish')


def prepared(template_id):
    draft = open_draft(template_id)
    definition = copy.deepcopy(draft['definition'])
    definition['name'] = 'Published name'
    definition['body']['width'] = 210
    definition['panels'][0]['width'] = 210
    definition['slots'].append({**definition['slots'][0], 'key': str(uuid.uuid4()), 'display_name': 'Added'})
    definition['internal_links'] = [{'from_slot_key': definition['slots'][0]['key'], 'to_slot_key': definition['slots'][1]['key']}]
    return check(template_id, save(template_id, draft, definition))


def test_publication_preserves_old_objects_and_revisions_and_new_objects_pin_current():
    template_id, payload = create_base()
    old = create_object(template_id)
    object_id = old['physical_object_ref']['entity_id']
    module = create_module()
    assert install(object_id, module['template_id'], payload['bays'][0]['bay_key']).status_code == 201
    from app.repository import CanonicalRepository, ConnectionMemberInput
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        remote = repository.add_physical_object()
        remote_point = repository.add_connection_point(remote.id, cardinality=1)
        connection, _ = repository.add_connection(
            uuid.UUID(old['slots'][0]['connection_point_ref']['entity_id']), remote_point.id, 1,
            [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
        session.add(m.Cable(connection_id=connection.id, label='Preserved cable label'))
    checked = prepared(template_id)
    before = client.get('/v1/workspace/package').json()
    configuration = client.get(f'/v1/topology/physical-objects/{object_id}/configuration').json()
    old_revision_id = old['version_ref']['entity_id']
    url = f'/v1/library/base-templates/{template_id}/versions/{old_revision_id}'
    old_revision = client.get(url).json()
    result = publish(template_id, checked['review']['candidate_id'])
    assert result.status_code == 200, result.text
    publication = result.json()
    assert publication['version_number'] == 2
    after = client.get('/v1/workspace/package').json()
    assert after['canonical'] == before['canonical']
    assert after['settings'] == before['settings']
    assert after['presentation'] == before['presentation']
    for name in ('ObjectConfiguration', 'BuiltInEndpointMapping', 'ModuleInstallation', 'ModuleEndpointMapping', 'BaseTemplateCandidate'):
        assert after['authoring'][name] == before['authoring'][name]
    for name in ('BaseTemplateRevision', 'PresentationPanel', 'BuiltInEndpointDefinition', 'BaseInternalLink', 'ModuleBay'):
        after_by_id = {r['id']: r for r in after['authoring'][name]}
        assert all(after_by_id[r['id']] == r for r in before['authoring'][name])
    assert client.get(url).json() == old_revision
    assert client.get(f'/v1/topology/physical-objects/{object_id}/configuration').json() == configuration
    with SessionLocal() as session:
        actual = published_definition(session, uuid.UUID(template_id), uuid.UUID(publication['revision_id']))
    expected = checked['definition']
    for field in ('name', 'default_physical_object_class', 'body'):
        assert actual[field] == expected[field]
    for section, key in (('panels', 'panel_key'), ('slots', 'key'), ('bays', 'bay_key')):
        assert {r[key]: r for r in actual[section]} == {r[key]: r for r in expected[section]}
    pairs = lambda d: {frozenset((l['from_slot_key'], l['to_slot_key'])) for l in d['internal_links']}
    assert pairs(actual) == pairs(expected)
    reopened = open_draft(template_id)
    assert reopened['source_revision_id'] == publication['revision_id']
    assert reopened['definition'] == checked['definition']
    assert reopened['generation'] == checked['generation'] + 1
    assert not reopened['review']['current']
    assert reopened['review']['published_revision_id'] == publication['revision_id']
    assert reopened['publication_state']['outdated_count'] == 1
    new = create_object(template_id)
    assert new['version_ref']['entity_id'] == publication['revision_id']
    assert len(new['slots']) == 2
    assert open_draft(template_id)['publication_state']['outdated_count'] == 1
    # Retry after unrelated changes and later saved edits returns the receipt,
    # without freshness checks, a duplicate revision or draft rewind.
    edited = save(template_id, reopened, {**reopened['definition'], 'name': 'Next draft'})
    retry_before = client.get('/v1/workspace/package').json()
    assert publish(template_id, checked['review']['candidate_id']).json() == publication
    assert client.get('/v1/workspace/package').json() == retry_before
    assert open_draft(template_id)['generation'] == edited['generation']


@pytest.mark.parametrize('change,reason', [('draft', 'DRAFT_CHANGED'), ('source', 'SOURCE_REVISION_CHANGED'), ('canonical', 'REVIEW_INPUTS_CHANGED'), ('object', 'REVIEW_INPUTS_CHANGED')])
def test_stale_publication_requires_new_check(change, reason):
    template_id, _ = create_base()
    obj = create_object(template_id)
    checked = prepared(template_id)
    if change == 'draft':
        save(template_id, checked, checked['definition'])
    elif change == 'source':
        other = check(template_id, checked)
        assert publish(template_id, other['review']['candidate_id']).status_code == 200
    elif change == 'canonical':
        with SessionLocal.begin() as session:
            session.get(m.ConnectionPoint, uuid.UUID(obj['slots'][0]['connection_point_ref']['entity_id'])).cardinality = 2
    else:
        create_object(template_id)
    before = client.get('/v1/workspace/package').json()
    response = publish(template_id, checked['review']['candidate_id'])
    assert response.status_code == 409, response.text
    assert response.json()['error']['details'] == {'reason': reason, 'recheck_required': True}
    assert client.get('/v1/workspace/package').json() == before
    if change in ('canonical', 'object'):
        rechecked = check(template_id, open_draft(template_id))
        assert publish(template_id, rechecked['review']['candidate_id']).status_code == 200


def test_foreign_candidate_cannot_publish():
    first, _ = create_base()
    second, _ = create_base()
    checked = prepared(first)
    before = client.get('/v1/workspace/package').json()
    assert publish(second, checked['review']['candidate_id']).status_code == 422
    assert publish(first, str(uuid.uuid4())).status_code == 422
    assert client.get('/v1/workspace/package').json() == before


@pytest.mark.parametrize('same_candidate', [True, False])
def test_concurrent_publication_creates_exactly_one_revision(same_candidate):
    template_id, _ = create_base()
    checked = prepared(template_id)
    candidates = [checked['review']['candidate_id']]
    candidates.append(candidates[0] if same_candidate else check(template_id, checked)['review']['candidate_id'])
    barrier = threading.Barrier(2)
    def request(candidate_id):
        barrier.wait(timeout=5)
        return publish(template_id, candidate_id)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(request, candidates))
    assert sorted(r.status_code for r in responses) == ([200, 200] if same_candidate else [200, 409])
    if same_candidate:
        assert responses[0].json() == responses[1].json()
    package = client.get('/v1/workspace/package').json()
    assert len(package['authoring']['BaseTemplateRevision']) == 2
    assert len(package['authoring']['BaseTemplatePublication']) == 1


def test_input_writers_cannot_change_validated_snapshot_before_commit(monkeypatch):
    template_id, _ = create_base()
    obj = create_object(template_id)
    checked = prepared(template_id)
    point_id = uuid.UUID(obj['slots'][0]['connection_point_ref']['entity_id'])
    original = BaseTemplateReview._inputs
    blocked = []
    def locked_inputs(review):
        fingerprint = original(review)
        with SessionLocal() as writer:
            writer.execute(text("SET LOCAL lock_timeout = '100ms'"))
            with pytest.raises(OperationalError) as failure:
                writer.execute(text('UPDATE connection_points SET cardinality = 2 WHERE id = :id'), {'id': point_id})
            assert failure.value.orig.sqlstate == '55P03'
            blocked.append(True)
        return fingerprint
    monkeypatch.setattr(BaseTemplateReview, '_inputs', locked_inputs)
    assert publish(template_id, checked['review']['candidate_id']).status_code == 200
    assert blocked == [True]
    with SessionLocal.begin() as writer:
        writer.execute(text("SET LOCAL lock_timeout = '100ms'"))
        writer.get(m.ConnectionPoint, point_id).cardinality = 2


def test_partial_revision_failure_rolls_back_receipt_draft_and_revision(monkeypatch):
    template_id, _ = create_base()
    checked = prepared(template_id)
    before = client.get('/v1/workspace/package').json()
    original = HardwareCatalog._create_version
    def fail_after_creation(catalog, *args):
        original(catalog, *args)
        raise RuntimeError('injected failure after revision creation')
    monkeypatch.setattr(HardwareCatalog, '_create_version', fail_after_creation)
    with pytest.raises(RuntimeError, match='injected failure'):
        publish(template_id, checked['review']['candidate_id'])
    assert client.get('/v1/workspace/package').json() == before
    monkeypatch.setattr(HardwareCatalog, '_create_version', original)
    assert publish(template_id, checked['review']['candidate_id']).status_code == 200


def test_derived_update_status_distinguishes_waiting_and_intervention():
    template_id, _ = create_base()
    safe, intervention = [create_object(template_id) for _ in range(2)]
    with SessionLocal.begin() as session:
        alias = session.scalar(select(m.EntityMetadata).where(m.EntityMetadata.network_interface_id == uuid.UUID(intervention['slots'][0]['network_interface_ref']['entity_id'])))
        alias.value = 'User data that must be retained'
    draft = open_draft(template_id)
    checked = check(template_id, save(template_id, draft, {**draft['definition'], 'slots': []}))
    assert publish(template_id, checked['review']['candidate_id']).status_code == 200
    state = open_draft(template_id)['publication_state']
    assert state['outdated_count'] == 2
    assert state['awaiting_update_count'] == 1
    assert state['requires_intervention_count'] == 1
    by_id = {o['physical_object_id']: o for o in state['objects']}
    assert by_id[safe['physical_object_ref']['entity_id']]['classification'] == 'potentially_safe'
    assert by_id[intervention['physical_object_ref']['entity_id']]['classification'] == 'requires_intervention'
    assert client.get('/v1/library/base-templates').json()['blueprints'][0]['publication_state'] == state


def test_library_revision_and_status_share_one_nonblocking_snapshot(monkeypatch):
    from app import main as main_module
    template_id, _ = create_base()
    create_object(template_id)
    checked = prepared(template_id)
    original = main_module.publication_state
    publications = []
    def publish_between_catalog_and_status(session, target_id):
        if not publications:
            response = publish(template_id, checked['review']['candidate_id'])
            assert response.status_code == 200, response.text
            publications.append(response.json())
        return original(session, target_id)
    monkeypatch.setattr(main_module, 'publication_state', publish_between_catalog_and_status)
    item = client.get('/v1/library/base-templates').json()['blueprints'][0]
    assert item['version_number'] == item['publication_state']['version_number'] == 1
    assert item['publication_state']['outdated_count'] == 0
    item = client.get('/v1/library/base-templates').json()['blueprints'][0]
    assert item['version_number'] == item['publication_state']['version_number'] == 2
    assert item['publication_state']['outdated_count'] == 1


def test_published_workspace_v5_roundtrip_preserves_receipt_and_rebased_draft():
    template_id, _ = create_base()
    create_object(template_id)
    checked = prepared(template_id)
    result = publish(template_id, checked['review']['candidate_id']).json()
    create_object(template_id)
    draft = open_draft(template_id)
    package = client.get('/v1/workspace/package').json()
    assert package['format_version'] == 5
    assert client.delete('/v1/workspace/dataset').status_code == 204
    assert client.post('/v1/workspace/package', json=package).status_code == 204
    assert client.get('/v1/workspace/package').json() == package
    assert open_draft(template_id) == draft
    assert publish(template_id, checked['review']['candidate_id']).json() == result
    assert client.delete('/v1/workspace/dataset').status_code == 204
    invalid = copy.deepcopy(package)
    revision = next(r for r in invalid['authoring']['BaseTemplateRevision'] if r['id'] == result['revision_id'])
    revision['name'] = 'Does not match frozen candidate'
    response = client.post('/v1/workspace/package', json=invalid)
    assert response.status_code == 422, response.text
    invalid = copy.deepcopy(package)
    invalid['authoring']['BaseTemplateCandidate'][0]['definition']['panels'] = []
    assert client.post('/v1/workspace/package', json=invalid).status_code == 422
