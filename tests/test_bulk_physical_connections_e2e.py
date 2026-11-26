import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.errors import ValidationError
from app.physical_connections import PhysicalConnectionCatalog
from app.main import app
from app.models import Cable, CableLabelHistory, Connection, ConnectionMember
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests.l1_builders import confirmed_payload, create_object_with_point, point_endpoint, post_confirmed_physical


client = TestClient(app)
URL = "/v1/topology/physical-connections/bulk"


def points(name: str, count: int) -> list[str]:
    object_id, first = create_object_with_point(client, name)
    result = [first]
    for index in range(1, count):
        response = client.post(f"/v1/topology/physical-objects/{object_id}/connection-points", json={"display_name": f"p{index + 1}"})
        assert response.status_code == 201, response.text
        result.append(response.json()["connection_points"][-1]["connection_point_ref"]["entity_id"])
    return result


def request(source: list[str], target: list[str], **naming):
    return {"pairs": [{"source": point_endpoint(a), "target": point_endpoint(b)} for a, b in zip(source, target)], **naming}


def counts():
    with SessionLocal() as session:
        return tuple(session.scalar(select(func.count(model.id))) for model in (Connection, ConnectionMember, Cable, CableLabelHistory))


def test_ordered_reverse_batch_creates_independent_connections_and_cables():
    source, target = points("source", 3), points("target", 3)
    response = post_confirmed_physical(client, URL, json=request(source, list(reversed(target))))
    assert response.status_code == 201, response.text
    rows = response.json()["created"]
    assert [(row["source_connection_point_id"], row["target_connection_point_id"]) for row in rows] == list(zip(source, reversed(target)))
    assert len({row["connection_id"] for row in rows}) == len({row["cable_id"] for row in rows}) == 3
    assert counts() == (3, 3, 3, 0)


def test_occupied_duplicate_and_missing_point_reject_entire_batch():
    source, target = points("source", 2), points("target", 2)
    other = points("other", 1)[0]
    assert post_confirmed_physical(client,"/v1/topology/physical-connections", json={"source": point_endpoint(source[1]), "target": point_endpoint(other)}).status_code == 201
    before = counts()
    for body in (
        request(source, target),
        request([source[0], source[0]], target),
        request([source[0], str(uuid.uuid4())], target),
    ):
        assert post_confirmed_physical(client, URL, json=body).status_code == 422
        assert counts() == before


def test_generated_preview_order_stale_and_released_label_reuse():
    source, target = points("source", 2), points("target", 2)
    template = client.post("/v1/cable-label-templates", json={"name": "bulk", "pattern": "B###", "start_at": 1}).json()["id"]
    preview_url = f"{URL}-label-preview?template_id={template}&count=2"
    preview = client.get(preview_url)
    assert preview.status_code == 200
    assert preview.json()["labels"] == ["B001", "B002"]
    before = counts()
    stale = post_confirmed_physical(client, URL, json=request(source, target, template_id=template, expected_generated_labels=["B002", "B001"]))
    assert stale.status_code == 422 and stale.json()["error"]["details"]["reason"] == "BULK_LABEL_PREVIEW_STALE"
    assert counts() == before
    created = post_confirmed_physical(client, URL, json=request(source, target, template_id=template, expected_generated_labels=["B001", "B002"]))
    assert created.status_code == 201, created.text
    with SessionLocal() as session:
        assert [session.get(Cable, uuid.UUID(row["cable_id"])).label for row in created.json()["created"]] == ["B001", "B002"]
    for row in created.json()["created"]:
        assert client.delete(f"/v1/cables/{row['cable_id']}").status_code == 204
    assert client.get(preview_url).json()["labels"] == ["B001", "B002"]
    body = request(source, target, template_id=template, expected_generated_labels=["B001", "B002"])
    check = client.post(f"{URL}?preview=true", json=body)
    assert check.status_code == 200, check.text
    other_source, other_target = points("other source", 1), points("other target", 1)
    competitor = post_confirmed_physical(client, URL, json=request(
        other_source, other_target, template_id=template, expected_generated_labels=["B001"],
    ))
    assert competitor.status_code == 201, competitor.text
    before = counts()
    rejected = client.post(URL, json=confirmed_payload(check.json(), body))
    assert rejected.status_code == 422 and rejected.json()["error"]["details"]["reason"] == "BULK_LABEL_PREVIEW_STALE"
    assert counts() == before
    assert client.delete(f"/v1/cables/{competitor.json()['created'][0]['cable_id']}").status_code == 204
    recreated = post_confirmed_physical(client, URL, json=body)
    assert recreated.status_code == 201, recreated.text
    old_ids = {row["cable_id"] for row in created.json()["created"]}
    new_ids = {row["cable_id"] for row in recreated.json()["created"]}
    assert old_ids.isdisjoint(new_ids)
    with SessionLocal() as session:
        history = list(session.scalars(select(CableLabelHistory)))
        assert {str(row.cable_id) for row in history if row.released_at is None} == new_ids
        assert old_ids <= {str(row.cable_id) for row in history if row.released_at is not None}


