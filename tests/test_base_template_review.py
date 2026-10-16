import copy
import uuid

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import BaseTemplateCandidate, EntityMetadata, Connection, ConnectionMember, NetworkInterfaceRealization
from tests.test_hardware_configuration import client, create_base, create_object, create_module, install, base_payload


def open_draft(template_id):
    response = client.get(f'/v1/library/base-templates/{template_id}/draft')
    assert response.status_code == 200, response.text
    return response.json()


def save(template_id, draft, definition):
    response = client.put(f'/v1/library/base-templates/{template_id}/draft', params={"expected_generation": draft['generation']}, json=definition)
    assert response.status_code == 200, response.text
    return response.json()


def check(template_id, draft):
    response = client.post(f'/v1/library/base-templates/{template_id}/draft/check', params={"expected_generation": draft['generation']})
    assert response.status_code == 200, response.text
    return response.json()


def test_draft_roundtrip_snapshot_identity_and_immutability():
    template_id, payload = create_base()
    obj = create_object(template_id)
    published_url = f"/v1/library/base-templates/{template_id}/versions/{obj['version_ref']['entity_id']}"
    original = client.get(published_url).json()
    original_authoring = client.get('/v1/workspace/package').json()['authoring']
    draft = open_draft(template_id)
    assert draft['source_revision_id'] == obj['version_ref']['entity_id']
    assert draft['definition']['slots'] == payload['slots']
    assert draft['definition']['panels'] == payload['panels']
    definition = copy.deepcopy(draft['definition'])
    definition['slots'][0]['display_name'] = 'Renamed'
    definition['slots'][0]['rendered_position']['x'] = .7
    definition['panels'][0]['width'] = 200
    definition['bays'][0]['display_name'] = 'Same bay identity'
    definition['slots'].append({**definition['slots'][0], 'key': str(uuid.uuid4()), 'display_name': 'New'})
    draft = save(template_id, draft, definition)
    assert open_draft(template_id)['definition'] == definition
    canonical_before = client.get('/v1/workspace/package').json()['canonical']
    checked = check(template_id, draft)
    review = checked['review']
    assert review['current'] and review['definition'] == definition
    assert review['result']['objects'][0]['classification'] == 'potentially_safe'
    slot_changes = [c for c in review['result']['changes'] if c['section'] == 'slots']
    assert {c['operation'] for c in slot_changes} == {'changed', 'added'}
    assert client.get(published_url).json() == original
    assert client.get('/v1/workspace/package').json()['canonical'] == canonical_before
    after_authoring = client.get('/v1/workspace/package').json()['authoring']
    assert {key: value for key, value in after_authoring.items() if key not in ('BaseTemplateDraft', 'BaseTemplateCandidate')} == {key: value for key, value in original_authoring.items() if key not in ('BaseTemplateDraft', 'BaseTemplateCandidate')}
    definition['name'] = 'Draft only'
    edited = save(template_id, checked, definition)
    assert not edited['review']['current']
    assert edited['review']['definition']['name'] != 'Draft only'
    rechecked = check(template_id, edited)
    assert rechecked['review']['current']
    assert rechecked['review']['candidate_id'] != review['candidate_id']
    with SessionLocal() as session:
        assert session.get(BaseTemplateCandidate, uuid.UUID(review['candidate_id'])).definition == review['definition']


