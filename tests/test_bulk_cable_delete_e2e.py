import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.device_catalog import DeviceCatalog
from app.errors import ValidationError
from app.main import app
from app.models import Cable, CableLabelHistory, Connection, ConnectionMember
from app.physical_connections import PhysicalConnectionCatalog
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests.l1_builders import create_endpoint_cable, point_endpoint

client = TestClient(app)
DELETE = "/v1/cables/bulk-delete"
CREATE = "/v1/topology/physical-connections/bulk"


def seed(count, *, labelled=False):
    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)
        catalog = DeviceCatalog(session)
        object_points = []
        for name in ("Panel A", "Panel B", "Panel C"):
            obj = catalog.create_physical_object(name, "p1", None)
            point_ids = [obj.connection_point_id]
            point_ids.extend(repo.add_connection_point(obj.physical_object_id, cardinality=1).id for _ in range(count))
            object_points.append((obj.physical_object_id, point_ids))
        (a, ap), (b, bp), (c, cp) = object_points
        internal, _ = repo.add_connection(
            ap[0], ap[-1], cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        internal_id = internal.id
    unrelated = create_endpoint_cable(client, str(ap[-1]), str(cp[0]))
    body = {"pairs": [
        {"source": point_endpoint(str(source)), "target": point_endpoint(str(target))}
        for source, target in zip(ap[:count], reversed(bp[:count]))
    ]}
    if labelled:
        template = client.post("/v1/cable-label-templates", json={"name": "Panel", "pattern": "P###", "start_at": 1}).json()
        body.update(template_id=template["id"], expected_generated_labels=[f"P{i:03}" for i in range(1, count + 1)])
    response = client.post(CREATE, json=body)
    assert response.status_code == 201, response.text
    return {"source_object_id": str(a), "target_object_id": str(b)}, response.json()["created"], internal_id, unrelated


def preview(pair):
    response = client.get(f"{DELETE}-preview", params=pair)
    assert response.status_code == 200, response.text
    return response.json()["cables"]


def remove(pair, cables):
    return client.post(DELETE, json={**pair, "cables": cables})


@pytest.mark.parametrize("delete_all", [True, False])
def test_deletes_selected_cables_and_releases_their_resources(delete_all):
    pair, created, internal_id, unrelated = seed(48, labelled=True)
    candidates = preview(pair)
    assert len(candidates) == 48
    assert [row["expected"]["cable_id"] for row in candidates] == sorted(row["cable_id"] for row in created)
    assert preview(pair) == candidates
    reverse = preview(dict(source_object_id=pair["target_object_id"], target_object_id=pair["source_object_id"]))
    assert [row["expected"] for row in reverse] == [row["expected"] for row in candidates]
    assert all(a["source_is_point_a"] != b["source_is_point_a"] for a, b in zip(candidates, reverse))
    selected = [row["expected"] for row in (candidates if delete_all else candidates[2:42:4])]
    response = remove(pair, selected)
    assert response.status_code == 204, response.text
    removed_ids = {row["cable_id"] for row in selected}
    remaining = {row["cable_id"] for row in created} - removed_ids
    assert {row["expected"]["cable_id"] for row in preview(pair)} == remaining
    assert len(remaining) == (0 if delete_all else 38)
    with SessionLocal() as session:
        assert session.get(Connection, internal_id) is not None
        assert session.scalar(select(ConnectionMember).where(ConnectionMember.connection_id == internal_id)) is not None
        unrelated_id = unrelated["cable_ref"]["entity_id"]
        assert {str(cable.id) for cable in session.scalars(select(Cable))} == remaining | {unrelated_id}
        removed_connections = [uuid.UUID(row["connection_id"]) for row in selected]
        assert session.scalar(select(Connection.id).where(Connection.id.in_(removed_connections))) is None
        assert session.scalar(select(ConnectionMember.id).where(ConnectionMember.connection_id.in_(removed_connections))) is None
        assert {str(history.cable_id) for history in session.scalars(select(CableLabelHistory).where(
            CableLabelHistory.released_at.is_not(None),
        ))} == removed_ids

    freed = selected[0]
    recreate = {"source": point_endpoint(freed["point_a_id"]), "target": point_endpoint(freed["point_b_id"]),
                "cable_label": freed["label"]}
    assert client.post("/v1/topology/physical-connections", json=recreate).status_code == 409
    response = client.post("/v1/topology/physical-connections", json={**recreate, "confirmed_historical_label": freed["label"]})
    assert response.status_code == 201, response.text


def test_invalid_missing_and_stale_rows_leave_the_whole_batch_unchanged():
    pair, _, _, _ = seed(3)
    rows = [row["expected"] for row in preview(pair)]
    invalid = [([], 422), ([rows[0]] * 257, 422), ([rows[0], rows[0]], 422),
               ([rows[0], {**rows[1], "cable_id": str(uuid.uuid4())}], 409)]
    for batch, status in invalid:
        assert remove(pair, batch).status_code == status
    assert len(preview(pair)) == 3
    with SessionLocal.begin() as session:
        connection = session.get(Connection, uuid.UUID(rows[1]["connection_id"]))
        member = connection.members[0]
        connection.point_a_id, connection.point_b_id = connection.point_b_id, connection.point_a_id
        member.id = uuid.uuid4()
    stale = remove(pair, rows)
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "BULK_CABLE_DELETE_STALE"
    assert len(preview(pair)) == 3


def test_mid_batch_failure_rolls_back_deletions_and_label_releases(monkeypatch):
    pair, _, _, _ = seed(3, labelled=True)
    before = preview(pair)
    delete_one = PhysicalConnectionCatalog._delete_connected_cable

    def fail_second(self, cable, connection):
        if str(cable.id) == before[1]["expected"]["cable_id"]:
            raise ValidationError("Injected failure after the first delete and flush")
        delete_one(self, cable, connection)

    monkeypatch.setattr(PhysicalConnectionCatalog, "_delete_connected_cable", fail_second)
    assert remove(pair, [row["expected"] for row in before]).status_code == 422
    assert preview(pair) == before
    with SessionLocal() as session:
        assert session.scalar(select(CableLabelHistory.id).where(CableLabelHistory.released_at.is_not(None))) is None


def test_concurrent_member_write_blocks_delete_then_invalidates_preview():
    pair, _, _, _ = seed(3)
    before = preview(pair)
    rows = [row["expected"] for row in before]
    with SessionLocal.begin() as session:
        member = session.get(ConnectionMember, uuid.UUID(rows[-1]["members"][0]["id"]))
        member.id = uuid.uuid4()
        session.flush()
        response = remove(pair, rows)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "BULK_CABLE_DELETE_CONFLICT"
    assert remove(pair, rows).status_code == 409
    assert len(preview(pair)) == 3
