"""Targeted direct-slot Blueprint API and materialization contracts."""
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import SessionLocal
from app.main import app
from app.models import BlueprintEndpointSlot, BlueprintInstanceSlot, EntityMetadata, InterfacePhysicalBinding

client = TestClient(app, raise_server_exceptions=False)


def slot(key: str, kind: str = "CONNECTION_POINT", face: str = "FRONT", x: float = .2, y: float = .3, name: str | None = None) -> dict:
    return {"key": key, "display_name": name or key, "kind": kind, "face": face, "rendered_position": {"x": x, "y": y}}


def create_blueprint(slots: list[dict], links: list[dict] | None = None, *, name: str = "Blueprint", body: dict | None = None, **_: object) -> tuple[str, str]:
    response = client.post("/v1/library/object-blueprints", json={"name": name, "body": body or {"kind": "RECTANGLE", "width": 100, "height": 40}, "slots": slots, "internal_links": links or []})
    assert response.status_code == 201, response.text
    return response.json()["blueprint_ref"]["entity_id"], response.json()["version_ref"]["entity_id"]


def instantiate(blueprint_id: str, version_id: str, name: str = "Object") -> dict:
    response = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}/instantiate", json={"display_name": name})
    assert response.status_code == 201, response.text
    return response.json()


def test_direct_slots_snapshot_and_materialization():
    slots = [slot("opaque-a", face="REAR", x=.77, y=.61, name="rear point"), slot("opaque-b", "NETWORK_PORT", name="eth-custom")]
    blueprint_id, version_id = create_blueprint(slots, [{"from_slot_key": "opaque-a", "to_slot_key": "opaque-b"}])
    detail = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}")
    assert detail.status_code == 200, detail.text
    assert sorted(detail.json()["slots"], key=lambda item: item["key"]) == slots
    assert "composition" not in detail.json()
    assert detail.json()["internal_links"] == [{"from_slot_key": "opaque-a", "to_slot_key": "opaque-b"}]
    created = instantiate(blueprint_id, version_id)
    assert len(created["slots"]) == 2
    assert len([item for item in created["slots"] if item.get("network_interface_ref") is not None]) == 1
    with SessionLocal() as session:
        mappings = session.scalars(select(BlueprintInstanceSlot)).all()
        assert len(mappings) == 2
        assert session.scalars(select(InterfacePhysicalBinding)).first() is not None
        aliases = {item.value for item in session.scalars(select(EntityMetadata).where(EntityMetadata.key == "alias.display"))}
        assert {"rear point", "eth-custom"}.issubset(aliases)
        network_slot = next(item for item in created["slots"] if item["slot_key"] == "opaque-b")
        interface_id = uuid.UUID(network_slot["network_interface_ref"]["entity_id"])
        point_id = uuid.UUID(network_slot["connection_point_ref"]["entity_id"])
        assert session.scalar(select(EntityMetadata.value).where(EntityMetadata.network_interface_id == interface_id, EntityMetadata.key == "alias.display")) == "eth-custom"
        assert session.scalar(select(EntityMetadata.value).where(EntityMetadata.connection_point_id == point_id, EntityMetadata.key == "alias.display")) == "eth-custom"


def test_invalid_direct_slots_and_links_rejected():
    base = {"name": "Invalid", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "slots": [slot("a"), slot("b")], "internal_links": []}
    for payload in (
        {**base, "slots": [slot("a", face="SIDE")]},
        {**base, "slots": [slot("a", x=1.1)]},
        {**base, "slots": [slot("a"), slot("a")]},
        {**base, "internal_links": [{"from_slot_key": "a", "to_slot_key": "missing"}]},
        {**base, "internal_links": [{"from_slot_key": "a", "to_slot_key": "a"}]},
        {**base, "internal_links": [{"from_slot_key": "a", "to_slot_key": "b"}, {"from_slot_key": "b", "to_slot_key": "a"}]},
    ):
        response = client.post("/v1/library/object-blueprints", json=payload)
        assert response.status_code == 422, response.text
    assert client.get("/v1/library/port-blocks").status_code == 404


def test_version_preserves_key_and_additive_upgrade():
    blueprint_id, first_id = create_blueprint([slot("stable", "NETWORK_PORT", name="old")])
    initial = instantiate(blueprint_id, first_id)
    object_id = initial["physical_object_ref"]["entity_id"]
    response = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={
        "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "slots": [slot("stable", "NETWORK_PORT", face="REAR", x=.8, name="renamed"), slot("new", name="added")],
        "internal_links": [],
    })
    assert response.status_code == 201, response.text
    second_id = response.json()["version_ref"]["entity_id"]
    with SessionLocal() as session:
        exact = session.scalars(select(BlueprintEndpointSlot).where(BlueprintEndpointSlot.blueprint_version_id == uuid.UUID(second_id))).all()
        assert {item.slot_key for item in exact} == {"stable", "new"}
    analysis = client.get(f"/v1/topology/physical-objects/{object_id}/blueprint-upgrade-analysis")
    assert analysis.status_code == 200, analysis.text
    assert {item["code"] for item in analysis.json()["compatible_changes"]} >= {"SLOT_PRESERVED", "SLOT_ADDED", "PRESENTATION_CHANGED"}
    upgrade = client.post(f"/v1/topology/physical-objects/{object_id}/blueprint-upgrade", json={"target_version_id": second_id})
    assert upgrade.status_code == 200, upgrade.text
    before = {item["slot_key"]: item for item in initial["slots"]}
    after = {item["slot_key"]: item for item in upgrade.json()["slots"]}
    assert after["stable"]["connection_point_ref"] == before["stable"]["connection_point_ref"]
    assert after["stable"]["network_interface_ref"] == before["stable"]["network_interface_ref"]
    assert "new" in after