@pytest.mark.parametrize('dependency', ['connection', 'metadata', 'realization', 'l2', 'l3', 'physical_binding', 'security', 'nat', 'processing', 'routing'])
def test_removed_endpoint_dependencies_require_attention_and_are_per_object(dependency):
    template_id, _ = create_base()
    objects = [create_object(template_id) for _ in range(2)]
    endpoint = objects[0]['slots'][0]
    point_id = uuid.UUID(endpoint['connection_point_ref']['entity_id'])
    interface_id = uuid.UUID(endpoint['network_interface_ref']['entity_id'])
    with SessionLocal.begin() as session:
        from app.repository import CanonicalRepository
        from app import models as m
        repository = CanonicalRepository(session)
        if dependency == 'connection':
            remote = uuid.UUID(objects[1]['slots'][0]['connection_point_ref']['entity_id'])
            connection = Connection(point_a_id=point_id, point_b_id=remote, cardinality=1)
            session.add(connection); session.flush()
            session.add(ConnectionMember(connection_id=connection.id, index=1, point_a_member=1, point_b_member=1))
        elif dependency == 'metadata':
            alias = session.scalar(select(EntityMetadata).where(EntityMetadata.network_interface_id == interface_id))
            alias.value = 'User supplied name'
        elif dependency == 'realization':
            upper = repository.add_network_interface()
            session.add(NetworkInterfaceRealization(upper_interface_id=upper.id, lower_interface_id=interface_id))
        elif dependency == 'physical_binding':
            remote = repository.add_connection_point(uuid.UUID(objects[0]['physical_object_ref']['entity_id']), cardinality=1)
            session.add(m.InterfacePhysicalBinding(interface_id=interface_id, point_id=remote.id, point_member=1))
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
        else:
            policy = m.RoutingPolicy(default_selection={'kind': 'NO_MATCH'}, configured_completeness='COMPLETE'); session.add(policy); session.flush()
            session.add(m.RoutingPolicyRule(policy_id=policy.id, order_key=1, predicate={'op': 'NOT', 'child': {'op': 'INGRESS_NETWORK_INTERFACE_IN', 'ids': [str(interface_id)]}}, action={'kind': 'NO_MATCH'}))
    draft = open_draft(template_id)
    definition = copy.deepcopy(draft['definition']); definition['slots'] = []
    draft = save(template_id, draft, definition)
    canonical = client.get('/v1/workspace/package').json()['canonical']
    result = check(template_id, draft)['review']['result']['objects']
    by_object = {r['physical_object_id']: r for r in result}
    first = by_object[objects[0]['physical_object_ref']['entity_id']]
    assert first['classification'] == 'requires_intervention'
    assert first['reasons'][0]['code'] == 'ENDPOINT_DEPENDENCIES'
    if dependency != 'connection':
        assert by_object[objects[1]['physical_object_ref']['entity_id']]['classification'] == 'potentially_safe'
    assert client.get('/v1/workspace/package').json()['canonical'] == canonical


@pytest.mark.parametrize('capacity', [0, 1, 2])
def test_occupied_bay_capacity_and_deterministic_placement(capacity):
    payload = base_payload()
    payload['bays'] += [{**payload['bays'][0], 'bay_key': str(uuid.uuid4())}]
    template_id, _ = create_base(payload)
    object_id = create_object(template_id)['physical_object_ref']['entity_id']
    module = create_module()
    installation_ids = []
    for bay in payload['bays']:
        response = install(object_id, module['template_id'], bay['bay_key'])
        assert response.status_code == 201
    with SessionLocal() as session:
        from app.models import ModuleInstallation
        installation_ids = sorted(str(i) for i in session.scalars(select(ModuleInstallation.id)))
    draft = open_draft(template_id)
    definition = copy.deepcopy(draft['definition'])
    definition['bays'] = [{**payload['bays'][0], 'bay_key': f'opaque-{i}'} for i in reversed(range(capacity))]
    draft = save(template_id, draft, definition)
    before = client.get(f'/v1/topology/physical-objects/{object_id}/configuration').json()
    result = check(template_id, draft)['review']['result']['objects'][0]
    assert result['classification'] == ('potentially_safe' if capacity == 2 else 'requires_intervention')
    if capacity == 2:
        assert result['proposed_placements'] == dict(zip(installation_ids, ['opaque-0', 'opaque-1']))
    else:
        assert any(r['code'] == 'INSUFFICIENT_COMPATIBLE_CAPACITY' for r in result['reasons'])
    assert client.get(f'/v1/topology/physical-objects/{object_id}/configuration').json() == before


