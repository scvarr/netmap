"""E1: persisted advisory module review, without publication or reconciliation."""
import copy
import uuid

import pytest
from sqlalchemy import event, select, text

from app import models as m
from app.database import SessionLocal
from app.main import open_module_template_draft
from app.module_template_review import ModuleTemplateReview
from tests.test_hardware_configuration import client, create_base, create_module, create_object, install


def open_draft(template_id):
    response = client.get(f'/v1/library/module-templates/{template_id}/draft')
    assert response.status_code == 200, response.text
    return response.json()


def save(template_id, draft, definition):
    response = client.put(f'/v1/library/module-templates/{template_id}/draft', params={'expected_generation': draft['generation']}, json=definition)
    assert response.status_code == 200, response.text
    return response.json()


def check(template_id, draft):
    response = client.post(f'/v1/library/module-templates/{template_id}/draft/check', params={'expected_generation': draft['generation']})
    assert response.status_code == 200, response.text
    return response.json()


def setup_installations(count=2):
    base_id, payload = create_base()
    module = create_module()
    for _ in range(count):
        obj = create_object(base_id)
        response = install(obj['physical_object_ref']['entity_id'], module['template_id'], payload['bays'][0]['bay_key'])
        assert response.status_code == 201, response.text
    with SessionLocal() as session:
        ids = list(session.scalars(select(m.ModuleInstallation.id).order_by(m.ModuleInstallation.id)))
    return base_id, module, ids


def test_draft_identity_frozen_candidates_generation_and_no_runtime_writes():
    _, module, ids = setup_installations()
    template_id = module['template_id']
    before = client.get('/v1/workspace/package').json()
    draft = open_draft(template_id)
    definition = copy.deepcopy(draft['definition'])
    definition['name'] = ' Renamed draft '
    definition['endpoints'].reverse()
    definition['endpoints'][0]['display_name'] = ' New local name '
    definition['endpoints'].append({'key': str(uuid.uuid4()), 'display_name': 'Added', 'kind': 'CONNECTION_POINT'})
    saved = save(template_id, draft, definition)
    assert saved['generation'] == draft['generation'] + 1
    assert open_draft(template_id)['definition'] == definition
    checked = check(template_id, saved)
    assert checked['review']['current']
    assert {i['installation_id'] for i in checked['review']['result']['installations']} == {str(i) for i in ids}
    assert all(i['classification'] == 'potentially_safe' for i in checked['review']['result']['installations'])
    after = client.get('/v1/workspace/package').json()
    assert after['canonical'] == before['canonical']
    assert {k: v for k, v in after['authoring'].items() if k not in ('ModuleTemplateDraft', 'ModuleTemplateCandidate')} == {k: v for k, v in before['authoring'].items() if k not in ('ModuleTemplateDraft', 'ModuleTemplateCandidate')}
    assert client.put(f'/v1/library/module-templates/{template_id}/draft', params={'expected_generation': draft['generation']}, json=definition).status_code == 409
    assert client.post(f'/v1/library/module-templates/{template_id}/draft/check', params={'expected_generation': draft['generation']}).status_code == 409
    saved = save(template_id, checked, {**definition, 'name': 'Next'})
    assert not saved['review']['current'] and not open_draft(template_id)['review']['current']
    second = check(template_id, saved)
    assert second['review']['candidate_id'] != checked['review']['candidate_id']
    with SessionLocal() as session:
        candidate = session.get(m.ModuleTemplateCandidate, uuid.UUID(checked['review']['candidate_id']))
        assert candidate.definition == definition and candidate.result == checked['review']['result']


@pytest.mark.parametrize('compatibility', ['OCP3', 'ocp3', ' OCP3', 'OCP3 ', 'arbitrary user value'])
def test_exact_compatibility_no_relocation(compatibility):
    _, module, _ = setup_installations(1)
    template_id = module['template_id']
    draft = open_draft(template_id)
    saved = save(template_id, draft, {**draft['definition'], 'compatibility': compatibility})
    assert saved['definition']['compatibility'] == compatibility
    impact = check(template_id, saved)['review']['result']['installations'][0]
    assert impact['classification'] == ('potentially_safe' if compatibility == 'OCP3' else 'requires_intervention')
    if compatibility != 'OCP3':
        assert impact['reasons'] == [{'code': 'BAY_COMPATIBILITY_MISMATCH', 'compatibility': compatibility}]
    assert 'proposed_placements' not in impact


