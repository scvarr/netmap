import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.main import app
from app.models import Cable, Connection, ConnectionMember, ConnectionPoint, MapCableRoute, PhysicalObject
from app.repository import CanonicalRepository, ConnectionMemberInput


client = TestClient(app)


def device(name: str) -> dict:
    response = client.post('/v1/topology/devices', json={
        'display_name': name, 'initial_interface': {'display_name': 'eth0'},
    })
    assert response.status_code == 201
    return response.json()


def object_with_point(name: str) -> tuple[str, str]:
    response = client.post('/v1/topology/physical-objects', json={
        'display_name': name, 'initial_connection_point': {'display_name': 'p1'},
    })
    assert response.status_code == 201
    body = response.json()
    return body['physical_object']['source_ref']['entity_id'], body['connection_points'][0]['connection_point_ref']['entity_id']


def endpoint_connection(source: str, target: str) -> dict:
    response = client.post('/v1/topology/physical-connections', json={
        'source': {'kind': 'CONNECTION_POINT', 'connection_point_id': source, 'member_index': 1},
        'target': {'kind': 'CONNECTION_POINT', 'connection_point_id': target, 'member_index': 1},
    })
    assert response.status_code == 201, response.text
    return response.json()


def map_document(name: str) -> dict:
    response = client.post('/v1/maps', json={'name': name})
    assert response.status_code == 201
    return response.json()


def test_cable_backed_link_is_one_connection_and_never_a_physical_object():
    left, right = device('left'), device('right')
    response = client.post('/v1/topology/physical-links', json={
        'source_interface_id': left['interfaces'][0]['interface_ref']['entity_id'],
        'target_interface_id': right['interfaces'][0]['interface_ref']['entity_id'],
    })
    assert response.status_code == 201, response.text
    body = response.json()
    cable_id = uuid.UUID(body['cable_ref']['entity_id'])
    connection_id = uuid.UUID(body['connection_ref']['entity_id'])
    assert body['cable_ref']['entity_type'] == 'Cable'
    with SessionLocal() as session:
        cable = session.get(Cable, cable_id)
        assert cable is not None and cable.connection_id == connection_id
        assert session.get(PhysicalObject, cable_id) is None
        assert session.scalar(select(func.count()).select_from(Connection)) == 1
        assert session.scalar(select(func.count()).select_from(ConnectionMember)) == 1
        assert session.scalar(select(func.count()).select_from(ConnectionPoint)) == 2


def test_cable_constraints_and_atomic_create_failure_leave_no_orphan_facts(monkeypatch):
    _, left = object_with_point('left')
    _, right = object_with_point('right')
    original = CanonicalRepository.add_connection

    def fail_after_connection(self, *args, **kwargs):
        original(self, *args, **kwargs)
        raise RuntimeError('injected failure')

    monkeypatch.setattr(CanonicalRepository, 'add_connection', fail_after_connection)
    response = TestClient(app, raise_server_exceptions=False).post('/v1/topology/physical-connections', json={
        'source': {'kind': 'CONNECTION_POINT', 'connection_point_id': left, 'member_index': 1},
        'target': {'kind': 'CONNECTION_POINT', 'connection_point_id': right, 'member_index': 1},
    })
    assert response.status_code == 500
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection)) == 0
        assert session.scalar(select(func.count()).select_from(Cable)) == 0

    monkeypatch.setattr(CanonicalRepository, 'add_connection', original)
    connection = None
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        connection, _ = repository.add_connection(uuid.UUID(left), uuid.UUID(right), 1, [ConnectionMemberInput(1, 1, 1)])
        session.add(Cable(connection_id=connection.id))
    with pytest.raises(IntegrityError):
        with SessionLocal.begin() as session:
            session.add(Cable(connection_id=connection.id))
            session.flush()


def test_cable_and_connection_deletes_are_atomic_while_direct_connection_remains_supported():
    left_object, left = object_with_point('left')
    right_object, right = object_with_point('right')
    created = endpoint_connection(left, right)
    cable_id, connection_id = created['cable_ref']['entity_id'], created['connection_ref']['entity_id']
    assert client.delete(f'/v1/cables/{cable_id}').status_code == 204
    with SessionLocal() as session:
        assert session.get(Cable, uuid.UUID(cable_id)) is None
        assert session.get(Connection, uuid.UUID(connection_id)) is None
        assert session.get(PhysicalObject, uuid.UUID(left_object)) is not None
        assert session.get(PhysicalObject, uuid.UUID(right_object)) is not None

    with SessionLocal.begin() as session:
        direct, _ = CanonicalRepository(session).add_connection(
            uuid.UUID(left), uuid.UUID(right), 1, [ConnectionMemberInput(1, 1, 1)]
        )
    assert client.delete(f'/v1/topology/physical-connections/{direct.id}').status_code == 204
    with SessionLocal() as session:
        assert session.get(Connection, direct.id) is None
        assert session.scalar(select(func.count()).select_from(Cable)) == 0


def test_catalog_details_projection_and_routes_use_canonical_cable_identity():
    left_object, left = object_with_point('left')
    right_object, right = object_with_point('right')
    created = endpoint_connection(left, right)
    cable_id = created['cable_ref']['entity_id']
    catalog = client.get('/v1/catalog/inventory').json()
    cable = next(value for value in catalog['cables'] if value['cable_ref']['entity_id'] == cable_id)
    assert cable['cable_ref']['entity_type'] == 'Cable'
    assert cable['connection_ref']['entity_id'] == created['connection_ref']['entity_id']
    assert {item['remote_physical_object_ref']['entity_id'] for item in (cable['endpoint_a'], cable['endpoint_b'])} == {left_object, right_object}
    details = client.get(f'/v1/topology/physical-objects/{left_object}').json()
    attachment = details['connection_points'][0]['external_physical_attachments'][0]
    assert attachment['kind'] == 'CABLE' and attachment['cable_ref']['entity_type'] == 'Cable'
    projection = client.post('/v1/topology/projection', json={
        'layer': 'L1', 'detail_level': 'PHYSICAL_OBJECT',
        'scope': {'include_location_subtrees': [], 'include_entities': []},
    }).json()
    assert all(node['id'] != f'l1-physical-object:{cable_id}' for node in projection['nodes'])
    assert any(pair.get('cable_ref', {}).get('entity_id') == cable_id for edge in projection['edges'] for pair in edge['attributes']['endpoint_pairs'])
    saved = map_document('Cable route')
    map_id = saved['map_ref']['entity_id']
    routed = client.put(f'/v1/maps/{map_id}/cable-routes/{cable_id}', json={'view': 'physical', 'waypoints': []})
    assert routed.status_code == 200
    assert routed.json()['cable_routes'][0]['cable_ref']['entity_type'] == 'Cable'
    assert client.post(f'/v1/maps/{map_id}/placements', json={'physical_object_id': cable_id, 'x': 1, 'y': 1}).status_code == 422
    assert client.delete(f'/v1/cables/{cable_id}').status_code == 204
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapCableRoute)) == 0