def test_saved_review_freshness_and_workspace_v5_roundtrip():
    template_id, _ = create_base()
    obj = create_object(template_id)
    checked = check(template_id, open_draft(template_id))
    assert open_draft(template_id)['review']['current']
    with SessionLocal.begin() as session:
        alias = session.scalar(select(EntityMetadata).where(EntityMetadata.network_interface_id == uuid.UUID(obj['slots'][0]['network_interface_ref']['entity_id'])))
        alias.value = 'Changed after check'
    assert not open_draft(template_id)['review']['current']
    package = client.get('/v1/workspace/package').json()
    assert package['format_version'] == 5
    assert len(package['authoring']['BaseTemplateDraft']) == 1
    assert len(package['authoring']['BaseTemplateCandidate']) == 1
    assert client.delete('/v1/workspace/dataset').status_code == 204
    response = client.post('/v1/workspace/package', json=package)
    assert response.status_code == 204, response.text
    assert client.get('/v1/workspace/package').json() == package
    assert open_draft(template_id)['review']['candidate_id'] == checked['review']['candidate_id']
    assert not open_draft(template_id)['review']['current']
    assert client.delete('/v1/workspace/dataset').status_code == 204
    invalid = copy.deepcopy(package); invalid['authoring']['BaseTemplateDraft'][0]['source_revision_id'] = str(uuid.uuid4())
    assert client.post('/v1/workspace/package', json=invalid).status_code == 422
    for version in [3, 4]:
        unsupported = {**package, 'format_version': version}
        assert client.post('/v1/workspace/package', json=unsupported).status_code == 422


def test_conflict_and_invalid_link_do_not_destroy_draft():
    template_id, _ = create_base()
    first = open_draft(template_id)
    saved = save(template_id, first, {**first['definition'], 'name': 'Saved'})
    url = f'/v1/library/base-templates/{template_id}/draft'
    assert client.put(url, params={'expected_generation': first['generation']}, json=first['definition']).status_code == 409
    assert client.post(url + '/check', params={'expected_generation': first['generation']}).status_code == 409
    invalid = {**saved['definition'], 'internal_links': [{'from_slot_key': 'missing', 'to_slot_key': 'other'}]}
    assert client.put(url, params={'expected_generation': saved['generation']}, json=invalid).status_code == 422
    assert open_draft(template_id)['definition']['name'] == 'Saved'


@pytest.mark.parametrize('change', ['compatibility', 'kind', 'internal_link', 'remove_initial_panel'])
def test_structural_changes_keep_keys_and_fail_closed_when_needed(change):
    payload = base_payload()
    payload['panels'].append({**payload['panels'][0], 'panel_key': str(uuid.uuid4()), 'panel_number': 2})
    payload['slots'].append({**payload['slots'][0], 'key': str(uuid.uuid4()), 'display_name': 'Second'})
    if change == 'internal_link':
        payload['internal_links'] = [{'from_slot_key': payload['slots'][0]['key'], 'to_slot_key': payload['slots'][1]['key']}]
    template_id, _ = create_base(payload)
    object_id = create_object(template_id)['physical_object_ref']['entity_id']
    if change == 'compatibility':
        module = create_module()
        assert install(object_id, module['template_id'], payload['bays'][0]['bay_key']).status_code == 201
    draft = open_draft(template_id)
    definition = copy.deepcopy(draft['definition'])
    if change == 'compatibility':
        definition['bays'][0]['compatibility'] = 'ocp3'
    elif change == 'kind':
        definition['slots'][0]['kind'] = 'CONNECTION_POINT'
    elif change == 'internal_link':
        definition['internal_links'] = []
    else:
        definition['panels'] = definition['panels'][1:]
        for slot in definition['slots']:
            slot['panel_key'] = definition['panels'][0]['panel_key']
        definition['bays'][0]['panel_key'] = definition['panels'][0]['panel_key']
    checked = check(template_id, save(template_id, draft, definition))
    result = checked['review']['result']['objects'][0]
    assert result['classification'] == ('potentially_safe' if change == 'remove_initial_panel' else 'requires_intervention')
    if change in ('kind', 'compatibility'):
        section = 'slots' if change == 'kind' else 'bays'
        assert [c['operation'] for c in checked['review']['result']['changes'] if c['section'] == section] == ['changed']