@pytest.mark.parametrize('dependency', ['none', 'metadata', 'connection', 'realization', 'l2', 'l3', 'binding', 'owner', 'other_mapping', 'security', 'nat', 'processing', 'routing'])
def test_removal_dependencies_are_per_installation(dependency):
    _, module, ids = setup_installations()
    with SessionLocal.begin() as session:
        mapping = session.scalar(select(m.ModuleEndpointMapping).where(m.ModuleEndpointMapping.installation_id == ids[0]).order_by(m.ModuleEndpointMapping.id))
        definition_key = session.get(m.ModuleEndpointDefinition, mapping.definition_id).definition_key
        interface_id, point_id = mapping.network_interface_id, mapping.connection_point_id
        config = session.get(m.ObjectConfiguration, session.get(m.ModuleInstallation, ids[0]).configuration_id)
        if dependency == 'metadata':
            session.scalar(select(m.EntityMetadata).where(m.EntityMetadata.network_interface_id == interface_id)).value = 'User name'
        elif dependency == 'connection':
            remote = m.ConnectionPoint(physical_object_id=config.physical_object_id, cardinality=1); session.add(remote); session.flush()
            connection = m.Connection(point_a_id=point_id, point_b_id=remote.id, cardinality=1); session.add(connection); session.flush()
            session.add(m.ConnectionMember(connection_id=connection.id, index=1, point_a_member=1, point_b_member=1))
        elif dependency == 'realization':
            upper = m.NetworkInterface(); session.add(upper); session.flush()
            session.add(m.NetworkInterfaceRealization(upper_interface_id=upper.id, lower_interface_id=interface_id))
        elif dependency == 'l2':
            context = m.L2ForwardingContext(); session.add(context); session.flush()
            session.add(m.L2Binding(interface_id=interface_id, forwarding_context_id=context.id))
        elif dependency == 'l3':
            context = m.RoutingContext(); session.add(context); session.flush()
            session.add(m.L3Binding(interface_id=interface_id, routing_context_id=context.id))
        elif dependency == 'binding':
            remote = m.ConnectionPoint(physical_object_id=config.physical_object_id, cardinality=1); session.add(remote); session.flush()
            session.add(m.InterfacePhysicalBinding(interface_id=interface_id, point_id=remote.id, point_member=1))
        elif dependency == 'owner':
            remote = m.PhysicalObject(); session.add(remote); session.flush()
            session.scalar(select(m.NetworkInterfacePhysicalOwner).where(m.NetworkInterfacePhysicalOwner.interface_id == interface_id)).physical_object_id = remote.id
        elif dependency == 'other_mapping':
            # A cross-model mapping is never the module's own mapping exemption.
            session.scalar(select(m.BuiltInEndpointMapping).where(m.BuiltInEndpointMapping.configuration_id == config.id)).connection_point_id = point_id
        elif dependency in ('security', 'nat', 'processing'):
            scope = {'ingress_network_interface_ids': [str(interface_id)]}
            if dependency == 'security':
                policy = m.SecurityPolicy(default_action='PERMIT', configured_completeness='COMPLETE'); session.add(policy); session.flush()
                session.add(m.SecurityPolicyAttachment(policy_id=policy.id, stage_order=1, scope=scope))
            elif dependency == 'nat':
                policy = m.NATPolicy(default_transform={'kind': 'IDENTITY'}, configured_completeness='COMPLETE'); session.add(policy); session.flush()
                session.add(m.NATPolicyAttachment(policy_id=policy.id, local_stage_order=1, scope=scope))
            else:
                context = m.RoutingContext(); plan = m.PacketProcessingPlan(configured_completeness='COMPLETE'); session.add_all([context, plan]); session.flush()
                attachment = m.PacketProcessingPlanAttachmentSet(routing_context_id=context.id, traffic_class='TRANSIT', configured_completeness='COMPLETE'); session.add(attachment); session.flush()
                session.add(m.PacketProcessingPlanAttachment(attachment_set_id=attachment.id, plan_id=plan.id, scope=scope))
        elif dependency == 'routing':
            policy = m.RoutingPolicy(default_selection={'kind': 'NO_MATCH'}, configured_completeness='COMPLETE'); session.add(policy); session.flush()
            session.add(m.RoutingPolicyRule(policy_id=policy.id, order_key=1, predicate={'op': 'NOT', 'child': {'op': 'INGRESS_NETWORK_INTERFACE_IN', 'ids': [str(interface_id)]}}, action={'kind': 'NO_MATCH'}))
    draft = open_draft(module['template_id'])
    definition = {**draft['definition'], 'endpoints': [e for e in draft['definition']['endpoints'] if e['key'] != definition_key]}
    saved = save(module['template_id'], draft, definition)
    before = client.get('/v1/workspace/package').json()['canonical']
    impacts = {i['installation_id']: i for i in check(module['template_id'], saved)['review']['result']['installations']}
    assert impacts[str(ids[0])]['classification'] == ('potentially_safe' if dependency == 'none' else 'requires_intervention')
    if dependency != 'none':
        assert any(r['code'] == 'ENDPOINT_DEPENDENCIES' for r in impacts[str(ids[0])]['reasons'])
    assert impacts[str(ids[1])]['classification'] == 'potentially_safe'
    assert client.get('/v1/workspace/package').json()['canonical'] == before


