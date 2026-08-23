import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import (
    BlueprintInstance, BlueprintInstanceSlot, Connection, ConnectionMember,
    ConnectionPoint, L2Binding, L2ForwardingContext, L3Binding, NetworkInterface,
    PhysicalObject, RoutingContext,
)
from app.repository import CanonicalRepository, ConnectionMemberInput


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
    blueprint = client.post('/v1/library/object-blueprints', json={
        'name': 'Patch', 'body': {'kind': 'RECTANGLE', 'width': 100, 'height': 40},
        'slots': [
            {'key': 'front', 'display_name': 'front', 'kind': 'CONNECTION_POINT', 'anchor': {'side': 'LEFT', 'offset': .5}},
            {'key': 'rear', 'display_name': 'rear', 'kind': 'CONNECTION_POINT', 'anchor': {'side': 'RIGHT', 'offset': .5}},
        ], 'internal_links': [{'from_slot_key': 'front', 'to_slot_key': 'rear'}],
    }).json()
    instance = client.post(f"/v1/library/object-blueprints/{blueprint['blueprint_ref']['entity_id']}/versions/{blueprint['version_ref']['entity_id']}/instantiate", json={'display_name': 'PP1'}).json()
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


def test_rejects_l2_bound_owned_interface():
    device = create_device('switch')
    interface_id = uuid.UUID(device['interfaces'][0]['interface_ref']['entity_id'])
    with SessionLocal.begin() as session:
        context = L2ForwardingContext()
        session.add(context)
        session.flush()
        session.add(L2Binding(interface_id=interface_id, forwarding_context_id=context.id))
    response = client.delete(f"/v1/topology/physical-objects/{device['device']['source_ref']['entity_id']}")
    assert response.status_code == 409
    assert response.json()['error']['details']['blockers'] == {'L2_BINDING': 1}


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


def test_deletes_simple_legacy_cable_but_preserves_neighbors():
    source, target = create_device('source'), create_device('target')
    response = client.post('/v1/topology/physical-links', json={
        'source_interface_id': source['interfaces'][0]['interface_ref']['entity_id'],
        'target_interface_id': target['interfaces'][0]['interface_ref']['entity_id'],
        'cable_display_name': 'cable-01',
    })
    cable_id = response.json()['cable_ref']['entity_id']
    assert client.delete(f'/v1/topology/physical-objects/{cable_id}').status_code == 204
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 2
        assert session.scalar(select(func.count()).select_from(Connection)) == 0
        assert session.scalar(select(func.count()).select_from(NetworkInterface)) == 2


def test_deletes_simple_blueprint_backed_cable_and_its_provenance():
    blueprint = client.post('/v1/library/object-blueprints', json={
        'name': 'Cable', 'default_physical_object_class': 'cable',
        'body': {'kind': 'RECTANGLE', 'width': 100, 'height': 4},
        'slots': [
            {'key': 'a', 'display_name': 'a', 'kind': 'CONNECTION_POINT', 'anchor': {'side': 'LEFT', 'offset': .5}},
            {'key': 'b', 'display_name': 'b', 'kind': 'CONNECTION_POINT', 'anchor': {'side': 'RIGHT', 'offset': .5}},
        ], 'internal_links': [{'from_slot_key': 'a', 'to_slot_key': 'b'}],
    }).json()
    source, target = manual_object('source'), manual_object('target')
    response = client.post('/v1/topology/physical-connections', json={
        'source': {'kind': 'CONNECTION_POINT', 'connection_point_id': source['connection_points'][0]['connection_point_ref']['entity_id'], 'member_index': 1},
        'target': {'kind': 'CONNECTION_POINT', 'connection_point_id': target['connection_points'][0]['connection_point_ref']['entity_id'], 'member_index': 1},
        'cable_blueprint': {'blueprint_id': blueprint['blueprint_ref']['entity_id'], 'version_id': blueprint['version_ref']['entity_id']},
        'cable_display_name': 'bp-cable',
    })
    assert response.status_code == 201
    cable_id = response.json()['cable_ref']['entity_id']
    assert client.delete(f'/v1/topology/physical-objects/{cable_id}').status_code == 204
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(BlueprintInstance)) == 0
        assert session.scalar(select(func.count()).select_from(BlueprintInstanceSlot)) == 0
        assert session.scalar(select(func.count()).select_from(Connection)) == 0
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 2


def test_rejects_branching_cable_without_writes():
    source, target = create_device('source'), create_device('target')
    link = client.post('/v1/topology/physical-links', json={
        'source_interface_id': source['interfaces'][0]['interface_ref']['entity_id'],
        'target_interface_id': target['interfaces'][0]['interface_ref']['entity_id'],
    }).json()
    cable_id = uuid.UUID(link['cable_ref']['entity_id'])
    with SessionLocal.begin() as session:
        cable_point = session.scalar(select(ConnectionPoint).where(ConnectionPoint.physical_object_id == cable_id))
        extra = CanonicalRepository(session).add_connection_point(object_id(manual_object('third')), 1)
        CanonicalRepository(session).add_connection(cable_point.id, extra.id, 1, [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
    response = client.delete(f'/v1/topology/physical-objects/{cable_id}')
    assert response.status_code == 409
    assert response.json()['error']['details']['blockers'] == {'AMBIGUOUS_CABLE_STRUCTURE': 1}
    with SessionLocal() as session:
        assert session.get(PhysicalObject, cable_id) is not None
        assert session.scalar(select(func.count()).select_from(Connection)) == 4


def test_unknown_object_is_public_validation_error():
    response = client.delete(f'/v1/topology/physical-objects/{uuid.uuid4()}')
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'VALIDATION_ERROR'
