import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.errors import NetMapError
from app.main import app
from app.models import CableLabelHistory, Connection, ConnectionMember, ConnectionPoint
from app.physical_connections import ConnectionPointEndpoint, PhysicalConnectionCatalog
from app.repository import CanonicalRepository, ConnectionMemberInput
from app.schemas import CableReconnectRequest
from tests.l1_builders import create_object_with_point, point_endpoint


client = TestClient(app)
CREATE = "/v1/topology/physical-connections"


def create(a, b, **naming):
    return client.post(CREATE, json={"source": point_endpoint(a), "target": point_endpoint(b), **naming})


def preview(url):
    result = client.get(url)
    assert result.status_code == 200, result.text
    return result.json()["expected"]


@pytest.fixture
def cable():
    a = create_object_with_point(client, "A")
    b = create_object_with_point(client, "B")
    result = create(a[1], b[1], cable_label="Patch 12")
    assert result.status_code == 201, result.text
    cable_id = result.json()["cable_ref"]["entity_id"]
    url = f"/v1/cables/{cable_id}/reconnect"
    return cable_id, url, a, b


def history(cable_id):
    with SessionLocal() as session:
        return [tuple(row) for row in session.execute(
            select(CableLabelHistory.id, CableLabelHistory.label, CableLabelHistory.assigned_at,
                   CableLabelHistory.released_at).where(CableLabelHistory.cable_id == uuid.UUID(cable_id))
        )]


def point_details(owner, point_id):
    document = client.get(f"/v1/topology/physical-objects/{owner}").json()
    return next(point for point in document["connection_points"] if point["connection_point_ref"]["entity_id"] == point_id)