def test_all_revision_installations_and_kind_change_by_key():
    _, module, ids = setup_installations(1)
    from tests.test_module_template_deletion import add_revision
    revision_id = add_revision(module['template_id'])
    with SessionLocal() as session:
        config = session.get(m.ObjectConfiguration, session.get(m.ModuleInstallation, ids[0]).configuration_id)
        base_id = session.get(m.BaseTemplateRevision, config.base_revision_id).template_id
        bay_key = session.get(m.ModuleInstallation, ids[0]).bay_key
    object_id = create_object(str(base_id))['physical_object_ref']['entity_id']
    assert install(object_id, module['template_id'], bay_key).status_code == 201
    draft = open_draft(module['template_id'])
    assert draft['source_revision_id'] == str(revision_id)
    # Same label/order, different key is deletion + addition, never kind matching.
    definition = {**draft['definition'], 'endpoints': [{**e, 'kind': 'CONNECTION_POINT'} for e in module['endpoints']]}
    saved = save(module['template_id'], draft, definition)
    impacts = check(module['template_id'], saved)['review']['result']['installations']
    assert len(impacts) == 2
    old = next(i for i in impacts if i['source_revision_id'] == module['revision_id'])
    assert {r['code'] for r in old['reasons']} == {'ENDPOINT_KIND_CHANGE'}
    latest = next(i for i in impacts if i['source_revision_id'] == str(revision_id))
    assert latest['classification'] == 'potentially_safe'


def test_base_reviews_ignore_module_draft_candidate_tables():
    base_id, module, _ = setup_installations(1)
    from tests.test_base_template_review import check as base_check, open_draft as base_open
    checked = base_check(base_id, base_open(base_id))
    draft = open_draft(module['template_id'])
    check(module['template_id'], save(module['template_id'], draft, {**draft['definition'], 'name': 'Draft only'}))
    actual = base_open(base_id)['review']
    assert actual['candidate_id'] == checked['review']['candidate_id'] and actual['current']


