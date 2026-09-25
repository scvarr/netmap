import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import Cable, CableLabelHistory, Connection, ConnectionMember
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests.l1_builders import create_object_with_point, point_endpoint


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
    response = client.post(URL, json=request(source, list(reversed(target))))
    assert response.status_code == 201, response.text
    rows = response.json()["created"]
    assert [(row["source_connection_point_id"], row["target_connection_point_id"]) for row in rows] == list(zip(source, reversed(target)))
    assert len({row["connection_id"] for row in rows}) == len({row["cable_id"] for row in rows}) == 3
    assert counts() == (3, 3, 3, 0)


def test_occupied_duplicate_and_missing_point_reject_entire_batch():
    source, target = points("source", 2), points("target", 2)
    other = points("other", 1)[0]
    assert client.post("/v1/topology/physical-connections", json={"source": point_endpoint(source[1]), "target": point_endpoint(other)}).status_code == 201
    before = counts()
    for body in (
        request(source, target),
        request([source[0], source[0]], target),
        request([source[0], str(uuid.uuid4())], target),
    ):
        assert client.post(URL, json=body).status_code == 422
        assert counts() == before


def test_generated_preview_order_stale_and_historical_confirmation():
    source, target = points("source", 2), points("target", 2)
    template = client.post("/v1/cable-label-templates", json={"name": "bulk", "pattern": "B###", "start_at": 1}).json()["id"]
    preview_url = f"{URL}-label-preview?template_id={template}&count=2"
    preview = client.get(preview_url)
    assert preview.status_code == 200
    assert preview.json()["labels"] == [{"label": "B001", "historical": False}, {"label": "B002", "historical": False}]
    before = counts()
    stale = client.post(URL, json=request(source, target, template_id=template, expected_generated_labels=["B002", "B001"]))
    assert stale.status_code == 422 and stale.json()["error"]["details"]["reason"] == "BULK_LABEL_PREVIEW_STALE"
    assert counts() == before
    created = client.post(URL, json=request(source, target, template_id=template, expected_generated_labels=["B001", "B002"]))
    assert created.status_code == 201, created.text
    with SessionLocal() as session:
        assert [session.get(Cable, uuid.UUID(row["cable_id"])).label for row in created.json()["created"]] == ["B001", "B002"]
    for row in created.json()["created"]:
        assert client.delete(f"/v1/cables/{row['cable_id']}").status_code == 204
    refreshed = client.get(preview_url).json()["labels"]
    assert refreshed == [{"label": "B001", "historical": True}, {"label": "B002", "historical": True}]
    before = counts()
    unconfirmed = client.post(URL, json=request(source, target, template_id=template, expected_generated_labels=["B001", "B002"]))
    assert unconfirmed.status_code == 422 and counts() == before
    confirmed = client.post(URL, json=request(source, target, template_id=template, expected_generated_labels=["B001", "B002"], confirmed_historical_labels=["B001", "B002"]))
    assert confirmed.status_code == 201, confirmed.text


def test_internal_connection_does_not_consume_external_capacity():
    source = points("source", 2)
    target = points("target", 1)
    with SessionLocal.begin() as session:
        CanonicalRepository(session).add_connection(
            uuid.UUID(source[0]), uuid.UUID(source[1]), cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
    created = client.post(URL, json=request([source[0]], target))
    assert created.status_code == 201, created.text
    assert counts() == (2, 2, 1, 0)
