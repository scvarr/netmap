import uuid

import pytest
from sqlalchemy import or_, select

from app.database import SessionLocal
from app.models import (
    BuiltInEndpointMapping, ConnectionPoint, EntityMetadata, InterfacePhysicalBinding,
    L2Binding, L2ForwardingContext, L3Binding, ModuleEndpointMapping, ModuleInstallation,
    ModuleTemplate, ModuleTemplateRevision, NATPolicy, NATPolicyAttachment, NetworkInterface,
    NetworkInterfacePhysicalOwner, NetworkInterfaceRealization, PacketProcessingPlan,
    PacketProcessingPlanAttachment, PacketProcessingPlanAttachmentSet, PhysicalObject,
    RoutingPolicy, RoutingPolicyRule, RoutingTable, SecurityPolicy, SecurityPolicyAttachment,
)
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests.test_hardware_configuration import base_payload, client, create_base, create_module, create_object, install


def setup_installation(two=False, kind='NETWORK_PORT'):
    payload = base_payload()
    if two:
        payload['bays'].append({**payload['bays'][0], 'bay_key': str(uuid.uuid4()), 'display_name': 'Other bay'})
    template_id, payload = create_base(payload)
    obj = create_object(template_id)
    object_id = obj['physical_object_ref']['entity_id']
    module = create_module()
    if kind != 'NETWORK_PORT':
        response = client.post('/v1/library/module-templates', json={'name': 'Passive', 'compatibility': 'OCP3', 'endpoints': [{'key': 'p', 'display_name': 'P', 'kind': kind}]})
        assert response.status_code == 201
        module = response.json()
    for bay in payload['bays']:
        response = install(object_id, module['template_id'], bay['bay_key'])
        assert response.status_code == 201
    config = response.json()
    bay = next(b for b in config['bays'] if b['bay_key'] == payload['bays'][0]['bay_key'])
    return object_id, obj, module, config, bay['installation']


def uninstall(object_id, installation_id):
    return client.delete(f'/v1/topology/physical-objects/{object_id}/module-installations/{installation_id}')


@pytest.mark.parametrize('kind', ['NETWORK_PORT', 'CONNECTION_POINT'])
def test_uninstall_removes_only_owned_aggregate_and_read_context(kind):
    object_id, obj, module, config, installation = setup_installation(two=True, kind=kind)
    ids = {uuid.UUID(e['connection_point_id']) for e in installation['endpoints']}
    ni_ids = {uuid.UUID(e['network_interface_id']) for e in installation['endpoints'] if e['network_interface_id']}
    other = next(b for b in config['bays'] if b['installation']['id'] != installation['id'])
    response = uninstall(object_id, installation['id'])
    assert response.status_code == 200, response.text
    assert next(b for b in response.json()['bays'] if b['bay_key'] != other['bay_key'])['installation'] is None
    assert next(b for b in response.json()['bays'] if b['bay_key'] == other['bay_key']) == other
    with SessionLocal() as session:
        assert session.get(ModuleInstallation, uuid.UUID(installation['id'])) is None
        assert not session.scalars(select(ModuleEndpointMapping).where(ModuleEndpointMapping.installation_id == uuid.UUID(installation['id']))).all()
        for model, column, values in ((ConnectionPoint, ConnectionPoint.id, ids), (NetworkInterface, NetworkInterface.id, ni_ids), (NetworkInterfacePhysicalOwner, NetworkInterfacePhysicalOwner.interface_id, ni_ids)):
            assert not session.scalars(select(model).where(column.in_(values))).all()
        assert not session.scalars(select(InterfacePhysicalBinding).where(or_(InterfacePhysicalBinding.point_id.in_(ids), InterfacePhysicalBinding.interface_id.in_(ni_ids)))).all()
        assert not session.scalars(select(EntityMetadata).where(or_(EntityMetadata.connection_point_id.in_(ids), EntityMetadata.network_interface_id.in_(ni_ids)))).all()
        assert session.get(ModuleTemplate, uuid.UUID(module['template_id']))
        assert session.get(ModuleTemplateRevision, uuid.UUID(module['revision_id']))
    details = client.get(f'/v1/topology/physical-objects/{object_id}').json()
    remaining = {p['connection_point_ref']['entity_id'] for p in details['connection_points']}
    assert not {str(i) for i in ids} & remaining
    assert remaining == {obj['slots'][0]['connection_point_ref']['entity_id']} | {e['connection_point_id'] for e in other['installation']['endpoints']}
    interfaces = client.get(f'/v1/topology/devices/{object_id}').json()['interfaces']
    assert not {str(i) for i in ni_ids} & {i['interface_ref']['entity_id'] for i in interfaces}
    projection = client.post('/v1/topology/projection', json={'layer': 'L1', 'detail_level': 'PHYSICAL_OBJECT', 'scope': {'include_location_subtrees': [], 'include_entities': []}}).json()
    node = next(n for n in projection['nodes'] if any(r['entity_id'] == object_id for r in n['source_refs']))
    assert {p['connection_point_id'] for p in node['attributes']['connection_points']} == remaining
    assert {p['connection_point_id'] for p in node['attributes']['blueprint_presentation']['slots']} == remaining
    package = client.get('/v1/workspace/package').json()
    assert package['format_version'] == 4
    assert installation['id'] not in str(package['authoring']['ModuleInstallation'])
    assert not {str(i) for i in ids} & {e['connection_point_id'] for e in package['authoring']['ModuleEndpointMapping']}
    # The same bay/template can immediately be used again.
    assert install(object_id, module['template_id'], next(b['bay_key'] for b in response.json()['bays'] if b['installation'] is None)).status_code == 201


