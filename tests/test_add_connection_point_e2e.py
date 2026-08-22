import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.device_catalog import DISPLAY_ALIAS_KEY, DeviceCatalog
from app.main import app
from app.models import (
    Connection,
    ConnectionMember,
    ConnectionPoint,
    EntityMetadata,
    InterfaceAddress,
    InterfacePhysicalBinding,
    L2Binding,
    L3Binding,
    NetworkInterface,
    PhysicalObject,
)


client = TestClient(app)


def create_object() -> dict:
    response = client.post(
        "/v1/topology/physical-objects",
        json={
            "display_name": "PP1",
            "class": "patch_panel",
            "initial_connection_point": {"display_name": "Port01"},
        },
    )
    assert response.status_code == 201
    return response.json()


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


def test_add_connection_point_is_atomic_and_updates_details_and_projection():
    created = create_object()
    object_id = created["physical_object"]["source_ref"]["entity_id"]

    response = client.post(
        f"/v1/topology/physical-objects/{object_id}/connection-points",
        json={"display_name": "  Port02  "},
    )

    assert response.status_code == 201
    document = response.json()
    assert document["physical_object"] == created["physical_object"]
    assert {point["label"] for point in document["connection_points"]} == {
        "Port01",
        "Port02",
    }
    added = next(
        point for point in document["connection_points"] if point["label"] == "Port02"
    )
    assert added["cardinality"] == 1
    assert added["incident_connection_count"] == 0
    assert added["direct_interface_binding_count"] == 0
    point_id = uuid.UUID(added["connection_point_ref"]["entity_id"])

    with SessionLocal() as session:
        point = session.get(ConnectionPoint, point_id)
        assert point is not None
        assert point.physical_object_id == uuid.UUID(object_id)
        assert point.cardinality == 1
        alias = session.scalar(
            select(EntityMetadata).where(
                EntityMetadata.connection_point_id == point_id,
                EntityMetadata.key == DISPLAY_ALIAS_KEY,
            )
        )
        assert alias is not None
        assert alias.value == "Port02"
        for model in (
            Connection,
            ConnectionMember,
            NetworkInterface,
            InterfacePhysicalBinding,
            L2Binding,
            L3Binding,
            InterfaceAddress,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0

    details = client.get(f"/v1/topology/physical-objects/{object_id}")
    assert details.status_code == 200
    assert details.json() == document
    projection = physical_projection()
    node = next(
        node
        for node in projection["nodes"]
        if any(
            ref["entity_type"] == "PhysicalObject" and ref["entity_id"] == object_id
            for ref in node["source_refs"]
        )
    )
    assert node["attributes"]["connection_point_count"] == 2


def test_duplicate_connection_point_display_names_are_allowed():
    created = create_object()
    object_id = created["physical_object"]["source_ref"]["entity_id"]

    first = client.post(
        f"/v1/topology/physical-objects/{object_id}/connection-points",
        json={"display_name": "Port02"},
    )
    second = client.post(
        f"/v1/topology/physical-objects/{object_id}/connection-points",
        json={"display_name": "Port02"},
    )

    assert first.status_code == second.status_code == 201
    assert [point["label"] for point in second.json()["connection_points"]].count(
        "Port02"
    ) == 2


@pytest.mark.parametrize("display_name", ["", "   "])
def test_add_connection_point_rejects_blank_name(display_name: str):
    created = create_object()
    object_id = created["physical_object"]["source_ref"]["entity_id"]

    response = client.post(
        f"/v1/topology/physical-objects/{object_id}/connection-points",
        json={"display_name": display_name},
    )

    assert response.status_code == 422
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(ConnectionPoint)) == 1


def test_add_connection_point_rejects_unknown_object_without_writes():
    response = client.post(
        "/v1/topology/physical-objects/00000000-0000-0000-0000-000000000199/connection-points",
        json={"display_name": "Port02"},
    )

    assert response.status_code == 422
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(ConnectionPoint)) == 0
        assert session.scalar(select(func.count()).select_from(EntityMetadata)) == 0
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 0


def test_add_connection_point_rolls_back_alias_failure(monkeypatch):
    created = create_object()
    object_id = created["physical_object"]["source_ref"]["entity_id"]

    def fail_alias(*_args, **_kwargs):
        raise RuntimeError("injected alias failure")

    monkeypatch.setattr(DeviceCatalog, "_add_display_alias", fail_alias)
    non_raising_client = TestClient(app, raise_server_exceptions=False)
    response = non_raising_client.post(
        f"/v1/topology/physical-objects/{object_id}/connection-points",
        json={"display_name": "Port02"},
    )

    assert response.status_code == 500
    with SessionLocal() as session:
        points = tuple(
            session.scalars(
                select(ConnectionPoint).where(
                    ConnectionPoint.physical_object_id == uuid.UUID(object_id)
                )
            )
        )
        aliases = tuple(
            session.scalars(
                select(EntityMetadata).where(
                    EntityMetadata.connection_point_id.is_not(None)
                )
            )
        )
        assert len(points) == 1
        assert len(aliases) == 1
