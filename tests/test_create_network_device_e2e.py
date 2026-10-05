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
