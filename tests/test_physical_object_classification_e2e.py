import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.device_catalog import PHYSICAL_OBJECT_CLASS_KEY
from app.main import app
from app.models import EntityMetadata
from app.repository import CanonicalRepository


client = TestClient(app)


def physical_projection() -> dict:
    response = client.post(
        "/v1/topology/projection",
        json={
            "layer": "L1",
            "detail_level": "PHYSICAL_OBJECT",
            "scope": {"include_location_subtrees": [], "include_entities": []},
        },
    )
    assert response.status_code == 200
    return response.json()


def node_for(document: dict, object_id: str) -> dict:
    return next(
        node
        for node in document["nodes"]
        if any(
            ref["entity_type"] == "PhysicalObject"
            and ref["entity_id"] == object_id
            for ref in node["source_refs"]
        )
    )


def test_create_and_idempotently_update_arbitrary_physical_object_class():
    created = client.post(
        "/v1/topology/physical-objects",
        json={
            "display_name": "Outlet1",
            "class": "outlet",
            "initial_connection_point": {"display_name": "Port"},
        },
    )

    assert created.status_code == 201
    object_id = created.json()["physical_object"]["source_ref"]["entity_id"]
    assert created.json()["physical_object"]["class"] == "outlet"
    assert node_for(physical_projection(), object_id)["attributes"]["class"] == "outlet"

    for value in ("custom-appliance", "custom-appliance"):
        updated = client.put(
            f"/v1/topology/physical-objects/{object_id}/class",
            json={"value": value},
        )
        assert updated.status_code == 200
        assert updated.json()["physical_object"]["class"] == value

    details = client.get(f"/v1/topology/physical-objects/{object_id}")
    assert details.status_code == 200
    assert details.json()["physical_object"]["class"] == "custom-appliance"
    assert node_for(physical_projection(), object_id)["attributes"]["class"] == (
        "custom-appliance"
    )
    with SessionLocal() as session:
        rows = tuple(
            session.scalars(
                select(EntityMetadata).where(
                    EntityMetadata.physical_object_id == uuid.UUID(object_id),
                    EntityMetadata.key == PHYSICAL_OBJECT_CLASS_KEY,
                )
            )
        )
        assert len(rows) == 1
        assert rows[0].value == "custom-appliance"


def test_missing_class_remains_valid_and_is_not_inferred():
    created = client.post(
        "/v1/topology/physical-objects",
        json={
            "display_name": "Looks like a cable",
            "initial_connection_point": {"display_name": "Port"},
        },
    )

    assert created.status_code == 201
    object_id = created.json()["physical_object"]["source_ref"]["entity_id"]
    assert "class" not in created.json()["physical_object"]
    assert "class" not in node_for(physical_projection(), object_id)["attributes"]


def test_new_endpoint_connection_cable_has_explicit_class():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        first = repository.add_physical_object()
        first_point = repository.add_connection_point(first.id, cardinality=1)
        second = repository.add_physical_object()
        second_point = repository.add_connection_point(second.id, cardinality=1)

    response = client.post(
        "/v1/topology/physical-connections",
        json={
            "source": {
                "kind": "CONNECTION_POINT",
                "connection_point_id": str(first_point.id),
                "member_index": 1,
            },
            "target": {
                "kind": "CONNECTION_POINT",
                "connection_point_id": str(second_point.id),
                "member_index": 1,
            },
            "cable_display_name": "cable-1",
        },
    )

    assert response.status_code == 201
    cable_id = response.json()["cable_ref"]["entity_id"]
    details = client.get(f"/v1/topology/physical-objects/{cable_id}")
    assert details.status_code == 200
    assert details.json()["physical_object"]["class"] == "cable"
    cable_node = node_for(physical_projection(), cable_id)
    assert cable_node["attributes"]["class"] == "cable"
    assert any(
        ref["entity_type"] == "EntityMetadata"
        for ref in cable_node["source_refs"]
    )


def test_class_write_rejects_blank_and_unknown_object():
    blank = client.put(
        "/v1/topology/physical-objects/00000000-0000-0000-0000-000000000101/class",
        json={"value": "   "},
    )
    missing = client.put(
        "/v1/topology/physical-objects/00000000-0000-0000-0000-000000000101/class",
        json={"value": "switch"},
    )

    assert blank.status_code == 422
    assert missing.status_code == 422
    with SessionLocal() as session:
        assert tuple(session.scalars(select(EntityMetadata))) == ()