@pytest.mark.parametrize("side", ["A", "B"])
def test_reconnect_moves_one_end_preserving_identity_label_and_internal_continuity(cable, side):
    cable_id, url, a, b = cable
    owner, new_point = create_object_with_point(client, "destination")
    other_point = client.post(f"/v1/topology/physical-objects/{owner}/connection-points",
                              json={"display_name": "internal peer"}).json()["connection_points"]
    peer = next(point["connection_point_ref"]["entity_id"] for point in other_point
                if point["connection_point_ref"]["entity_id"] != new_point)
    with SessionLocal.begin() as session:
        connection, members = CanonicalRepository(session).add_connection(
            uuid.UUID(new_point), uuid.UUID(peer), cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        internal_id, internal_member_id = connection.id, members[0].id

    expected = preview(url)
    history_before = history(cable_id)
    assert len(history_before) == 1 and history_before[0][3] is None
    payload = {"expected": expected, "side": side, "new_point_id": new_point}
    response = client.post(url, json=payload)
    assert response.status_code == 204, response.text
    after = preview(url)
    assert after == {**expected, f"point_{side.lower()}_id": new_point}
    assert after["label"] == "Patch 12"
    assert history(cable_id) == history_before

    old = a if side == "A" else b
    assert point_details(*old)["external_connection_count"] == 0
    destination = point_details(owner, new_point)
    attachment, = destination["external_physical_attachments"]
    assert attachment["cable_ref"]["entity_id"] == cable_id
    assert attachment["connection_ref"]["entity_id"] == expected["connection_id"]
    assert destination["external_connection_count"] == 1
    with SessionLocal() as session:
        internal = session.get(Connection, internal_id)
        assert (str(internal.point_a_id), str(internal.point_b_id)) == (new_point, peer)
        member = session.get(ConnectionMember, internal_member_id)
        assert (member.connection_id, member.point_a_member, member.point_b_member) == (internal_id, 1, 1)
        member = session.get(ConnectionMember, uuid.UUID(after["connection_member_id"]))
        assert (member.index, member.point_a_member, member.point_b_member) == (1, 1, 1)
    stale = client.post(url, json=payload)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "CABLE_RECONNECT_STALE"
    assert preview(url) == after


def test_invalid_or_deleted_topology_leaves_connection_unchanged(cable):
    cable_id, url, _, (owner_b, b) = cable
    _, occupied = create_object_with_point(client, "occupied")
    _, occupied_peer = create_object_with_point(client, "occupied peer")
    assert create(occupied, occupied_peer).status_code == 201
    _, wide = create_object_with_point(client, "wide")
    with SessionLocal.begin() as session:
        session.get(ConnectionPoint, uuid.UUID(wide)).cardinality = 2
        same_owner = str(CanonicalRepository(session).add_connection_point(uuid.UUID(owner_b), cardinality=1).id)

    expected = preview(url)
    for point, status in [(occupied, 409), (b, 422), (same_owner, 422), (str(uuid.uuid4()), 422), (wide, 422)]:
        response = client.post(url, json={"expected": expected, "side": "A", "new_point_id": point})
        assert response.status_code == status, response.text
        assert preview(url) == expected
    with SessionLocal.begin() as session:
        session.get(Connection, uuid.UUID(expected["connection_id"])).cardinality = 2
    assert client.get(url).status_code == 422
    assert client.post(url, json={"expected": expected, "side": "A", "new_point_id": occupied}).status_code == 422
    assert client.delete(f"/v1/cables/{cable_id}").status_code == 204
    assert client.post(url, json={"expected": expected, "side": "A", "new_point_id": occupied}).status_code == 409


def test_failed_transaction_rolls_back_endpoint_update(cable, monkeypatch):
    cable_id, url, a, _ = cable
    owner, destination = create_object_with_point(client, "destination")
    expected = preview(url)
    history_before = history(cable_id)
    reconnect = PhysicalConnectionCatalog.reconnect_cable

    def fail_after_update(self, *args):
        reconnect(self, *args)
        raise NetMapError("TEST_ABORT", "abort after update")

    monkeypatch.setattr(PhysicalConnectionCatalog, "reconnect_cable", fail_after_update)
    response = client.post(url, json={"expected": expected, "side": "A", "new_point_id": destination})
    assert response.status_code == 409
    assert preview(url) == expected
    assert history(cable_id) == history_before
    assert point_details(*a)["external_connection_count"] == 1
    assert point_details(owner, destination)["external_connection_count"] == 0


def test_simultaneous_reconnect_rejects_competitor_then_stale_preview(cable):
    cable_id, url, _, _ = cable
    _, destination = create_object_with_point(client, "destination")
    _, other = create_object_with_point(client, "competitor")
    payload = {"expected": preview(url), "side": "A", "new_point_id": destination}
    competitor = {**payload, "side": "B", "new_point_id": other}
    with SessionLocal.begin() as session:
        PhysicalConnectionCatalog(session).reconnect_cable(uuid.UUID(cable_id), CableReconnectRequest.model_validate(payload))
        rejected = client.post(url, json=competitor)
        assert rejected.status_code == 409
        assert rejected.json()["error"]["code"] == "CABLE_RECONNECT_CONFLICT"
    stale = client.post(url, json=competitor)
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "CABLE_RECONNECT_STALE"
    assert preview(url) == {**payload["expected"], "point_a_id": destination}


@pytest.mark.parametrize("first_writer", ["create", "reconnect"])
def test_reconnect_and_create_serialize_on_new_point(cable, first_writer):
    cable_id, url, a, _ = cable
    _, destination = create_object_with_point(client, "destination")
    _, peer = create_object_with_point(client, "peer")
    payload = {"expected": preview(url), "side": "A", "new_point_id": destination}
    with ThreadPoolExecutor(max_workers=1) as worker:
        with SessionLocal.begin() as session:
            catalog = PhysicalConnectionCatalog(session)
            if first_writer == "create":
                catalog.create_endpoint_link(ConnectionPointEndpoint(uuid.UUID(destination)),
                                             ConnectionPointEndpoint(uuid.UUID(peer)))
                competing = worker.submit(client.post, url, json=payload).result(timeout=5)
                assert competing.status_code == 409
                assert competing.json()["error"]["code"] == "CABLE_RECONNECT_CONFLICT"
            else:
                catalog.reconnect_cable(uuid.UUID(cable_id), CableReconnectRequest.model_validate(payload))
                competing = worker.submit(create, destination, peer)
        if first_writer == "create":
            rejected = client.post(url, json=payload)
            assert rejected.status_code == 409
            assert rejected.json()["error"]["code"] == "CABLE_RECONNECT_OCCUPIED"
            assert preview(url)["point_a_id"] == a[1]
        else:
            rejected = competing.result(timeout=5)
            assert rejected.status_code == 422, rejected.text
            assert rejected.json()["error"]["details"]["reason"] == "CONNECTION_POINT_MEMBER_OCCUPIED"
            assert preview(url)["point_a_id"] == destination
