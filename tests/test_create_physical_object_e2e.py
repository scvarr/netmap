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
    InterfacePhysicalBinding,
    L2Binding,
    L3Binding,
    NetworkInterface,
    NetworkInterfacePhysicalOwner,
    PhysicalObject,
)
from app.repository import CanonicalRepository, ConnectionMemberInput


client = TestClient(app)


def create_request(object_name: str = "Розетка 101-1", point_name: str = "Порт") -> dict:
    return {
        "display_name": object_name,
        "initial_connection_point": {"display_name": point_name},
    }


def projection_query(layer: str, detail_level: str) -> dict:
    return {
        "layer": layer,
        "detail_level": detail_level,
        "scope": {"include_location_subtrees": [], "include_entities": []},
    }


def test_create_physical_object_is_atomic_and_visible_only_in_l1_projection():
    response = client.post(
        "/v1/topology/physical-objects",
        json=create_request("  Розетка 101-1  ", "  Порт  "),
    )

    assert response.status_code == 201
    created = response.json()
    assert created["schema_version"] == "1.0"
    assert created["physical_object"]["label"] == "Розетка 101-1"
    assert "label_source" not in created["physical_object"]
    assert created["owned_interface_count"] == 0
    assert created["gaps"] == []
    assert created["warnings"] == []
    assert len(created["connection_points"]) == 1
    point_document = created["connection_points"][0]
    assert point_document["label"] == "Порт"
    assert "label_source" not in point_document
    assert point_document["cardinality"] == 1
    assert point_document["incident_connection_count"] == 0
    assert point_document["direct_interface_binding_count"] == 0

    object_id = uuid.UUID(created["physical_object"]["source_ref"]["entity_id"])
    point_id = uuid.UUID(point_document["connection_point_ref"]["entity_id"])
    with SessionLocal() as session:
        assert session.get(PhysicalObject, object_id) is not None
        point = session.get(ConnectionPoint, point_id)
        assert point is not None
        assert point.physical_object_id == object_id
        assert point.cardinality == 1
        aliases = tuple(session.scalars(select(EntityMetadata).order_by(EntityMetadata.value)))
        assert {(alias.key, alias.value) for alias in aliases} == {
            (DISPLAY_ALIAS_KEY, "Розетка 101-1"),
            (DISPLAY_ALIAS_KEY, "Порт"),
        }
        assert sum(alias.physical_object_id == object_id for alias in aliases) == 1
        assert sum(alias.connection_point_id == point_id for alias in aliases) == 1
        assert all(alias.network_interface_id is None for alias in aliases)
        for model in (
            NetworkInterface,
            NetworkInterfacePhysicalOwner,
            InterfacePhysicalBinding,
            Connection,
            ConnectionMember,
            L2Binding,
            L3Binding,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0

    details = client.get(f"/v1/topology/physical-objects/{object_id}")
    assert details.status_code == 200
    assert details.json() == created

    physical = client.post(
        "/v1/topology/projection",
        json=projection_query("L1", "PHYSICAL_OBJECT"),
    )
    assert physical.status_code == 200
    assert len(physical.json()["nodes"]) == 1
    assert physical.json()["nodes"][0]["label"] == "Розетка 101-1"
    assert physical.json()["nodes"][0]["attributes"] == {
        "label_source": "ALIAS_DISPLAY",
        "connection_point_count": 1,
        "owned_interface_count": 0,
    }
    logical = client.post(
        "/v1/topology/projection",
        json=projection_query("L2", "DEVICE"),
    )
    assert logical.status_code == 200
    assert logical.json()["nodes"] == []


@pytest.mark.parametrize(
    "payload",
    [
        create_request("", "Порт"),
        create_request("   ", "Порт"),
        create_request("Розетка 101-1", ""),
        create_request("Розетка 101-1", "   "),
    ],
)
def test_create_physical_object_rejects_blank_names_without_writes(payload: dict):
    response = client.post("/v1/topology/physical-objects", json=payload)

    assert response.status_code == 422
    with SessionLocal() as session:
        for model in (PhysicalObject, ConnectionPoint, EntityMetadata):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_create_physical_object_rolls_back_a_mid_operation_failure(monkeypatch):
    original = DeviceCatalog._add_display_alias
    call_count = 0

    def fail_on_second_alias(self, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("injected connection point alias failure")
        return original(self, **kwargs)

    monkeypatch.setattr(DeviceCatalog, "_add_display_alias", fail_on_second_alias)
    non_raising_client = TestClient(app, raise_server_exceptions=False)

    response = non_raising_client.post(
        "/v1/topology/physical-objects",
        json=create_request(),
    )

    assert response.status_code == 500
    with SessionLocal() as session:
        for model in (PhysicalObject, ConnectionPoint, EntityMetadata):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_physical_object_details_reports_factual_connection_and_binding_counts():
    with SessionLocal.begin() as session:
        catalog = DeviceCatalog(session)
        created = catalog.create_physical_object("Panel", "Port 1")
        repository = CanonicalRepository(session)
        peer = repository.add_physical_object()
        peer_point = repository.add_connection_point(peer.id, cardinality=1)
        connection, members = repository.add_connection(
            created.connection_point_id,
            peer_point.id,
            cardinality=1,
            members=[ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)],
        )
        interface = repository.add_network_interface()
        owner = repository.add_network_interface_physical_owner(
            interface.id,
            created.physical_object_id,
        )
        binding = repository.add_interface_physical_binding(
            interface.id,
            created.connection_point_id,
            point_member=1,
        )

    response = client.get(
        f"/v1/topology/physical-objects/{created.physical_object_id}"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["owned_interface_count"] == 1
    point = body["connection_points"][0]
    assert point["incident_connection_count"] == 1
    assert point["direct_interface_binding_count"] == 1
    refs = {(ref["entity_type"], ref["entity_id"]) for ref in point["source_refs"]}
    assert {
        ("ConnectionPoint", str(created.connection_point_id)),
        ("Connection", str(connection.id)),
        ("ConnectionMember", str(members[0].id)),
        ("InterfacePhysicalBinding", str(binding.id)),
        ("NetworkInterface", str(interface.id)),
    } <= refs
    assert owner.id is not None


def test_physical_object_details_keeps_deterministic_fallback_and_rejects_missing():
    object_id = uuid.UUID("00000000-0000-0000-0000-000000000101")
    point_id = uuid.UUID("00000000-0000-0000-0000-000000000102")
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_physical_object(object_id)
        repository.add_connection_point(object_id, cardinality=2, point_id=point_id)

    response = client.get(f"/v1/topology/physical-objects/{object_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["physical_object"]["label"] == "PhysicalObject 00000000"
    assert body["physical_object"]["label_source"] == "TECHNICAL_FALLBACK"
    assert body["connection_points"][0]["label"] == "ConnectionPoint 00000000"
    assert body["connection_points"][0]["label_source"] == "TECHNICAL_FALLBACK"

    missing = client.get(
        "/v1/topology/physical-objects/00000000-0000-0000-0000-000000000199"
    )
    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "VALIDATION_ERROR"