def test_internal_connection_does_not_consume_external_capacity():
    source = points("source", 2)
    target = points("target", 1)
    with SessionLocal.begin() as session:
        CanonicalRepository(session).add_connection(
            uuid.UUID(source[0]), uuid.UUID(source[1]), cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
    created = post_confirmed_physical(client, URL, json=request([source[0]], target))
    assert created.status_code == 201, created.text
    assert counts() == (2, 2, 1, 0)


def multichannel_points(name, capacities):
    owner, _ = create_object_with_point(client, name)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        point_ids = [repository.add_connection_point(uuid.UUID(owner), size).id for size in capacities]
    return owner, list(map(str, point_ids))


def end(point_id, index):
    return {**point_endpoint(point_id), "member_index": index}


@pytest.mark.parametrize("capacities", [[2] * 48, [24, 1, 2]])
def test_bulk_creates_independent_lines_in_exact_member_order(capacities):
    source_owner, source = multichannel_points("source", capacities)
    target_owner, target = multichannel_points("target", [1] * sum(capacities))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        peer_id = repository.add_connection_point(uuid.UUID(source_owner), capacities[0]).id
        internal, _ = repository.add_connection(
            uuid.UUID(source[0]), peer_id, cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        internal_id = internal.id

    channels = [end(point, index) for point, size in zip(source, capacities) for index in range(1, size + 1)]
    body = {"pairs": [
        {"source": channel, "target": point_endpoint(point)}
        for channel, point in zip(channels, target)
    ]}
    response = post_confirmed_physical(client, URL, json=body)
    assert response.status_code == 201, response.text
    rows = response.json()["created"]
    assert len({row["cable_id"] for row in rows}) == len(channels)
    with SessionLocal() as session:
        for row, pair in zip(rows, body["pairs"], strict=True):
            member = session.scalar(select(ConnectionMember).where(
                ConnectionMember.connection_id == uuid.UUID(row["connection_id"]),
            ))
            connection = session.get(Connection, member.connection_id)
            assert connection.cardinality == member.index == 1
            assert (str(connection.point_a_id), member.point_a_member) == (
                pair["source"]["connection_point_id"], pair["source"]["member_index"],
            ) == (row["source_connection_point_id"], row["source_member_index"])
            assert (str(connection.point_b_id), member.point_b_member) == (
                pair["target"]["connection_point_id"], pair["target"]["member_index"],
            ) == (row["target_connection_point_id"], row["target_member_index"])
    first = rows[0]
    assert client.delete(f"/v1/topology/physical-connections/{first['connection_id']}").status_code == 204
    objects = {"source_object_id": source_owner, "target_object_id": target_owner}
    candidates = client.get("/v1/cables/bulk-delete-preview", params=objects).json()["cables"]
    assert {item["expected"]["cable_id"] for item in candidates} == {row["cable_id"] for row in rows[1:]}
    assert client.post("/v1/cables/bulk-delete", json={
        **objects, "cables": [item["expected"] for item in candidates],
    }).status_code == 204
    assert counts() == (1, 1, 0, 0)
    with SessionLocal() as session:
        assert session.get(Connection, internal_id) is not None


def test_bulk_checks_exact_duplicate_missing_and_invalid_indices_before_writing():
    _, (a,) = multichannel_points("source", [2])
    _, (b, c) = multichannel_points("target", [2, 1])
    first = {"source": end(a, 1), "target": end(b, 2)}
    second = {"source": end(a, 2), "target": point_endpoint(c)}
    invalid = [
        {"source": end(a, 1), "target": point_endpoint(c)},
        {"source": end(a, 2), "target": end(b, 2)},
        {"source": end(a, 3), "target": point_endpoint(c)},
        {"source": end(a, 0), "target": point_endpoint(c)},
        {"source": {"kind": "CONNECTION_POINT", "connection_point_id": a}, "target": point_endpoint(c)},
    ]
    for pair in invalid:
        for suffix in ("", "?preview=true"):
            assert client.post(URL + suffix, json={"pairs": [first, pair]}).status_code == 422
    assert counts() == (0, 0, 0, 0)
    check = client.post(f"{URL}?preview=true", json={"pairs": [first, second]}).json()
    assert check["verdict"] == "UNKNOWN"
    assert client.post(URL, json={
        "pairs": [first, second], "compatibility": {"token": check["token"], "accept_unknown": False},
    }).json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_CONFIRMATION_REQUIRED"


@pytest.mark.parametrize("single", [True, False])
def test_competing_writes_cannot_claim_same_member_or_leave_a_partial_bulk(single):
    _, (a,) = multichannel_points("source", [3])
    _, (b,) = multichannel_points("target", [3])
    single_url = "/v1/topology/physical-connections"
    shared = {"source": end(a, 2), "target": end(b, 2)}
    first = {"pairs": [{"source": end(a, 1), "target": end(b, 1)}, shared]}
    other = shared if single else {"pairs": [{"source": end(a, 3), "target": end(b, 3)}, shared]}
    other_url = single_url if single else URL
    gate = Barrier(2)

    def write(url, body):
        check = client.post(f"{url}?preview=true", json=body)
        assert check.status_code == 200, check.text
        gate.wait(timeout=5)
        return client.post(url, json=confirmed_payload(check.json(), body))

    with ThreadPoolExecutor(max_workers=2) as workers:
        winner, competitor = (workers.submit(write, url, body) for url, body in ((URL, first), (other_url, other)))
        bulk, other_result = winner.result(timeout=10), competitor.result(timeout=10)
    assert sorted([bulk.status_code, other_result.status_code]) == [201, 422]
    rejected = bulk if bulk.status_code == 422 else other_result
    assert rejected.json()["error"]["details"]["reason"] == "CONNECTION_POINT_MEMBER_OCCUPIED"
    expected = 1 if single and other_result.status_code == 201 else 2
    assert counts() == (expected, expected, expected, 0)


def test_bulk_rolls_back_after_a_write_error(monkeypatch):
    _, (a,) = multichannel_points("source", [2])
    _, (b,) = multichannel_points("target", [2])
    body = {"pairs": [{"source": end(a, index), "target": end(b, index)} for index in (2, 1)]}
    add_cable = PhysicalConnectionCatalog._add_cable
    calls = 0

    def fail_second(catalog, connection_id, fiber_type):
        nonlocal calls
        calls += 1
        cable = add_cable(catalog, connection_id, fiber_type)
        if calls == 2:
            raise ValidationError("Injected second Cable write failure")
        return cable

    monkeypatch.setattr(PhysicalConnectionCatalog, "_add_cable", fail_second)
    assert post_confirmed_physical(client, URL, json=body).status_code == 422
    assert calls == 2 and counts() == (0, 0, 0, 0)
