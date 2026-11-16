"""Persisted grid invariants across canonical writes, without opening a map."""
from copy import deepcopy
import uuid

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.location_catalog import LocationCatalog
from app.models import Location, MapPresentationVariant
from app.workspace_portability import export_package, validate_package, import_package, reset_dataset
from tests.test_map_location_states_e2e import client, location


def setup_variants():
    old, new = location("Old"), location("New")
    moved, sibling, empty = location("Moved", old), location("Sibling", old), location("Empty", old)
    created = client.post('/v1/maps', json={"name": "Mutation grids"}).json()
    map_id = created['map_ref']['entity_id']
    manual = created['active_variant_ref']['entity_id']
    ids = []
    for name in ('Grid A', 'Grid B', 'Legacy'):
        response = client.post(f'/v1/maps/{map_id}/presentation-variants', json={"name": name, "source_variant_id": manual})
        assert response.status_code == 201, response.text
        ids.append(response.json()['variant_ref']['entity_id'])
    settings = [
        {"mode": "uniform_grid", "version": 1, "hide_empty": False,
         "tables": {"root": [[old, new]], old: [[moved, None, sibling], [empty]], new: [[None]], empty: []}},
        {"mode": "uniform_grid", "version": 1, "hide_empty": True,
         "tables": {"root": [[new], [old]], old: [[sibling], [empty, moved]], new: [[None, None]], empty: []}},
        {"hide_empty": False, "containers": {old: {"direction": "HORIZONTAL", "order": []}}},
    ]
    for variant, config in zip(ids, settings):
        response = client.put(f'/v1/maps/{map_id}/presentation-variants/{variant}/automatic-layout', json=config)
        assert response.status_code == 200, response.text
    return old, new, moved, sibling, empty, ids, settings


def stored():
    with SessionLocal() as session:
        return {str(v.id): deepcopy(v.automatic_layout) for v in session.scalars(select(MapPresentationVariant))}


@pytest.mark.parametrize('mutation', ['reparent', 'delete'])
def test_mutations_preserve_independent_cells_and_workspace_roundtrip(mutation):
    old, new, moved, sibling, empty, ids, configs = setup_variants()
    before = stored()
    if mutation == 'reparent':
        response = client.put(f'/v1/locations/{moved}/parent', json={"parent_location_id": new})
        assert response.status_code == 200, response.text
    else:
        response = client.delete(f'/v1/locations/{empty}')
        assert response.status_code == 204, response.text
    after = stored()
    a, b = after[ids[0]]['tables'], after[ids[1]]['tables']
    assert a[old][0][2] == sibling
    assert b[old][0][0] == sibling
    assert a['root'] == configs[0]['tables']['root']
    assert b['root'] == configs[1]['tables']['root']
    if mutation == 'reparent':
        assert a[old] == [[None, None, sibling], [empty]]
        assert b[old] == [[sibling], [empty, None]]
        assert a[new] == [[moved]]
        assert b[new] == [[moved, None]]
    else:
        assert a[old] == [[moved, None, sibling], [None]]
        assert b[old] == [[sibling], [None, moved]]
        assert empty not in a and empty not in b
    for key in before:
        if key not in ids[:2]:
            assert after[key] == before[key]
    with SessionLocal() as session:
        package = export_package(session)
    validate_package(package)
    with SessionLocal.begin() as session:
        reset_dataset(session)
        import_package(session, package)
    assert stored() == after


@pytest.mark.parametrize('mutation', ['reparent', 'delete'])
def test_grid_failure_rolls_back_canonical_write_and_all_variants(monkeypatch, mutation):
    old, new, moved, sibling, empty, ids, configs = setup_variants()
    before = stored()
    import app.uniform_location_grid as grid
    original = grid.reconcile_grid
    calls = 0
    def fail_after_one(settings, parents):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("Injected grid failure")
        return original(settings, parents)
    monkeypatch.setattr(grid, 'reconcile_grid', fail_after_one)
    with pytest.raises(RuntimeError, match='Injected grid failure'):
        with SessionLocal.begin() as session:
            catalog = LocationCatalog(session)
            if mutation == 'reparent':
                catalog.reparent(uuid.UUID(moved), uuid.UUID(new))
            else:
                catalog.delete(uuid.UUID(empty))
    assert calls == 2
    assert stored() == before
    with SessionLocal() as session:
        assert session.get(Location, uuid.UUID(moved)).parent_location_id == uuid.UUID(old)
        assert session.get(Location, uuid.UUID(empty)) is not None
