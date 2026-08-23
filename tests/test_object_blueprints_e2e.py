import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import (
    BlueprintInstance,
    BlueprintInstanceSlot,
    Connection,
    ConnectionMember,
    ConnectionPoint,
    InterfacePhysicalBinding,
    NetworkInterface,
    ObjectBlueprintVersion,
    PhysicalObject,
)
from app.repository import CanonicalRepository


client = TestClient(app)


def slot(key: str, kind: str = "CONNECTION_POINT") -> dict:
    return {
        "key": key,
        "display_name": key,
        "kind": kind,
        "anchor": {"side": "LEFT", "offset": 0.5},
    }


def create_blueprint(slots: list[dict], links: list[dict] | None = None, **extra: object) -> tuple[str, str]:
    response = client.post("/v1/library/object-blueprints", json={
        "name": extra.pop("name", "Blueprint"),
        "body": extra.pop("body", {"kind": "RECTANGLE", "width": 100, "height": 40}),
        "slots": slots,
        "internal_links": links or [],
        **extra,
    })
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["blueprint_ref"]["ref_type"] == "LIBRARY_RECORD"
    return body["blueprint_ref"]["entity_id"], body["version_ref"]["entity_id"]


def instantiate(blueprint_id: str, version_id: str, display_name: str) -> dict:
    response = client.post(
        f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}/instantiate",
        json={"display_name": display_name},
    )
    assert response.status_code == 201, response.text
    return response.json()


def trace(point_a_id: str, point_b_id: str) -> str:
    response = client.post("/v1/traces/l1", json={
        "from": {"point_id": point_a_id, "member_index": 1},
        "to": {"point_id": point_b_id, "member_index": 1},
    })
    assert response.status_code == 200
    return response.json()["verdict"]


def test_cable_like_blueprint_materializes_two_points_and_one_internal_connection():
    blueprint_id, version_id = create_blueprint(
        [slot("A"), slot("B")],
        [{"from_slot_key": "A", "to_slot_key": "B"}],
        name="Cable",
        body={"kind": "RECTANGLE", "width": 100, "height": 4, "fill_color": "#A0B1C2"},
        default_physical_object_class="cable",
    )
    created = instantiate(blueprint_id, version_id, "Cable-1")
    assert created["physical_object_ref"]["entity_type"] == "PhysicalObject"
    assert {item["slot_key"] for item in created["slots"]} == {"A", "B"}
    details = client.get(
        f"/v1/topology/physical-objects/{created['physical_object_ref']['entity_id']}"
    )
    assert details.status_code == 200
    assert details.json()["physical_object"]["label"] == "Cable-1"
    assert details.json()["physical_object"]["class"] == "cable"
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 1
        assert session.scalar(select(func.count()).select_from(ConnectionPoint)) == 2
        assert session.scalar(select(func.count()).select_from(Connection)) == 1
        assert session.scalar(select(func.count()).select_from(ConnectionMember)) == 1


def test_patch_panel_connectivity_follows_only_explicit_internal_pairs():
    blueprint_id, version_id = create_blueprint(
        [slot("front01"), slot("rear01"), slot("front02"), slot("rear02")],
        [
            {"from_slot_key": "front01", "to_slot_key": "rear01"},
            {"from_slot_key": "front02", "to_slot_key": "rear02"},
        ],
        name="Patch panel",
    )
    created = instantiate(blueprint_id, version_id, "PP1")
    points = {item["slot_key"]: item["connection_point_ref"]["entity_id"] for item in created["slots"]}
    assert trace(points["front01"], points["rear01"]) == "REACHABLE"
    assert trace(points["front02"], points["rear02"]) == "REACHABLE"
    assert trace(points["front01"], points["rear02"]) == "UNKNOWN"


def test_switch_ports_materialize_without_an_implicit_l1_connection():
    blueprint_id, version_id = create_blueprint([slot("eth1", "NETWORK_PORT"), slot("eth2", "NETWORK_PORT")])
    created = instantiate(blueprint_id, version_id, "SW1")
    assert all("network_interface_ref" in item for item in created["slots"])
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(NetworkInterface)) == 2
        assert session.scalar(select(func.count()).select_from(ConnectionPoint)) == 2
        assert session.scalar(select(func.count()).select_from(InterfacePhysicalBinding)) == 2
        assert session.scalar(select(func.count()).select_from(Connection)) == 0


def test_one_version_materializes_separate_instances_with_persistent_slot_mappings():
    blueprint_id, version_id = create_blueprint([slot("front"), slot("rear")], [{"from_slot_key": "front", "to_slot_key": "rear"}])
    first = instantiate(blueprint_id, version_id, "PP1")
    second = instantiate(blueprint_id, version_id, "PP2")
    assert first["physical_object_ref"]["entity_id"] != second["physical_object_ref"]["entity_id"]
    with SessionLocal() as session:
        version = session.get(ObjectBlueprintVersion, uuid.UUID(version_id))
        assert version is not None and version.version_number == 1
        instances = tuple(session.scalars(select(BlueprintInstance).order_by(BlueprintInstance.id)))
        assert len(instances) == 2
        assert {instance.blueprint_version_id for instance in instances} == {uuid.UUID(version_id)}
        mappings = tuple(session.scalars(select(BlueprintInstanceSlot)))
        assert len(mappings) == 4
        assert len({mapping.connection_point_id for mapping in mappings}) == 4


def test_failed_materialization_rolls_back_all_canonical_and_instance_rows(monkeypatch):
    blueprint_id, version_id = create_blueprint([slot("A"), slot("B")], [{"from_slot_key": "A", "to_slot_key": "B"}])
    original = CanonicalRepository.add_connection

    def fail_connection(self, *args, **kwargs):
        raise RuntimeError("injected internal link failure")

    monkeypatch.setattr(CanonicalRepository, "add_connection", fail_connection)
    response = TestClient(app, raise_server_exceptions=False).post(
        f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}/instantiate",
        json={"display_name": "broken"},
    )
    assert response.status_code == 500
    monkeypatch.setattr(CanonicalRepository, "add_connection", original)
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 0
        assert session.scalar(select(func.count()).select_from(BlueprintInstance)) == 0
        assert session.scalar(select(func.count()).select_from(BlueprintInstanceSlot)) == 0


@pytest.mark.parametrize("payload", [
    {"name": "", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "slots": []},
    {"name": "x", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "slots": [{**slot("a"), "key": ""}]},
    {"name": "x", "body": {"kind": "RECTANGLE", "width": 1, "height": 1, "fill_color": "red"}, "slots": []},
    {"name": "x", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "slots": [slot("a"), slot("a")]},
    {"name": "x", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "slots": [slot("a")], "internal_links": [{"from_slot_key": "a", "to_slot_key": "missing"}]},
    {"name": "x", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "slots": [slot("a")], "internal_links": [{"from_slot_key": "a", "to_slot_key": "a"}]},
    {"name": "x", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "slots": [slot("a"), slot("b")], "internal_links": [{"from_slot_key": "a", "to_slot_key": "b"}, {"from_slot_key": "b", "to_slot_key": "a"}]},
    {"name": "x", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "slots": [{**slot("a"), "anchor": {"side": "LEFT", "offset": 2}}]},
])
def test_blueprint_request_validation_rejects_invalid_authoring_without_writes(payload: dict):
    assert client.post("/v1/library/object-blueprints", json=payload).status_code == 422
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 0
        assert session.scalar(select(func.count()).select_from(BlueprintInstance)) == 0
