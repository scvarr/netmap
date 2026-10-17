"""D2 behavior against real PostgreSQL, including workspace exchange."""
import copy
import uuid

import pytest
from sqlalchemy import select

from app import models as m
from app.database import SessionLocal
from app.object_reconciliation import ObjectReconciliation
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests.test_base_template_publication import publish
from tests.test_base_template_review import check, open_draft, save
from tests.test_hardware_configuration import client, create_base, create_object, create_module, install


def package():
    response = client.get('/v1/workspace/package')
    assert response.status_code == 200, response.text
    return response.json()


def revision(template_id, edit):
    draft = open_draft(template_id)
    definition = copy.deepcopy(draft['definition'])
    edit(definition)
    checked = check(template_id, save(template_id, draft, definition))
    response = publish(template_id, checked['review']['candidate_id'])
    assert response.status_code == 200, response.text
    return response.json()['revision_id']


def reconcile(template_id):
    response = client.post(f'/v1/library/base-templates/{template_id}/reconcile')
    assert response.status_code == 200, response.text
    return {r['physical_object_id']: r for r in response.json()['objects']}


def oid(obj):
    return obj['physical_object_ref']['entity_id']


def endpoint(obj):
    slot = obj['slots'][0]
    return uuid.UUID(slot['connection_point_ref']['entity_id']), uuid.UUID(slot['network_interface_ref']['entity_id'])


def add_slot(definition, key='added-network', kind='NETWORK_PORT'):
    definition['slots'].append({**definition['slots'][0], 'key': key, 'display_name': key, 'kind': kind})