def test_installation_changes_invalidate_review_and_read_has_no_write_locks():
    base_id, module, ids = setup_installations(1)
    template_id = module['template_id']
    checked = check(template_id, open_draft(template_id))
    with SessionLocal() as reader:
        def before_commit(session):
            assert session.scalar(text('SHOW transaction_isolation')) == 'repeatable read'
            modes = session.scalars(text("""SELECT l.mode FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                WHERE l.pid = pg_backend_pid() AND l.granted AND c.relnamespace = current_schema()::regnamespace AND c.relkind = 'r'""")).all()
            assert modes and all(mode == 'AccessShareLock' for mode in modes)
            with SessionLocal.begin() as writer:
                writer.execute(text("SET LOCAL lock_timeout = '750ms'"))
                writer.get(m.ModuleInstallation, ids[0]).orientation = 'VERTICAL'
        event.listen(reader, 'before_commit', before_commit)
        assert open_module_template_draft(uuid.UUID(template_id), reader)['review']['current']
    assert not open_draft(template_id)['review']['current']
    checked = check(template_id, checked)
    object_id = create_object(base_id)['physical_object_ref']['entity_id']
    with SessionLocal() as session:
        bay_key = session.get(m.ModuleInstallation, ids[0]).bay_key
    assert install(object_id, template_id, bay_key).status_code == 201
    assert not open_draft(template_id)['review']['current']
    assert len(check(template_id, checked)['review']['result']['installations']) == 2


@pytest.mark.parametrize('damage', ['missing_mapping', 'missing_binding', 'missing_owner', 'point_owner'])
def test_invalid_materialization_requires_intervention(damage):
    _, module, ids = setup_installations(1)
    with SessionLocal.begin() as session:
        mapping = session.scalar(select(m.ModuleEndpointMapping).where(m.ModuleEndpointMapping.installation_id == ids[0]))
        if damage == 'missing_mapping':
            session.delete(mapping)
        elif damage == 'missing_binding':
            session.delete(session.scalar(select(m.InterfacePhysicalBinding).where(m.InterfacePhysicalBinding.interface_id == mapping.network_interface_id)))
        elif damage == 'missing_owner':
            session.delete(session.scalar(select(m.NetworkInterfacePhysicalOwner).where(m.NetworkInterfacePhysicalOwner.interface_id == mapping.network_interface_id)))
        else:
            remote = m.PhysicalObject(); session.add(remote); session.flush()
            session.get(m.ConnectionPoint, mapping.connection_point_id).physical_object_id = remote.id
    impact = check(module['template_id'], open_draft(module['template_id']))['review']['result']['installations'][0]
    assert impact['classification'] == 'requires_intervention'
    assert impact['reasons'][0]['code'] == ('MISSING_ENDPOINT_MAPPING' if damage == 'missing_mapping' else 'INVALID_ENDPOINT_MAPPING')


def test_snapshot_check_and_freshness_after_concurrent_canonical_write(monkeypatch):
    _, module, ids = setup_installations(1)
    template_id = module['template_id']
    draft = open_draft(template_id)
    saved = save(template_id, draft, {**draft['definition'], 'endpoints': []})
    original = ModuleTemplateReview._inputs
    written = []

    def inputs(review):
        fingerprint = original(review)
        if not written:
            with SessionLocal.begin() as writer:
                writer.execute(text("SET LOCAL lock_timeout = '750ms'"))
                mapping = writer.scalar(select(m.ModuleEndpointMapping).where(m.ModuleEndpointMapping.installation_id == ids[0]))
                writer.scalar(select(m.EntityMetadata).where(m.EntityMetadata.network_interface_id == mapping.network_interface_id)).value = 'Concurrent user name'
                written.append(True)
        return fingerprint

    monkeypatch.setattr(ModuleTemplateReview, '_inputs', inputs)
    checked = check(template_id, saved)
    assert checked['review']['current']
    assert checked['review']['result']['installations'][0]['classification'] == 'potentially_safe'
    assert not open_draft(template_id)['review']['current']
    assert check(template_id, saved)['review']['result']['installations'][0]['classification'] == 'requires_intervention'


