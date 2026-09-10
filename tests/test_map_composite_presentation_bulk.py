import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import MapCompositePresentation
from tests.l1_builders import create_map, create_object_with_point


client = TestClient(app)


def composite_map(name):
    map_id = create_map(client, name)
    variant_id = client.get(f"/v1/maps/{map_id}").json()["active_variant_ref"]["entity_id"]
    composites = []
    for index in range(2):
        members = [create_object_with_point(client, f"{name}-{index}-{member}")[0] for member in range(2)]
        for member in members:
            assert client.post(f"/v1/maps/{map_id}/placements", json={"physical_object_id": member, "x": 10, "y": 20}).status_code == 201
        response = client.post(f"/v1/maps/{map_id}/composites", json={"name": f"Pair {index}", "physical_object_ids": members})
        assert response.status_code == 201
        composites.append(response.json()["composite_ref"]["entity_id"])
    return map_id, variant_id, composites


def update(composite_id, **values):
    return {"composite_id": composite_id, "collapsed": True, "x": 44, "y": 55, "width": 300, "height": 200, **values}


def test_bulk_persists_both_presentations_only_in_requested_variant():
    map_id, primary_id, composites = composite_map("Bulk")
    variant_id = client.post(f"/v1/maps/{map_id}/presentation-variants", json={"name": "Обзорная", "source_variant_id": primary_id}).json()["variant_ref"]["entity_id"]
    before = client.get(f"/v1/maps/{map_id}").json()
    updates = [update(composites[0]), update(composites[1], x=100)]
    response = client.put(f"/v1/maps/{map_id}/composites/presentation?variant_id={variant_id}", json=updates)
    assert response.status_code == 204, response.text
    assert response.content == b""
    detail = client.get(f"/v1/maps/{map_id}?variant_id={variant_id}").json()
    for composite, expected in zip(detail["composites"], updates):
        assert composite["presentation"] == {key: value for key, value in expected.items() if key != "composite_id"} | {
            "variant_ref": {"entity_type": "MapPresentationVariant", "entity_id": variant_id}, "geometry_persisted": True,
        }
    assert client.get(f"/v1/maps/{map_id}").json() == before
    assert detail["placements"] == before["placements"]
    assert [item["physical_object_refs"] for item in detail["composites"]] == [item["physical_object_refs"] for item in before["composites"]]
    with SessionLocal() as session:
        assert len(session.scalars(select(MapCompositePresentation).where(MapCompositePresentation.variant_id == uuid.UUID(variant_id))).all()) == 2


@pytest.mark.parametrize("invalid", ["missing", "foreign", "geometry", "variant", "map"])
@pytest.mark.parametrize("persisted", [False, True])
def test_bulk_rejection_rolls_back_preceding_insert_or_update(invalid, persisted):
    map_id, variant_id, composites = composite_map("Bulk rollback")
    if persisted:
        initial = update(composites[0], collapsed=False, x=9)
        initial.pop("composite_id")
        assert client.put(f"/v1/maps/{map_id}/composites/{composites[0]}/presentation?variant_id={variant_id}", json=initial).status_code == 204
    before = client.get(f"/v1/maps/{map_id}").json()
    updates = [update(composites[0]), update(composites[1])]
    target_map, target_variant = map_id, variant_id
    if invalid == "missing":
        updates[1]["composite_id"] = str(uuid.uuid4())
    elif invalid in ("foreign", "variant"):
        _, foreign_variant, foreign_composites = composite_map("Foreign")
        if invalid == "foreign":
            updates[1]["composite_id"] = foreign_composites[0]
        else:
            target_variant = foreign_variant
    elif invalid == "geometry":
        updates[1]["width"] = 0
    else:
        target_map = str(uuid.uuid4())
    response = client.put(f"/v1/maps/{target_map}/composites/presentation?variant_id={target_variant}", json=updates)
    assert response.status_code == 422, response.text
    assert client.get(f"/v1/maps/{map_id}").json() == before
    with SessionLocal() as session:
        rows = session.scalars(select(MapCompositePresentation).where(MapCompositePresentation.variant_id == uuid.UUID(variant_id))).all()
        assert len(rows) == int(persisted)
        if persisted:
            assert rows[0].collapsed is False and rows[0].x == 9