@pytest.mark.parametrize('dependency,reason', [
    ('internal_connection', 'CONNECTION'), ('cable', 'CONNECTION'),
    ('l2', 'L2_BINDING'), ('l3', 'L3_BINDING'),
    ('upper', 'NETWORK_INTERFACE_REALIZATION'), ('lower', 'NETWORK_INTERFACE_REALIZATION'),
    ('binding', 'INTERFACE_PHYSICAL_BINDING'), ('owner', 'NETWORK_INTERFACE_PHYSICAL_OWNER'),
    ('builtin_mapping', 'BUILT_IN_ENDPOINT_MAPPING'),
    ('security_scope', 'SECURITY_POLICY_ATTACHMENT'), ('nat_scope', 'NAT_POLICY_ATTACHMENT'),
    ('plan_scope', 'PROCESSING_PLAN_ATTACHMENT'), ('predicate', 'ROUTING_POLICY_RULE'),
])
def test_dependencies_block_entire_uninstall_without_any_changes(dependency, reason):
    object_id, obj, module, config, installation = setup_installation()
    point_id = uuid.UUID(installation['endpoints'][0]['connection_point_id'])
    interface_id = uuid.UUID(installation['endpoints'][0]['network_interface_id'])
    built_in = uuid.UUID(obj['slots'][0]['connection_point_ref']['entity_id'])
    if dependency == 'cable':
        other = create_object(obj['blueprint_ref']['entity_id'])
        response = client.post('/v1/topology/physical-connections', json={'source': {'kind': 'CONNECTION_POINT', 'connection_point_id': str(point_id), 'member_index': 1}, 'target': {'kind': 'CONNECTION_POINT', 'connection_point_id': other['slots'][0]['connection_point_ref']['entity_id'], 'member_index': 1}})
        assert response.status_code == 201, response.text
    else:
        with SessionLocal.begin() as session:
            repository = CanonicalRepository(session)
            if dependency == 'internal_connection':
                repository.add_connection(point_id, built_in, 1, [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
            elif dependency == 'l2':
                context = L2ForwardingContext(); session.add(context); session.flush()
                session.add(L2Binding(interface_id=interface_id, forwarding_context_id=context.id))
            elif dependency == 'l3':
                context = repository.add_routing_context()
                repository.add_l3_binding(interface_id, context.id)
            elif dependency in ('upper', 'lower'):
                other = repository.add_network_interface()
                session.add(NetworkInterfaceRealization(upper_interface_id=interface_id if dependency == 'upper' else other.id, lower_interface_id=other.id if dependency == 'upper' else interface_id))
            elif dependency == 'binding':
                point = repository.add_connection_point(uuid.UUID(object_id), cardinality=1)
                session.add(InterfacePhysicalBinding(interface_id=interface_id, point_id=point.id, point_member=1))
            elif dependency == 'owner':
                other = repository.add_physical_object()
                session.scalar(select(NetworkInterfacePhysicalOwner).where(NetworkInterfacePhysicalOwner.interface_id == interface_id)).physical_object_id = other.id
            elif dependency == 'builtin_mapping':
                session.scalar(select(BuiltInEndpointMapping)).connection_point_id = point_id
            elif dependency == 'security_scope':
                policy = SecurityPolicy(default_action='PERMIT', configured_completeness='COMPLETE'); session.add(policy); session.flush()
                session.add(SecurityPolicyAttachment(policy_id=policy.id, stage_order=1, scope={'egress_network_interface_ids': [str(interface_id)]}))
            elif dependency == 'nat_scope':
                policy = NATPolicy(default_transform={'op': 'IDENTITY'}, configured_completeness='COMPLETE'); session.add(policy); session.flush()
                session.add(NATPolicyAttachment(policy_id=policy.id, local_stage_order=1, scope={'ingress_network_interface_ids': [str(interface_id)]}))
            elif dependency == 'plan_scope':
                context = repository.add_routing_context()
                plan = PacketProcessingPlan(configured_completeness='PARTIAL')
                attachment_set = PacketProcessingPlanAttachmentSet(routing_context_id=context.id, traffic_class='TRANSIT', configured_completeness='PARTIAL')
                session.add_all([plan, attachment_set]); session.flush()
                session.add(PacketProcessingPlanAttachment(plan_id=plan.id, attachment_set_id=attachment_set.id, scope={'ingress_network_interface_ids': [str(interface_id)]}))
            elif dependency == 'predicate':
                context = repository.add_routing_context()
                table = RoutingTable(routing_context_id=context.id, address_family='IPv4', configured_completeness='PARTIAL'); session.add(table); session.flush()
                selection = {'op': 'SELECT_TABLE', 'routing_table_id': str(table.id)}
                policy = RoutingPolicy(default_selection=selection, configured_completeness='PARTIAL'); session.add(policy); session.flush()
                session.add(RoutingPolicyRule(policy_id=policy.id, order_key=1, predicate={'op': 'ALL', 'children': [{'op': 'NOT', 'child': {'op': 'INGRESS_NETWORK_INTERFACE_IN', 'ids': [str(interface_id)]}}]}, action=selection))
    before = client.get('/v1/workspace/package').json()
    response = uninstall(object_id, installation['id'])
    assert response.status_code == 409, response.text
    assert response.json()['error']['details']['reason'] == 'MODULE_INSTALLATION_IN_USE'
    assert response.json()['error']['details']['blockers'][reason] == 1
    assert client.get('/v1/workspace/package').json() == before
    assert client.get(f'/v1/topology/physical-objects/{object_id}/configuration').json() == config


def test_identity_validation_and_last_installation_allows_template_deletion():
    object_id, obj, module, config, installation = setup_installation()
    other = create_object(obj['blueprint_ref']['entity_id'])['physical_object_ref']['entity_id']
    bare = None
    with SessionLocal.begin() as session:
        bare = CanonicalRepository(session).add_physical_object().id
    for target, installation_id in ((str(uuid.uuid4()), installation['id']), (str(bare), installation['id']), (other, installation['id']), (object_id, str(uuid.uuid4()))):
        before = client.get('/v1/workspace/package').json()
        assert uninstall(target, installation_id).status_code == 422
        assert client.get('/v1/workspace/package').json() == before
    assert client.delete(f"/v1/library/module-templates/{module['template_id']}").status_code == 409
    assert uninstall(object_id, installation['id']).status_code == 200
    assert client.delete(f"/v1/library/module-templates/{module['template_id']}").status_code == 204
