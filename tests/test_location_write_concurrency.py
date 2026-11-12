"""Lock ordering with independent PostgreSQL transactions and observed lock waits."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import select, text

from app.database import SessionLocal
from app.errors import ValidationError
from app.location_frame_geometry import contains
from app.location_catalog import LocationCatalog
from app.models import Cable, Connection, ConnectionPoint, MapViewKey, PhysicalObject
from app.saved_map_catalog import SavedMapCatalog
from tests.l1_builders import create_map, create_object_with_point, create_endpoint_cable, put_cable_route
from tests.test_location_container_e2e import position, state
from tests.test_map_location_states_e2e import client, location, assign, detail


def setup_layout(locked=False):
    root = location('808')
    leaf = location('U42', root)
    objects, points = zip(*(create_object_with_point(client, name) for name in ('PP1', 'PP2')))
    map_id = create_map(client, 'Concurrent layout')
    for obj in objects:
        assign(obj, leaf)
        assert client.post(f'/v1/maps/{map_id}/placements', json={'physical_object_id': obj, 'x': 0, 'y': 0}).status_code == 201
    doc, frames = state(map_id)
    variant = doc['active_variant_ref']['entity_id']
    cable = create_endpoint_cable(client, *points)['cable_ref']['entity_id']
    put_cable_route(client, map_id, cable, [{'x': position(doc, obj)['x']+30, 'y': position(doc, obj)['y']+30} for obj in objects])
    if locked:
        assert client.put(f'/v1/maps/{map_id}/placements/{objects[0]}/locks/physical', json={'locked': True}).status_code == 200
    return map_id, variant, root, leaf, objects, frames


def snapshot(map_id, variant):
    doc = detail(map_id, variant)
    return {key: doc[key] for key in ('placements', 'location_states', 'cable_routes')}


def wait_on_lock(waiter_pid, holder_pid, table):
    deadline = time.monotonic() + 3
    with SessionLocal() as observer:
        while time.monotonic() < deadline:
            row = observer.execute(text('SELECT pg_blocking_pids(pid), query FROM pg_stat_activity WHERE pid=:pid'), {'pid': waiter_pid}).one()
            if holder_pid in row[0]:
                assert f'FROM {table}' in row[1] and 'FOR UPDATE' in row[1], row[1]
                return
            # READ COMMITTED alone does not refresh PostgreSQL's statistics snapshot.
            observer.execute(text('SELECT pg_stat_clear_snapshot()'))
            time.sleep(.01)
    pytest.fail('Writer did not reach the controlled PostgreSQL lock wait')


@pytest.mark.parametrize('first,locked,fail_position', [
    ('geometry', False, False), ('position', False, False),
    ('geometry', True, False), ('position', False, True),
])
def test_position_geometry_lock_order_atomicity_and_serial_result(monkeypatch, first, locked, fail_position):
    map_id, variant, root, leaf, objects, frames = setup_layout(locked)
    before = snapshot(map_id, variant)
    copies = [client.post(f'/v1/maps/{map_id}/presentation-variants', json={'name': name, 'source_variant_id': variant}).json()['variant_ref']['entity_id'] for name in ('Expected', 'Untouched')]
    untouched = snapshot(map_id, copies[1])
    with SessionLocal() as session:
        canonical = [list(session.scalars(select(model.id).order_by(model.id))) for model in (Cable, Connection, ConnectionPoint)]
    original_position = position(detail(map_id), objects[0])
    geometry = dict(frames[leaf], width=frames[leaf]['width']+30) if locked else dict(frames[leaf], x=frames[leaf]['x']+30, y=frames[leaf]['y']+20)

    def apply(session, role, target_variant):
        catalog = SavedMapCatalog(session)
        if role == 'geometry':
            catalog.set_location_geometry(uuid.UUID(map_id), uuid.UUID(target_variant), uuid.UUID(leaf), geometry)
        else:
            catalog.set_view_position(uuid.UUID(map_id), uuid.UUID(objects[0]), MapViewKey.PHYSICAL,
                original_position['x']+5, original_position['y']+3, variant_id=uuid.UUID(target_variant))

    # Establish the exact expected serialized result in a separate variant.
    for role in (first, 'position' if first == 'geometry' else 'geometry'):
        if role == 'position' and fail_position:
            continue
        try:
            with SessionLocal.begin() as session:
                apply(session, role, copies[0])
        except ValidationError:
            assert role == 'position' and locked
    expected = snapshot(map_id, copies[0])
    paused, release = Event(), Event()
    started = {role: Event() for role in ('geometry', 'position')}
    pids = {}
    physical_geometry = SavedMapCatalog._physical_geometry
    place = SavedMapCatalog.place_assigned_object

    def pause(session):
        if session.info.get('role') == first and not paused.is_set():
            paused.set()
            assert release.wait(5), 'Controlled writer was not released'

    def geometry_hook(self, *args, **kwargs):
        if first == 'geometry':
            pause(self.session)  # hierarchy + variant held, no positions locked yet
        return physical_geometry(self, *args, **kwargs)

    def position_hook(self, *args, **kwargs):
        if first == 'position':
            pause(self.session)  # the position UPDATE has already been flushed
        return place(self, *args, **kwargs)

    monkeypatch.setattr(SavedMapCatalog, '_physical_geometry', geometry_hook)
    monkeypatch.setattr(SavedMapCatalog, 'place_assigned_object', position_hook)

    def writer(role):
        try:
            with SessionLocal.begin() as session:
                session.info['role'] = role
                session.execute(text("SET LOCAL lock_timeout = '4s'"))
                session.execute(text("SET LOCAL statement_timeout = '8s'"))
                pids[role] = session.scalar(text('SELECT pg_backend_pid()'))
                started[role].set()
                apply(session, role, variant)
                if role == 'position' and fail_position:
                    raise ValidationError('Injected failure after frames/positions/routes were flushed', {})
            return 'committed'
        except ValidationError:
            assert role == 'position' and (locked or fail_position)
            return 'rejected'

    second = 'position' if first == 'geometry' else 'geometry'
    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(writer, first)
        try:
            assert paused.wait(5)
            waiter = pool.submit(writer, second)
            assert started[second].wait(5)
            wait_on_lock(pids[second], pids[first], 'map_presentation_variants')
            # Neither transaction has committed any frames, positions or routes.
            assert snapshot(map_id, variant) == before
        finally:
            release.set()
        outcomes = {first: holder.result(timeout=8), second: waiter.result(timeout=8)}
    assert outcomes == {'geometry': 'committed', 'position': 'rejected' if locked or fail_position else 'committed'}
    assert snapshot(map_id, variant) == expected
    assert snapshot(map_id, copies[1]) == untouched
    doc, final_frames = state(map_id, variant)
    assert contains(final_frames[root], final_frames[leaf])
    for obj in objects:
        assert contains(final_frames[leaf], dict(position(doc, obj), width=212, height=144))
    with SessionLocal() as session:
        assert canonical == [list(session.scalars(select(model.id).order_by(model.id))) for model in (Cable, Connection, ConnectionPoint)]
        assert all(session.get(PhysicalObject, uuid.UUID(obj)).location_id == uuid.UUID(leaf) for obj in objects)


def test_distinct_variant_layout_writes_do_not_serialize_on_hierarchy():
    map_id, variant, _, leaf, _, frames = setup_layout()
    copy = client.post(f'/v1/maps/{map_id}/presentation-variants', json={'name': 'Copy', 'source_variant_id': variant}).json()['variant_ref']['entity_id']
    with SessionLocal.begin() as holder, ThreadPoolExecutor(max_workers=1) as pool:
        SavedMapCatalog(holder).set_location_geometry(uuid.UUID(map_id), uuid.UUID(variant), uuid.UUID(leaf), dict(frames[leaf], width=frames[leaf]['width']+30))

        def other_variant():
            with SessionLocal.begin() as session:
                session.execute(text("SET LOCAL lock_timeout = '1s'"))
                SavedMapCatalog(session).set_location_geometry(uuid.UUID(map_id), uuid.UUID(copy), uuid.UUID(leaf), dict(frames[leaf], width=frames[leaf]['width']+60))
        # Must commit before the holder releases its hierarchy/variant locks.
        pool.submit(other_variant).result(timeout=4)
    assert state(map_id, variant)[1][leaf]['width'] == frames[leaf]['width']+30
    assert state(map_id, copy)[1][leaf]['width'] == frames[leaf]['width']+60


def test_assignment_waits_for_hierarchy_before_object_and_position_writes(monkeypatch):
    map_id, variant, _, _, objects, _ = setup_layout()
    target = location('U43')
    copy = client.post(f'/v1/maps/{map_id}/presentation-variants', json={'name': 'Copy', 'source_variant_id': variant}).json()['variant_ref']['entity_id']
    before = snapshot(map_id, variant)
    paused, release, started = Event(), Event(), Event()
    pids = {}
    place = SavedMapCatalog.place_assigned_object

    def position_hook(self, *args, **kwargs):
        if self.session.info.get('role') == 'position':
            paused.set()
            assert release.wait(5)
        return place(self, *args, **kwargs)
    monkeypatch.setattr(SavedMapCatalog, 'place_assigned_object', position_hook)

    def writer(role):
        with SessionLocal.begin() as session:
            session.info['role'] = role
            session.execute(text("SET LOCAL lock_timeout = '4s'"))
            pids[role] = session.scalar(text('SELECT pg_backend_pid()'))
            if role == 'position':
                pos = position(detail(map_id, variant), objects[0])
                SavedMapCatalog(session).set_view_position(uuid.UUID(map_id), uuid.UUID(objects[0]), MapViewKey.PHYSICAL, pos['x']+5, pos['y']+3, variant_id=uuid.UUID(variant))
            else:
                started.set()
                LocationCatalog(session).set_physical_object_location(uuid.UUID(objects[0]), uuid.UUID(target))

    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(writer, 'position')
        try:
            assert paused.wait(5)
            waiter = pool.submit(writer, 'assignment')
            assert started.wait(5)
            wait_on_lock(pids['assignment'], pids['position'], 'locations')
            assert snapshot(map_id, variant) == before
        finally:
            release.set()
        holder.result(timeout=8)
        waiter.result(timeout=8)
    for scope in (variant, copy):
        doc, frames = state(map_id, scope)
        assert contains(frames[target], dict(position(doc, objects[0]), width=212, height=144))
        assert len(doc['placements']) == 2
    with SessionLocal() as session:
        assert session.get(PhysicalObject, uuid.UUID(objects[0])).location_id == uuid.UUID(target)