def test_concurrent_initialization_and_stale_writer():
    module = create_module(); template_id = uuid.UUID(module['template_id'])
    initialized = []
    with SessionLocal() as reader:
        def before_execute(connection, cursor, statement, parameters, context, executemany):
            if not initialized and 'FROM module_templates' in statement and 'FOR UPDATE' in statement:
                with SessionLocal() as writer:
                    initialized.append(open_module_template_draft(template_id, writer))
        event.listen(reader, 'after_begin', lambda session, transaction, connection: event.listen(connection, 'before_cursor_execute', before_execute))
        assert open_module_template_draft(template_id, reader) == initialized[0]
    # Read before another save commits, then acquire the save lock: refresh must
    # compare the current generation, not the session's cached ORM object.
    with SessionLocal.begin() as stale:
        stale.scalar(select(m.ModuleTemplateDraft).where(m.ModuleTemplateDraft.template_id == template_id))
        draft = initialized[0]
        save(str(template_id), draft, {**draft['definition'], 'name': 'Other writer'})
        from app.errors import ModelError
        with pytest.raises(ModelError):
            ModuleTemplateReview(stale).save(template_id, draft['definition'], draft['generation'])


def test_workspace_roundtrip_and_pre_e1_v5():
    _, module, _ = setup_installations(1)
    draft = open_draft(module['template_id'])
    definition = copy.deepcopy(draft['definition'])
    definition['endpoints'].reverse()
    definition['endpoints'][0]['display_name'] = 'Renamed'
    definition['endpoints'].append({'key': str(uuid.uuid4()), 'display_name': 'New', 'kind': 'CONNECTION_POINT'})
    checked = check(module['template_id'], save(module['template_id'], draft, definition))
    package = client.get('/v1/workspace/package').json()
    assert package['format_version'] == 5
    assert client.delete('/v1/workspace/dataset').status_code == 204
    response = client.post('/v1/workspace/package', json=package)
    assert response.status_code == 204, response.text
    assert client.get('/v1/workspace/package').json() == package
    assert open_draft(module['template_id'])['review'] == checked['review']
    for key in ('ModuleTemplateDraft', 'ModuleTemplateCandidate'):
        del package['authoring'][key]
    assert client.delete('/v1/workspace/dataset').status_code == 204
    assert client.post('/v1/workspace/package', json=package).status_code == 204
    assert not client.get('/v1/workspace/package').json()['authoring']['ModuleTemplateDraft']


def test_unused_module_deletion_cascades_review_records():
    module = create_module()
    check(module['template_id'], open_draft(module['template_id']))
    assert client.delete(f"/v1/library/module-templates/{module['template_id']}").status_code == 204
    authoring = client.get('/v1/workspace/package').json()['authoring']
    assert not authoring['ModuleTemplateDraft'] and not authoring['ModuleTemplateCandidate']


@pytest.mark.parametrize('damage', ['missing_collection', 'unknown_collection', 'unknown_definition', 'duplicate_key', 'foreign_source', 'generation', 'fingerprint', 'analysis', 'change', 'duplicate_impact'])
def test_invalid_module_review_archives_fail_without_writes(damage):
    _, module, _ = setup_installations(1)
    draft = open_draft(module['template_id'])
    check(module['template_id'], save(module['template_id'], draft, {**draft['definition'], 'name': 'Changed'}))
    package = client.get('/v1/workspace/package').json()
    candidate = package['authoring']['ModuleTemplateCandidate'][0]
    if damage == 'missing_collection':
        del package['authoring']['ModuleTemplateDraft']
    elif damage == 'unknown_collection':
        package['authoring']['Unknown'] = []
    elif damage == 'unknown_definition':
        candidate['definition']['unknown'] = True
    elif damage == 'duplicate_key':
        candidate['definition']['endpoints'].append(candidate['definition']['endpoints'][0])
    elif damage == 'foreign_source':
        other = create_module()
        package = client.get('/v1/workspace/package').json()
        package['authoring']['ModuleTemplateCandidate'][0]['source_revision_id'] = other['revision_id']
    elif damage == 'generation':
        candidate['draft_generation'] = 0
    elif damage == 'fingerprint':
        candidate['input_fingerprint'] = 'x' * 64
    elif damage == 'analysis':
        candidate['result']['installations'][0]['unknown'] = True
    elif damage == 'change':
        candidate['result']['changes'][0]['before'] = {'unknown': True}
    else:
        candidate['result']['installations'].append(candidate['result']['installations'][0])
    before = client.get('/v1/workspace/package').json()
    response = client.post('/v1/workspace/package', json=package)
    assert response.status_code == 422, response.text
    assert client.get('/v1/workspace/package').json() == before
