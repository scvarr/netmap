import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.device_catalog import DISPLAY_ALIAS_KEY, DeviceCatalog
from app.main import app
from app.models import (
    ConnectionPoint,
    EntityMetadata,
    InterfaceAddress,
    InterfacePhysicalBinding,
    L2Binding,
    L3Binding,
    NetworkInterface,
    NetworkInterfacePhysicalOwner,
    PhysicalObject,
)
from app.repository import CanonicalRepository


client = TestClient(app)


def create_request(device_name: str = "CORE-NEW", interface_name: str = "eth0") -> dict:
    return {
        "display_name": device_name,
        "initial_interface": {"display_name": interface_name},
    }


def projection_query() -> dict:
    return {
        "layer": "L2",
        "detail_level": "DEVICE",
        "scope": {"include_location_subtrees": [], "include_entities": []},
    }


def test_create_network_device_is_atomic_and_visible_in_public_reads():
    response = client.post(
        "/v1/topology/devices",
        json=create_request("  CORE-NEW  ", "  eth0  "),
    )

    assert response.status_code == 201
    created = response.json()
    assert created["device"]["label"] == "CORE-NEW"
    assert "label_source" not in created["device"]
    assert len(created["interfaces"]) == 1
    assert created["interfaces"][0]["label"] == "eth0"
    assert "label_source" not in created["interfaces"][0]
    assert created["interfaces"][0]["addresses"] == []
    assert created["interfaces"][0]["direct_physical_bindings"] == []

    device_id = created["device"]["source_ref"]["entity_id"]
    interface_id = created["interfaces"][0]["interface_ref"]["entity_id"]
    device_uuid = uuid.UUID(device_id)
    interface_uuid = uuid.UUID(interface_id)
    with SessionLocal() as session:
        physical_object = session.get(PhysicalObject, device_uuid)
        network_interface = session.get(NetworkInterface, interface_uuid)
        owner = session.scalar(
            select(NetworkInterfacePhysicalOwner).where(
                NetworkInterfacePhysicalOwner.interface_id == interface_uuid
            )
        )
        aliases = tuple(
            session.scalars(select(EntityMetadata).order_by(EntityMetadata.value))
        )
        assert physical_object is not None
        assert network_interface is not None
        assert owner is not None
        assert str(owner.physical_object_id) == device_id
        assert {(alias.key, alias.value) for alias in aliases} == {
            (DISPLAY_ALIAS_KEY, "CORE-NEW"),
            (DISPLAY_ALIAS_KEY, "eth0"),
        }
        assert sum(alias.physical_object_id is not None for alias in aliases) == 1
        assert sum(alias.network_interface_id is not None for alias in aliases) == 1
        for model in (
            ConnectionPoint,
            InterfacePhysicalBinding,
            L2Binding,
            L3Binding,
            InterfaceAddress,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0

    projection = client.post("/v1/topology/projection", json=projection_query())
    assert projection.status_code == 200
    projection_body = projection.json()
    assert projection_body["edges"] == []
    assert len(projection_body["nodes"]) == 1
    assert projection_body["nodes"][0]["label"] == "CORE-NEW"
    assert projection_body["nodes"][0]["attributes"] == {
        "label_source": "ALIAS_DISPLAY",
        "owned_interface_count": 1,
    }

    details = client.get(f"/v1/topology/devices/{device_id}")
    assert details.status_code == 200
    assert details.json()["device"]["label"] == "CORE-NEW"
    assert [item["label"] for item in details.json()["interfaces"]] == ["eth0"]


@pytest.mark.parametrize(
    "payload",
    [
        create_request("", "eth0"),
        create_request("   ", "eth0"),
        create_request("CORE-NEW", ""),
        create_request("CORE-NEW", "   "),
    ],
)
def test_create_network_device_rejects_blank_names_without_writes(payload: dict):
    response = client.post("/v1/topology/devices", json=payload)

    assert response.status_code == 422
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 0
        assert session.scalar(select(func.count()).select_from(NetworkInterface)) == 0
        assert session.scalar(select(func.count()).select_from(EntityMetadata)) == 0


def test_create_network_device_rolls_back_a_mid_operation_failure(monkeypatch):
    original = DeviceCatalog._add_display_alias
    call_count = 0

    def fail_on_second_alias(self, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 2:
            raise RuntimeError("injected alias failure")
        return original(self, **kwargs)

    monkeypatch.setattr(DeviceCatalog, "_add_display_alias", fail_on_second_alias)
    non_raising_client = TestClient(app, raise_server_exceptions=False)

    response = non_raising_client.post(
        "/v1/topology/devices", json=create_request()
    )

    assert response.status_code == 500
    with SessionLocal() as session:
        for model in (
            PhysicalObject,
            NetworkInterface,
            NetworkInterfacePhysicalOwner,
            EntityMetadata,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_existing_objects_without_alias_keep_deterministic_fallback():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        physical_object = repository.add_physical_object()
        network_interface = repository.add_network_interface()
        repository.add_network_interface_physical_owner(
            network_interface.id, physical_object.id
        )

    details = client.get(f"/v1/topology/devices/{physical_object.id}").json()
    projection = client.post("/v1/topology/projection", json=projection_query()).json()

    assert details["device"]["label"] == f"PhysicalObject {str(physical_object.id)[:8]}"
    assert details["device"]["label_source"] == "TECHNICAL_FALLBACK"
    assert details["interfaces"][0]["label"] == (
        f"NetworkInterface {str(network_interface.id)[:8]}"
    )
    assert details["interfaces"][0]["label_source"] == "TECHNICAL_FALLBACK"
    assert projection["nodes"][0]["label"] == (
        f"PhysicalObject {str(physical_object.id)[:8]}"
    )
    assert projection["nodes"][0]["attributes"]["label_source"] == (
        "TECHNICAL_FALLBACK"
    )
