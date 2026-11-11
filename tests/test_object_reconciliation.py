"""D2 behavior against real PostgreSQL, including workspace exchange."""
import copy
import uuid

from tests.port_type_fixtures import ensure_port_type_id

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
        revision_ = m.ModuleTemplateRevision(geometry={'width': 240, 'height': 80, 'fill_color': '#64748b', 'endpoints': {'other': {'x': .5, 'y': .5}}}, template_id=module.id, version_number=1, name='Module', compatibility='OCP3'); session.add(revision_); session.flush()
        definition = m.ModuleEndpointDefinition(module_revision_id=revision_.id, definition_key='other', display_name='Other', kind='NETWORK_PORT', port_type_id=uuid.UUID(ensure_port_type_id()), order_index=0)
        config = session.scalar(select(m.ObjectConfiguration).where(m.ObjectConfiguration.physical_object_id == uuid.UUID(oid(obj))))
        bay = session.scalar(select(m.ModuleBay).where(m.ModuleBay.base_revision_id == config.base_revision_id))
        installation = m.ModuleInstallation(layout={'panel_key': bay.panel_key, 'x': .1, 'y': .1, 'width': .2, 'height': .2}, configuration_id=config.id, module_revision_id=revision_.id, bay_key=bay.bay_key, orientation='HORIZONTAL')
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
    assert after['canonical'] == original['canonical']
    assert len(after['canonical']['NetworkInterface']) == 1
    assert len(after['canonical']['InterfacePhysicalBinding']) == 1
    assert len(after['canonical']['NetworkInterfacePhysicalOwner']) == 1
    assert len(after['authoring']['BuiltInEndpointMapping']) == 1
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






@pytest.mark.parametrize('corruption', ['missing_mapping', 'foreign_mapping'])
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
