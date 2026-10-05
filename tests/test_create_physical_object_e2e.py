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
    assert point["external_connection_count"] == 1
    assert point["direct_interface_binding_count"] == 1
    assert point["direct_interface_bindings"][0]["interface_ref"]["entity_id"] == str(interface.id)
    attachment = point["external_physical_attachments"][0]
    assert attachment["kind"] == "DIRECT_CONNECTION"
    assert attachment["remote_connection_point_ref"]["entity_id"] == str(peer_point.id)
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
