import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.device_catalog import DISPLAY_ALIAS_KEY
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
    NetworkInterfacePhysicalOwner,
    NetworkInterfaceRealization,
    PhysicalObject,
)
from app.repository import CanonicalRepository


client = TestClient(app)


def create_device(display_name: str) -> dict:
    response = client.post(
        "/v1/topology/devices",
        json={
            "display_name": display_name,
            "initial_interface": {"display_name": "eth0"},
        },
    )
    assert response.status_code == 201
    return response.json()


def interface_id(document: dict) -> str:
    return document["interfaces"][0]["interface_ref"]["entity_id"]


def device_id(document: dict) -> str:
    return document["device"]["source_ref"]["entity_id"]


def create_link(
    source_interface_id: str,
    target_interface_id: str,
    cable_display_name: str | None = "CORE-FW-01",
):
    body = {
        "source_interface_id": source_interface_id,
        "target_interface_id": target_interface_id,
    }
    return client.post("/v1/topology/physical-links", json=body)


def projection_query() -> dict:
    return {
        "layer": "L2",
        "detail_level": "DEVICE",
        "scope": {"include_location_subtrees": [], "include_entities": []},
    }


def assert_no_link_facts() -> None:
    with SessionLocal() as session:
        for model in (
            ConnectionPoint,
            InterfacePhysicalBinding,
            Connection,
            ConnectionMember,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_create_physical_link_materializes_one_connection_and_cable():
    source, target = create_device("CORE"), create_device("FW")
    response = create_link(interface_id(source), interface_id(target))
    assert response.status_code == 201
    body = response.json()
    assert body["cable_ref"]["entity_type"] == "Cable"
    assert body["connection_ref"]["entity_type"] == "Connection"
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Connection)) == 1
        assert session.scalar(select(func.count()).select_from(InterfacePhysicalBinding)) == 2
    assert client.post("/v1/traces/interfaces/physical", json={"from_interface_id": interface_id(source), "to_interface_id": interface_id(target)}).json()["verdict"] == "REACHABLE"
def test_create_physical_link_rejects_same_interface_without_writes():
    source = create_device("CORE")

    response = create_link(interface_id(source), interface_id(source))

    assert response.status_code == 422
    assert "two different NetworkInterfaces" in response.json()["error"]["message"]
    assert_no_link_facts()


def test_create_physical_link_rejects_unknown_interface_without_writes():
    source = create_device("CORE")

    response = create_link(interface_id(source), str(uuid.uuid4()))

    assert response.status_code == 422
    assert response.json()["error"]["message"] == "NetworkInterface does not exist"
    assert_no_link_facts()


def test_create_physical_link_rejects_interface_without_owner_without_writes():
    source = create_device("CORE")
    with SessionLocal.begin() as session:
        ownerless_interface = CanonicalRepository(session).add_network_interface()
        ownerless_interface_id = str(ownerless_interface.id)

    response = create_link(interface_id(source), ownerless_interface_id)

    assert response.status_code == 422
    assert response.json()["error"]["message"] == "NetworkInterface has no physical owner"
    assert_no_link_facts()


def test_create_physical_link_rejects_already_bound_interface_without_new_writes():
    source = create_device("CORE")
    target = create_device("FW")
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        point = repository.add_connection_point(uuid.UUID(device_id(source)), 1)
        repository.add_interface_physical_binding(
            uuid.UUID(interface_id(source)), point.id, 1
        )

    response = create_link(interface_id(source), interface_id(target))

    assert response.status_code == 422
    assert "already has a direct physical binding" in response.json()["error"]["message"]
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(ConnectionPoint)) == 1
        assert session.scalar(
            select(func.count()).select_from(InterfacePhysicalBinding)
        ) == 1
        assert session.scalar(select(func.count()).select_from(Connection)) == 0
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 2


def test_create_physical_link_rolls_back_mid_operation(monkeypatch):
    source = create_device("CORE")
    target = create_device("FW")
    original = CanonicalRepository.add_connection
    call_count = 0

    def fail_on_second_connection(self, *args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("injected physical link failure")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(CanonicalRepository, "add_connection", fail_on_second_connection)
    non_raising_client = TestClient(app, raise_server_exceptions=False)

    response = non_raising_client.post(
        "/v1/topology/physical-links",
        json={
            "source_interface_id": interface_id(source),
            "target_interface_id": interface_id(target),
            
        },
    )

    assert response.status_code == 500
    assert_no_link_facts()
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 2
        assert session.scalar(select(func.count()).select_from(NetworkInterface)) == 2
        assert session.scalar(
            select(func.count()).select_from(NetworkInterfacePhysicalOwner)
        ) == 2
        assert session.scalar(select(func.count()).select_from(EntityMetadata)) == 4
