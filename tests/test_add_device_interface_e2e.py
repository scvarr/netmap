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
    NetworkInterfaceRealization,
)


client = TestClient(app)


def create_device() -> dict:
    response = client.post(
        "/v1/topology/devices",
        json={
            "display_name": "CORE-NEW",
            "initial_interface": {"display_name": "eth0"},
        },
    )
    assert response.status_code == 201
    return response.json()


def add_interface(device_id: str, display_name: str = "eth1"):
    return client.post(
        f"/v1/topology/devices/{device_id}/interfaces",
        json={"display_name": display_name},
    )


def projection_query() -> dict:
    return {
        "layer": "L2",
        "detail_level": "DEVICE",
        "scope": {"include_location_subtrees": [], "include_entities": []},
    }


def test_add_interface_persists_alias_owner_and_updates_public_reads():
    created = create_device()
    device_id = created["device"]["source_ref"]["entity_id"]

    response = add_interface(device_id, "  eth1  ")

    assert response.status_code == 201
    body = response.json()
    assert body["device"]["label"] == "CORE-NEW"
    assert {item["label"] for item in body["interfaces"]} == {"eth0", "eth1"}
    new_interface = next(item for item in body["interfaces"] if item["label"] == "eth1")
    assert new_interface["addresses"] == []
    assert new_interface["direct_physical_bindings"] == []
    assert new_interface["l2_binding_count"] == 0
    assert new_interface["l3_binding_count"] == 0
    assert new_interface["realization_down_count"] == 0
    assert new_interface["realization_up_count"] == 0

    interface_id = uuid.UUID(new_interface["interface_ref"]["entity_id"])
    with SessionLocal() as session:
        alias = session.scalar(
            select(EntityMetadata).where(
                EntityMetadata.network_interface_id == interface_id,
                EntityMetadata.key == DISPLAY_ALIAS_KEY,
            )
        )
        owner = session.scalar(
            select(NetworkInterfacePhysicalOwner).where(
                NetworkInterfacePhysicalOwner.interface_id == interface_id
            )
        )
        assert alias is not None
        assert alias.value == "eth1"
        assert owner is not None
        assert owner.physical_object_id == uuid.UUID(device_id)
        for model in (
            ConnectionPoint,
            InterfacePhysicalBinding,
            NetworkInterfaceRealization,
            L2Binding,
            L3Binding,
            InterfaceAddress,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0

    details = client.get(f"/v1/topology/devices/{device_id}")
    projection = client.post("/v1/topology/projection", json=projection_query())
    assert {item["label"] for item in details.json()["interfaces"]} == {"eth0", "eth1"}
    assert projection.json()["nodes"][0]["attributes"]["owned_interface_count"] == 2


def test_add_interface_does_not_add_display_name_uniqueness_semantics():
    created = create_device()
    device_id = created["device"]["source_ref"]["entity_id"]

    first = add_interface(device_id, "eth0")

    assert first.status_code == 201
    assert [item["label"] for item in first.json()["interfaces"]].count("eth0") == 2


@pytest.mark.parametrize("display_name", ["", "   "])
def test_add_interface_rejects_blank_name_without_writes(display_name: str):
    created = create_device()
    device_id = created["device"]["source_ref"]["entity_id"]

    response = add_interface(device_id, display_name)

    assert response.status_code == 422
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(NetworkInterface)) == 1
        assert session.scalar(
            select(func.count()).select_from(NetworkInterfacePhysicalOwner)
        ) == 1
        assert session.scalar(select(func.count()).select_from(EntityMetadata)) == 2


def test_add_interface_rejects_unknown_device_without_writes():
    response = add_interface(str(uuid.uuid4()))

    assert response.status_code == 422
    assert response.json()["error"]["message"] == "PhysicalObject does not exist"
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(NetworkInterface)) == 0
        assert session.scalar(select(func.count()).select_from(EntityMetadata)) == 0


def test_add_interface_rolls_back_a_mid_operation_failure(monkeypatch):
    created = create_device()
    device_id = created["device"]["source_ref"]["entity_id"]

    def fail_alias(self, **kwargs):
        raise RuntimeError("injected interface alias failure")

    monkeypatch.setattr(DeviceCatalog, "_add_display_alias", fail_alias)
    non_raising_client = TestClient(app, raise_server_exceptions=False)

    response = non_raising_client.post(
        f"/v1/topology/devices/{device_id}/interfaces",
        json={"display_name": "eth1"},
    )

    assert response.status_code == 500
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(NetworkInterface)) == 1
        assert session.scalar(
            select(func.count()).select_from(NetworkInterfacePhysicalOwner)
        ) == 1
        assert session.scalar(select(func.count()).select_from(EntityMetadata)) == 2