def connect(session, point_id):
    repository = CanonicalRepository(session)
    remote = repository.add_physical_object()
    point = repository.add_connection_point(remote.id, 1)
    connection, _ = repository.add_connection(point_id, point.id, 1,
        [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
    session.add(m.Cable(connection_id=connection.id, label='User cable'))
    return connection


def add_dependency(session, obj, dependency):
    point_id, interface_id = endpoint(obj)
    repository = CanonicalRepository(session)
    if dependency == 'connection':
        connect(session, point_id)
    elif dependency in ('point_alias', 'interface_alias'):
        field = m.EntityMetadata.connection_point_id if dependency == 'point_alias' else m.EntityMetadata.network_interface_id
        session.scalar(select(m.EntityMetadata).where(field == (point_id if dependency == 'point_alias' else interface_id))).value = 'User alias'
    elif dependency in ('upper_realization', 'lower_realization'):
        other = repository.add_network_interface()
        upper, lower = (other.id, interface_id) if dependency == 'upper_realization' else (interface_id, other.id)
        session.add(m.NetworkInterfaceRealization(upper_interface_id=upper, lower_interface_id=lower))
    elif dependency == 'binding':
        other = repository.add_connection_point(uuid.UUID(oid(obj)), 1)
        session.add(m.InterfacePhysicalBinding(interface_id=interface_id, point_id=other.id, point_member=1))
    elif dependency == 'l2':
        context = m.L2ForwardingContext(); session.add(context); session.flush()
        session.add(m.L2Binding(interface_id=interface_id, forwarding_context_id=context.id))
    elif dependency == 'l3':
        context = m.RoutingContext(); session.add(context); session.flush()
        session.add(m.L3Binding(interface_id=interface_id, routing_context_id=context.id))
    elif dependency in ('security', 'nat', 'processing'):
        scope = {'ingress_network_interface_ids': [str(interface_id)]}
        if dependency == 'security':
            policy = m.SecurityPolicy(default_action='PERMIT', configured_completeness='COMPLETE'); session.add(policy); session.flush()
            session.add(m.SecurityPolicyAttachment(policy_id=policy.id, stage_order=1, scope=scope))
        elif dependency == 'nat':
            policy = m.NATPolicy(default_transform={'kind': 'IDENTITY'}, configured_completeness='COMPLETE'); session.add(policy); session.flush()
            session.add(m.NATPolicyAttachment(policy_id=policy.id, local_stage_order=1, scope=scope))
        else:
            context = m.RoutingContext(); plan = m.PacketProcessingPlan(configured_completeness='COMPLETE')
            session.add_all([context, plan]); session.flush()
            attachment_set = m.PacketProcessingPlanAttachmentSet(routing_context_id=context.id, traffic_class='TRANSIT', configured_completeness='COMPLETE')
            session.add(attachment_set); session.flush()
            session.add(m.PacketProcessingPlanAttachment(attachment_set_id=attachment_set.id, plan_id=plan.id, scope=scope))
    elif dependency == 'routing':
        policy = m.RoutingPolicy(default_selection={'kind': 'NO_MATCH'}, configured_completeness='COMPLETE'); session.add(policy); session.flush()
        session.add(m.RoutingPolicyRule(policy_id=policy.id, order_key=1, predicate={
            'op': 'NOT', 'child': {'op': 'INGRESS_NETWORK_INTERFACE_IN', 'ids': [str(interface_id)]}}, action={'kind': 'NO_MATCH'}))
    elif dependency == 'unknown_json':
        # Unrecognized shape and UUID spelling must fail closed too.
        policy = m.SecurityPolicy(default_action='PERMIT', configured_completeness='COMPLETE'); session.add(policy); session.flush()
        session.add(m.SecurityPolicyAttachment(policy_id=policy.id, stage_order=1,
            scope={str(point_id).upper(): f'opaque reference: {str(interface_id).upper()}'}))
    elif dependency == 'mapping':
        module = m.ModuleTemplate(name='Other'); session.add(module); session.flush()
        revision_ = m.ModuleTemplateRevision(template_id=module.id, version_number=1, compatibility='OCP3'); session.add(revision_); session.flush()
        definition = m.ModuleEndpointDefinition(module_revision_id=revision_.id, definition_key='other', display_name='Other', kind='NETWORK_PORT', order_index=0)
        config = session.scalar(select(m.ObjectConfiguration).where(m.ObjectConfiguration.physical_object_id == uuid.UUID(oid(obj))))
        bay = session.scalar(select(m.ModuleBay).where(m.ModuleBay.base_revision_id == config.base_revision_id))
        installation = m.ModuleInstallation(configuration_id=config.id, module_revision_id=revision_.id, bay_key=bay.bay_key, orientation='HORIZONTAL')
        session.add_all([definition, installation]); session.flush()
        session.add(m.ModuleEndpointMapping(installation_id=installation.id, definition_id=definition.id, connection_point_id=point_id, network_interface_id=interface_id))
    else:
        raise AssertionError(dependency)


@pytest.mark.parametrize('skip_revision', [False, True])
def test_identity_additions_alias_and_idempotency_with_revision_skips(skip_revision):
    template_id, _ = create_base()
    obj = create_object(template_id)
    point_id, interface_id = endpoint(obj)
    with SessionLocal.begin() as session:
        connect(session, point_id)
        add_dependency(session, obj, 'interface_alias')
    original = package()
    if skip_revision:
        revision(template_id, lambda d: d['slots'][0].update(display_name='Intermediate'))
    def edit(d):
        d['slots'][0]['display_name'] = 'Renamed definition'
        d['slots'][0]['rendered_position']['x'] = .8
        add_slot(d)
        add_slot(d, 'added-point', 'CONNECTION_POINT')
    target = revision(template_id, edit)
    assert reconcile(template_id)[oid(obj)]['status'] == 'updated'
    after = package()
    for name, rows in original['canonical'].items():
        actual = {r['id']: r for r in after['canonical'][name]}
        assert all(actual[r['id']] == r for r in rows), name
    mapping = original['authoring']['BuiltInEndpointMapping'][0]
    new_mapping = next(r for r in after['authoring']['BuiltInEndpointMapping'] if r['id'] == mapping['id'])
    assert new_mapping['connection_point_id'] == str(point_id)
    assert new_mapping['network_interface_id'] == str(interface_id)
    assert new_mapping['definition_id'] != mapping['definition_id']
    assert after['authoring']['ObjectConfiguration'][0]['base_revision_id'] == target
    assert len(after['canonical']['ConnectionPoint']) == len(original['canonical']['ConnectionPoint']) + 2
    assert len(after['canonical']['NetworkInterface']) == 2
    assert len(after['canonical']['InterfacePhysicalBinding']) == 2
    assert len(after['canonical']['NetworkInterfacePhysicalOwner']) == 2
    assert len(after['authoring']['BuiltInEndpointMapping']) == 3
    for mapping_ in after['authoring']['BuiltInEndpointMapping']:
        point = next(p for p in after['canonical']['ConnectionPoint'] if p['id'] == mapping_['connection_point_id'])
        assert point['physical_object_id'] == oid(obj) and point['cardinality'] == 1
        if mapping_['network_interface_id']:
            assert any(b['interface_id'] == mapping_['network_interface_id'] and b['point_id'] == point['id']
                       and b['point_member'] == 1 for b in after['canonical']['InterfacePhysicalBinding'])
            assert any(o['interface_id'] == mapping_['network_interface_id'] and o['physical_object_id'] == oid(obj)
                       for o in after['canonical']['NetworkInterfacePhysicalOwner'])
    assert reconcile(template_id)[oid(obj)]['status'] == 'already_current'
    assert package() == after
    state = open_draft(template_id)['publication_state']
    assert state['outdated_count'] == 0
    assert [o['physical_object_id'] for o in state['current_objects']] == [oid(obj)]


@pytest.mark.parametrize('kind', ['NETWORK_PORT', 'CONNECTION_POINT'])
def test_unused_endpoint_removal(kind):
    from tests.test_hardware_configuration import base_payload
    payload = base_payload(); payload['slots'][0]['kind'] = kind
    template_id, _ = create_base(payload)
    obj = create_object(template_id)
    revision(template_id, lambda d: d.update(slots=[]))
    assert reconcile(template_id)[oid(obj)]['status'] == 'updated'
    after = package()
    for name in ('ConnectionPoint', 'NetworkInterface', 'InterfacePhysicalBinding', 'NetworkInterfacePhysicalOwner'):
        assert after['canonical'][name] == []
    assert after['authoring']['BuiltInEndpointMapping'] == []


@pytest.mark.parametrize('dependency', [
    'connection', 'point_alias', 'interface_alias', 'binding', 'upper_realization', 'lower_realization',
    'l2', 'l3', 'security', 'nat', 'processing', 'routing', 'unknown_json', 'mapping',
])
def test_removal_refuses_every_dependency_and_preserves_whole_object(dependency):
    template_id, _ = create_base()
    obj = create_object(template_id)
    with SessionLocal.begin() as session:
        add_dependency(session, obj, dependency)
    revision(template_id, lambda d: d.update(slots=[]))
    before = package()
    result = reconcile(template_id)[oid(obj)]
    assert result['status'] == 'requires_intervention'
    assert result['reasons'][0]['code'] == 'ENDPOINT_DEPENDENCIES'
    assert result['reasons'][0]['dependencies']
    assert package() == before
    assert open_draft(template_id)['publication_state']['requires_intervention_count'] == 1
    assert client.get(f'/v1/topology/physical-objects/{oid(obj)}').status_code == 200


@pytest.mark.parametrize('corruption', ['kind', 'missing_mapping', 'foreign_mapping'])
def test_ambiguous_identity_is_not_recreated(corruption):
    template_id, _ = create_base(); obj = create_object(template_id)
    if corruption == 'kind':
        revision(template_id, lambda d: d['slots'][0].update(kind='CONNECTION_POINT'))
    else:
        target = revision(template_id, lambda d: d.update(name='Changed'))
        with SessionLocal.begin() as session:
            mapping = session.scalar(select(m.BuiltInEndpointMapping))
            if corruption == 'missing_mapping':
                session.delete(mapping)
            else:
                mapping.definition_id = session.scalar(select(m.BuiltInEndpointDefinition.id).where(m.BuiltInEndpointDefinition.base_revision_id == uuid.UUID(target)))
    before = package()
    assert reconcile(template_id)[oid(obj)]['status'] == 'requires_intervention'
    assert package() == before


@pytest.mark.parametrize('capacity', [0, 1, 2])
def test_module_capacity_and_deterministic_relocation(capacity):
    from tests.test_hardware_configuration import base_payload
    payload = base_payload(); bay = payload['bays'][0]
    payload['bays'].append({**bay, 'bay_key': 'old-second'})
    template_id, _ = create_base(payload); obj = create_object(template_id); module = create_module()
    for index, b in enumerate(payload['bays']):
        assert install(oid(obj), module['template_id'], b['bay_key'], 'VERTICAL' if index else 'HORIZONTAL').status_code == 201
    with SessionLocal.begin() as session:
        point = session.scalar(select(m.ModuleEndpointMapping.connection_point_id))
        connect(session, point)
    revision(template_id, lambda d: d.update(bays=[{**bay, 'bay_key': f'new-{i}'} for i in reversed(range(capacity))]))
    before = package()
    result = reconcile(template_id)[oid(obj)]
    if capacity < 2:
        assert result['status'] == 'requires_intervention'
        assert result['reasons'][0]['code'] == 'INSUFFICIENT_COMPATIBLE_CAPACITY'
        assert package() == before
    else:
        assert result['status'] == 'updated'
        after = package()
        assert after['canonical'] == before['canonical']
        assert after['authoring']['ModuleEndpointMapping'] == before['authoring']['ModuleEndpointMapping']
        for index, (old, new) in enumerate(zip(before['authoring']['ModuleInstallation'], after['authoring']['ModuleInstallation'])):
            assert new == {**old, 'bay_key': f'new-{index}'}
        assert reconcile(template_id)[oid(obj)]['status'] == 'already_current'
        assert package() == after


def test_valid_placement_is_preserved_and_compatibility_swaps_are_atomic():
    from tests.test_hardware_configuration import base_payload
    payload = base_payload(); bay = payload['bays'][0]
    payload['bays'] = [{**bay, 'bay_key': 'a'}, {**bay, 'bay_key': 'b', 'compatibility': 'Other'}, {**bay, 'bay_key': 'stable'}]
    template_id, _ = create_base(payload); obj = create_object(template_id)
    modules = [create_module(), create_module('Other')]
    for key, module in [('a', modules[0]), ('b', modules[1]), ('stable', modules[0])]:
        assert install(oid(obj), module['template_id'], key).status_code == 201
    def edit(d):
        d['bays'][0]['compatibility'], d['bays'][1]['compatibility'] = d['bays'][1]['compatibility'], d['bays'][0]['compatibility']
    revision(template_id, edit)
    before = package()
    assert reconcile(template_id)[oid(obj)]['status'] == 'updated'
    after = package()
    assert after['canonical'] == before['canonical']
    for old, new in zip(before['authoring']['ModuleInstallation'], after['authoring']['ModuleInstallation']):
        assert new == {**old, 'bay_key': {'a': 'b', 'b': 'a', 'stable': 'stable'}[old['bay_key']]}


@pytest.mark.parametrize('case', ['add_free', 'add_new', 'connected', 'cardinality', 'remove_link'])
def test_internal_links_never_delete_connections_or_overwrite_capacity(case):
    from tests.test_hardware_configuration import base_payload
    payload = base_payload(); add_slot(payload, 'peer', 'CONNECTION_POINT')
    pair = {'from_slot_key': payload['slots'][0]['key'], 'to_slot_key': 'peer'}
    if case == 'remove_link':
        payload['internal_links'] = [pair]
    template_id, _ = create_base(payload); obj = create_object(template_id)
    if case in ('connected', 'cardinality'):
        with SessionLocal.begin() as session:
            if case == 'connected':
                connect(session, endpoint(obj)[0])
            else:
                session.get(m.ConnectionPoint, endpoint(obj)[0]).cardinality = 2
    def edit(d):
        if case == 'add_new':
            add_slot(d, 'new-left'); add_slot(d, 'new-right')
            d['internal_links'] = [{'from_slot_key': 'new-left', 'to_slot_key': 'new-right'}]
        else:
            d['internal_links'] = [] if case == 'remove_link' else [pair]
    revision(template_id, edit)
    before = package()
    result = reconcile(template_id)[oid(obj)]
    if case in ('add_free', 'add_new'):
        assert result['status'] == 'updated'
        after = package()
        assert len(after['canonical']['Connection']) == 1
        assert len(after['canonical']['ConnectionMember']) == 1
        assert reconcile(template_id)[oid(obj)]['status'] == 'already_current'
        assert package() == after
    else:
        assert result['status'] == 'requires_intervention'
        assert package() == before


def test_failure_rolls_back_partial_materialization_and_other_objects_commit(monkeypatch):
    template_id, _ = create_base()
    objects = [create_object(template_id) for _ in range(3)]
    target = revision(template_id, lambda d: add_slot(d))
    before = package()
    blocked_id = sorted(oid(o) for o in objects)[1]
    original = ObjectReconciliation._add_endpoint
    def fail_after_write(self, config, definition):
        mapping = original(self, config, definition)
        if str(config.physical_object_id) == blocked_id:
            raise RuntimeError('Injected after point/interface/owner/binding/mapping creation')
        return mapping
    monkeypatch.setattr(ObjectReconciliation, '_add_endpoint', fail_after_write)
    results = reconcile(template_id)
    assert results[blocked_id]['status'] == 'requires_intervention'
    assert results[blocked_id]['reasons'] == [{'code': 'APPLY_FAILED'}]
    assert all(r['status'] == 'updated' for i, r in results.items() if i != blocked_id)
    after = package()
    assert len(after['canonical']['ConnectionPoint']) == 5
    for config in after['authoring']['ObjectConfiguration']:
        old = next(r for r in before['authoring']['ObjectConfiguration'] if r['id'] == config['id'])
        assert config == (old if config['physical_object_id'] == blocked_id else {**old, 'base_revision_id': target})
    for row in before['authoring']['BuiltInEndpointMapping']:
        if row['configuration_id'] == next(c['id'] for c in before['authoring']['ObjectConfiguration'] if c['physical_object_id'] == blocked_id):
            assert row in after['authoring']['BuiltInEndpointMapping']


def test_failure_after_complete_reconciliation_rolls_back_deletions_relocation_links_and_revision(monkeypatch):
    template_id, payload = create_base(); obj = create_object(template_id); module = create_module()
    assert install(oid(obj), module['template_id'], payload['bays'][0]['bay_key']).status_code == 201
    def edit(d):
        add_slot(d, 'left'); add_slot(d, 'right', 'CONNECTION_POINT')
        d['slots'] = [s for s in d['slots'] if s['key'] in ('left', 'right')]
        d['internal_links'] = [{'from_slot_key': 'left', 'to_slot_key': 'right'}]
        d['bays'][0]['bay_key'] = 'relocated'
    revision(template_id, edit)
    before = package()
    original = ObjectReconciliation.apply
    def fail(self, *args):
        result = original(self, *args)
        assert result['status'] == 'updated'
        assert self.session.scalar(select(m.ModuleInstallation.bay_key)) == 'relocated'
        assert self.session.scalar(select(m.Connection.id)) is not None
        raise RuntimeError('Injected after full reconciliation, before commit')
    monkeypatch.setattr(ObjectReconciliation, 'apply', fail)
    assert reconcile(template_id)[oid(obj)]['reasons'] == [{'code': 'APPLY_FAILED'}]
    assert package() == before


def test_updated_and_blocked_objects_round_trip_with_module_connections():
    template_id, payload = create_base()
    safe, blocked, modular = [create_object(template_id) for _ in range(3)]
    module = create_module(); assert install(oid(modular), module['template_id'], payload['bays'][0]['bay_key']).status_code == 201
    with SessionLocal.begin() as session:
        add_dependency(session, blocked, 'interface_alias')
        connect(session, session.scalar(select(m.ModuleEndpointMapping.connection_point_id)))
    revision(template_id, lambda d: (d.update(slots=[]), d['bays'][0].update(bay_key='relocated')))
    results = reconcile(template_id)
    assert results[oid(blocked)]['status'] == 'requires_intervention'
    assert results[oid(safe)]['status'] == results[oid(modular)]['status'] == 'updated'
    before = package()
    states = open_draft(template_id)['publication_state']
    assert client.delete('/v1/workspace/dataset').status_code == 204  # isolated netmap_test only
    imported = client.post('/v1/workspace/package', json=before)
    assert imported.status_code == 204, imported.text
    assert package() == before
    assert open_draft(template_id)['publication_state'] == states
    assert reconcile(template_id)[oid(safe)]['status'] == 'already_current'
    assert package() == before
