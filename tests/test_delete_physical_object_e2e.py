import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import (
    BlueprintInstance, BlueprintInstanceSlot, Connection, ConnectionMember,
    ConnectionPoint, L2Binding, L2EgressRule,
    L2ForwardingContext, L2IngressRule, L3Binding, NetworkInterface,
    PhysicalObject, RoutingContext,
)
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests.test_object_blueprints_e2e import create_blueprint, instantiate, slot


client = TestClient(app)


def manual_object(name: str) -> dict:
    response = client.post('/v1/topology/physical-objects', json={
        'display_name': name, 'initial_connection_point': {'display_name': 'p1'},
    })
    assert response.status_code == 201
    return response.json()


def object_id(document: dict) -> uuid.UUID:
    return uuid.UUID(document['physical_object']['source_ref']['entity_id'])


def create_device(name: str) -> dict:
    response = client.post('/v1/topology/devices', json={'display_name': name, 'initial_interface': {'display_name': 'eth0'}})
    assert response.status_code == 201
    return response.json()


def test_deletes_standalone_manual_object_and_owned_point():
    created = manual_object('PC1')
    response = client.delete(f'/v1/topology/physical-objects/{object_id(created)}')
    assert response.status_code == 204
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 0
        assert session.scalar(select(func.count()).select_from(ConnectionPoint)) == 0


