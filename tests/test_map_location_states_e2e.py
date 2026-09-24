import uuid

from fastapi.testclient import TestClient
from sqlalchemy import event, func, select

from app.database import SessionLocal, engine
from app.main import app
from app.models import MapLocationState
from tests.l1_builders import create_map, create_object_with_point


client = TestClient(app)


def location(name, parent=None):
    response = client.post('/v1/locations', json={'name': name, 'parent_location_id': parent})
    assert response.status_code == 201, response.text
    return response.json()['location_ref']['entity_id']


def assign(object_id, location_id):
    assert client.put(f'/v1/topology/physical-objects/{object_id}/location', json={'location_id': location_id}).status_code == 200


def ref(kind, entity_id):
    return {'entity_type': kind, 'entity_id': entity_id}


def write(map_id, variant_id, location_id, collapsed=True, refs=None):
    return client.put(f'/v1/maps/{map_id}/presentation-variants/{variant_id}/locations/{location_id}', json={
        'collapsed': collapsed, 'visible_direct_elements': refs or [],
    })


def detail(map_id, variant_id=None):
    suffix = f'?variant_id={variant_id}' if variant_id else ''
    response = client.get(f'/v1/maps/{map_id}{suffix}')
    assert response.status_code == 200, response.text
    return response.json()


def test_variant_location_state_validation_copy_stale_refs_and_cascade():
    map_id = create_map(client, 'Location state map')
    other_map_id = create_map(client, 'Other map')
    primary = detail(map_id)['active_variant_ref']['entity_id']
    other_variant = detail(other_map_id)['active_variant_ref']['entity_id']
    room = location('Room')
    rack = location('Rack', room)
    deep = location('Deep', rack)
    other = location('Other')
    foreign_child = location('Foreign child', other)
    ups, _ = create_object_with_point(client, 'UPS')
    switch, _ = create_object_with_point(client, 'Switch')
    foreign, _ = create_object_with_point(client, 'Foreign')
    assign(ups, room)
    assign(switch, rack)
    assign(foreign, other)
    for object_id in (ups, switch):
        assert client.post(f'/v1/maps/{map_id}/placements', json={'physical_object_id': object_id, 'x': 1, 'y': 2}).status_code == 201
    assert detail(map_id)['location_states'] == []
    choices = client.get(f'/v1/maps/{map_id}/presentation-variants/{primary}/locations/{room}/direct-elements')
    assert choices.status_code == 200
    assert {tuple(choice['ref'].values()) for choice in choices.json()} == {('Location', rack), ('PhysicalObject', ups)}
    refs = [ref('PhysicalObject', ups), ref('Location', rack)]
    assert write(map_id, primary, room, refs=refs).status_code == 200
    assert write(map_id, primary, room, refs=refs).status_code == 200
    assert detail(map_id)['location_states'][0]['visible_direct_elements'] == refs
    for invalid in [ref('Location', deep), ref('Location', foreign_child), ref('PhysicalObject', switch), ref('PhysicalObject', foreign)]:
        assert write(map_id, primary, room, refs=[invalid]).status_code == 422
    assert write(map_id, other_variant, room).status_code == 422
    assert write(map_id, primary, uuid.uuid4()).status_code == 422
    assert write(uuid.uuid4(), primary, room).status_code == 422
    assert write(map_id, primary, room, refs=[refs[0], refs[0]]).status_code == 422
    assert write(map_id, primary, room, collapsed=False, refs=refs).status_code == 200
    assert detail(map_id)['location_states'][0]['visible_direct_elements'] == refs
    assert write(map_id, primary, room, refs=refs).status_code == 200

    copied = client.post(f'/v1/maps/{map_id}/presentation-variants', json={'name': 'Copy', 'source_variant_id': primary})
    assert copied.status_code == 201, copied.text
    copy_id = copied.json()['variant_ref']['entity_id']
    assert detail(map_id, copy_id)['location_states'][0]['visible_direct_elements'] == refs
    assert write(map_id, copy_id, room, refs=[]).status_code == 200
    assert detail(map_id, primary)['location_states'][0]['visible_direct_elements'] == refs
    assert detail(map_id, copy_id)['location_states'][0]['visible_direct_elements'] == []
    assert client.put(f'/v1/locations/{rack}/parent', json={'parent_location_id': other}).status_code == 200
    assert detail(map_id, primary)['location_states'][0]['visible_direct_elements'] == [refs[0]]
    for index in range(8):
        child = location(f'Extra {index}', room)
        assert write(map_id, primary, child, refs=[]).status_code == 200
    statements = []
    def record(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().lower().startswith('select'):
            statements.append(statement)
    event.listen(engine, 'before_cursor_execute', record)
    try:
        assert len(detail(map_id, primary)['location_states']) == 9
    finally:
        event.remove(engine, 'before_cursor_execute', record)
    assert sum('FROM map_location_states' in statement for statement in statements) == 1
    assert len(statements) < 20
    disposable = location('Disposable')
    assert write(map_id, primary, disposable).status_code == 200
    assert client.delete(f'/v1/locations/{disposable}').status_code == 204
    assert all(state['location_ref']['entity_id'] != disposable for state in detail(map_id, primary)['location_states'])
    assert client.delete(f'/v1/maps/{map_id}/presentation-variants/{copy_id}').status_code == 204
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(MapLocationState).where(MapLocationState.variant_id == uuid.UUID(copy_id))) == 0


def test_direct_elements_offer_only_placed_content_in_direct_canonical_branches():
    map_id = create_map(client, 'Direct elements map')
    other_map_id = create_map(client, 'Direct elements other map')
    variant_id = detail(map_id)['active_variant_ref']['entity_id']
    root = location('Root')
    populated = location('Populated', root)
    deep = location('Deep', populated)
    empty = location('Empty', root)
    sibling = location('Sibling')
    sibling_child = location('Sibling child', sibling)
    direct_placed, _ = create_object_with_point(client, 'Direct placed')
    direct_unplaced, _ = create_object_with_point(client, 'Direct unplaced')
    deep_placed, _ = create_object_with_point(client, 'Deep placed')
    empty_other_map, _ = create_object_with_point(client, 'Empty other map')
    sibling_other_map, _ = create_object_with_point(client, 'Sibling other map')
    for object_id, parent in (
        (direct_placed, root), (direct_unplaced, root), (deep_placed, deep),
        (empty_other_map, empty), (sibling_other_map, sibling_child),
    ):
        assign(object_id, parent)
    for object_id, target_map in (
        (direct_placed, map_id), (deep_placed, map_id),
        (empty_other_map, other_map_id), (sibling_other_map, other_map_id),
    ):
        assert client.post(f'/v1/maps/{target_map}/placements', json={'physical_object_id': object_id, 'x': 1, 'y': 2}).status_code == 201
    for index in range(12):
        location(f'Empty {index}', root)
    statements = []
    def record(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().lower().startswith(('select', 'with')):
            statements.append(statement)
    event.listen(engine, 'before_cursor_execute', record)
    try:
        response = client.get(f'/v1/maps/{map_id}/presentation-variants/{variant_id}/locations/{root}/direct-elements')
    finally:
        event.remove(engine, 'before_cursor_execute', record)
    assert response.status_code == 200, response.text
    assert {tuple(choice['ref'].values()) for choice in response.json()} == {
        ('Location', populated), ('PhysicalObject', direct_placed),
    }
    assert len(statements) < 12