def test_deletes_blueprint_instance_slots_provenance_and_internal_connections():
    blueprint_id, version_id = create_blueprint([slot('front'), slot('rear')], [{'from_slot_key': 'front', 'to_slot_key': 'rear'}], name='Patch')
    instance = instantiate(blueprint_id, version_id, 'PP1')
    response = client.delete(f"/v1/topology/physical-objects/{instance['physical_object_ref']['entity_id']}")
    assert response.status_code == 204
    with SessionLocal() as session:
        for model in (PhysicalObject, ConnectionPoint, Connection, ConnectionMember, BlueprintInstance, BlueprintInstanceSlot):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_rejects_external_connection_without_partial_delete():
    left, right = manual_object('left'), manual_object('right')
    left_point = uuid.UUID(left['connection_points'][0]['connection_point_ref']['entity_id'])
    right_point = uuid.UUID(right['connection_points'][0]['connection_point_ref']['entity_id'])
    with SessionLocal.begin() as session:
        CanonicalRepository(session).add_connection(left_point, right_point, 1, [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
    response = client.delete(f'/v1/topology/physical-objects/{object_id(left)}')
    assert response.status_code == 409
    assert response.json()['error']['details']['reason'] == 'PHYSICAL_OBJECT_IN_USE'
    assert response.json()['error']['details']['blockers'] == {'EXTERNAL_PHYSICAL_CONNECTION': 1}
    with SessionLocal() as session:
        assert session.get(PhysicalObject, object_id(left)) is not None
        assert session.scalar(select(func.count()).select_from(Connection)) == 1


def test_deletes_owned_l2_configuration_and_empty_forwarding_context():
    device = create_device('switch')
    interface_id = uuid.UUID(device['interfaces'][0]['interface_ref']['entity_id'])
    with SessionLocal.begin() as session:
        context = L2ForwardingContext()
        session.add(context)
        session.flush()
        binding = L2Binding(interface_id=interface_id, forwarding_context_id=context.id)
        session.add(binding)
        session.flush()
        ingress = L2IngressRule(binding_id=binding.id, exact_stack=[])
        egress = L2EgressRule(binding_id=binding.id, emit_stack=[])
        session.add_all((ingress, egress))
        session.flush()
        context_id, binding_id, ingress_id, egress_id = context.id, binding.id, ingress.id, egress.id
    response = client.delete(f"/v1/topology/physical-objects/{device['device']['source_ref']['entity_id']}")
    assert response.status_code == 204
    with SessionLocal() as session:
        assert session.get(L2Binding, binding_id) is None
        assert session.get(L2IngressRule, ingress_id) is None
        assert session.get(L2EgressRule, egress_id) is None
        assert session.get(L2ForwardingContext, context_id) is None


def test_deletes_only_owned_l2_binding_and_preserves_shared_forwarding_context():
    deleted, survivor = create_device('deleted-switch'), create_device('surviving-switch')
    deleted_interface = uuid.UUID(deleted['interfaces'][0]['interface_ref']['entity_id'])
    survivor_interface = uuid.UUID(survivor['interfaces'][0]['interface_ref']['entity_id'])
    with SessionLocal.begin() as session:
        context = L2ForwardingContext()
        session.add(context)
        session.flush()
        removed_binding = L2Binding(interface_id=deleted_interface, forwarding_context_id=context.id)
        survivor_binding = L2Binding(interface_id=survivor_interface, forwarding_context_id=context.id)
        session.add_all((removed_binding, survivor_binding))
        session.flush()
        context_id, removed_binding_id, survivor_binding_id = context.id, removed_binding.id, survivor_binding.id
    assert client.delete(f"/v1/topology/physical-objects/{deleted['device']['source_ref']['entity_id']}").status_code == 204
    with SessionLocal() as session:
        assert session.get(L2Binding, removed_binding_id) is None
        assert session.get(L2ForwardingContext, context_id) is not None
        surviving = session.get(L2Binding, survivor_binding_id)
        assert surviving is not None
        assert surviving.interface_id == survivor_interface
        assert surviving.forwarding_context_id == context_id


def test_external_blocker_rolls_back_owned_l2_cleanup():
    device, external = create_device('blocked-switch'), manual_object('external')
    object_id_ = uuid.UUID(device['device']['source_ref']['entity_id'])
    interface_id = uuid.UUID(device['interfaces'][0]['interface_ref']['entity_id'])
    external_point_id = uuid.UUID(external['connection_points'][0]['connection_point_ref']['entity_id'])
    with SessionLocal.begin() as session:
        context = L2ForwardingContext()
        session.add(context)
        session.flush()
        binding = L2Binding(interface_id=interface_id, forwarding_context_id=context.id)
        session.add(binding)
        session.flush()
        ingress = L2IngressRule(binding_id=binding.id, exact_stack=[])
        egress = L2EgressRule(binding_id=binding.id, emit_stack=[])
        session.add_all((ingress, egress))
        repository = CanonicalRepository(session)
        device_point = repository.add_connection_point(object_id_, cardinality=1)
        repository.add_interface_physical_binding(
            interface_id, device_point.id, point_member=1
        )
        repository.add_connection(
            device_point.id, external_point_id, 1,
            [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        session.flush()
        context_id, binding_id, ingress_id, egress_id = context.id, binding.id, ingress.id, egress.id
    response = client.delete(f'/v1/topology/physical-objects/{object_id_}')
    assert response.status_code == 409
    assert response.json()['error']['details']['blockers'] == {'EXTERNAL_PHYSICAL_CONNECTION': 1}
    with SessionLocal() as session:
        assert session.get(PhysicalObject, object_id_) is not None
        assert session.get(L2ForwardingContext, context_id) is not None
        assert session.get(L2Binding, binding_id) is not None
        assert session.get(L2IngressRule, ingress_id) is not None
        assert session.get(L2EgressRule, egress_id) is not None


def test_rejects_l3_bound_owned_interface():
    device = create_device('router')
    interface_id = uuid.UUID(device['interfaces'][0]['interface_ref']['entity_id'])
    with SessionLocal.begin() as session:
        context = RoutingContext()
        session.add(context)
        session.flush()
        session.add(L3Binding(interface_id=interface_id, routing_context_id=context.id))
    response = client.delete(f"/v1/topology/physical-objects/{device['device']['source_ref']['entity_id']}")
    assert response.status_code == 409
    assert response.json()['error']['details']['blockers'] == {'L3_BINDING': 1}


def test_unknown_object_is_public_validation_error():
    response = client.delete(f'/v1/topology/physical-objects/{uuid.uuid4()}')
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'VALIDATION_ERROR'
