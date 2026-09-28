"""Targeted direct-slot Blueprint API and materialization contracts."""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.main import app
from app.models import BlueprintEndpointSlot, BlueprintInstanceSlot, EntityMetadata, InterfacePhysicalBinding

client = TestClient(app, raise_server_exceptions=False)


def panel(key: str = "panel-1", number: int = 1, name: str = "Панель 1", x: float = 0, y: float = 0, width: float = 100, height: float = 40) -> dict:
    return {"panel_key": key, "panel_number": number, "display_name": name, "x": x, "y": y, "width": width, "height": height}


def slot(key: str, kind: str = "CONNECTION_POINT", panel_key: str = "panel-1", x: float = .2, y: float = .3, name: str | None = None) -> dict:
    return {"key": key, "display_name": name or key, "kind": kind, "panel_key": panel_key, "rendered_position": {"x": x, "y": y}}


def create_blueprint(slots: list[dict], links: list[dict] | None = None, *, name: str = "Blueprint", body: dict | None = None, **_: object) -> tuple[str, str]:
    dimensions = body or {"kind": "RECTANGLE", "width": 100, "height": 40}
    response = client.post("/v1/library/object-blueprints", json={"name": name, "body": dimensions, "panels": [panel(width=dimensions["width"], height=dimensions["height"])], "slots": slots, "internal_links": links or []})
    assert response.status_code == 201, response.text
    return response.json()["blueprint_ref"]["entity_id"], response.json()["version_ref"]["entity_id"]


def instantiate(blueprint_id: str, version_id: str, name: str = "Object") -> dict:
    response = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}/instantiate", json={"display_name": name})
    assert response.status_code == 201, response.text
    return response.json()


def test_direct_slots_snapshot_and_materialization():
    slots = [slot("opaque-a", x=.77, y=.61, name="second point"), slot("opaque-b", "NETWORK_PORT", name="eth-custom")]
    blueprint_id, version_id = create_blueprint(slots, [{"from_slot_key": "opaque-a", "to_slot_key": "opaque-b"}])
    detail = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}")
    assert detail.status_code == 200, detail.text
    assert sorted(detail.json()["slots"], key=lambda item: item["key"]) == slots
    assert detail.json()["panels"] == [panel()]
    assert detail.json()["next_panel_number"] == 2
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
        assert {"second point", "eth-custom"}.issubset(aliases)
        network_slot = next(item for item in created["slots"] if item["slot_key"] == "opaque-b")
        interface_id = uuid.UUID(network_slot["network_interface_ref"]["entity_id"])
        point_id = uuid.UUID(network_slot["connection_point_ref"]["entity_id"])
        assert session.scalar(select(EntityMetadata.value).where(EntityMetadata.network_interface_id == interface_id, EntityMetadata.key == "alias.display")) == "eth-custom"
        assert session.scalar(select(EntityMetadata.value).where(EntityMetadata.connection_point_id == point_id, EntityMetadata.key == "alias.display")) == "eth-custom"


def test_invalid_direct_slots_and_links_rejected():
    base = {"name": "Invalid", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "panels": [panel(width=1, height=1)], "slots": [slot("a"), slot("b")], "internal_links": []}
    for payload in (
        {**base, "slots": [slot("a", panel_key="unknown")]},
        {**base, "slots": [slot("a", x=1.1)]},
        {**base, "slots": [slot("a"), slot("a")]},
        {**base, "internal_links": [{"from_slot_key": "a", "to_slot_key": "missing"}]},
        {**base, "internal_links": [{"from_slot_key": "a", "to_slot_key": "a"}]},
        {**base, "internal_links": [{"from_slot_key": "a", "to_slot_key": "b"}, {"from_slot_key": "b", "to_slot_key": "a"}]},
    ):
        response = client.post("/v1/library/object-blueprints", json=payload)
        assert response.status_code == 422, response.text
    assert client.get("/v1/library/port-blocks").status_code == 404


def test_initial_authoring_can_save_adjacent_panels_and_local_slots():
    response = client.post("/v1/library/object-blueprints", json={
        "name": "Two panels", "body": {"kind": "RECTANGLE", "width": 200, "height": 40},
        "panels": [panel(), panel(key="panel-2", number=2, name="Rear", x=100)],
        "slots": [slot("first"), slot("second", panel_key="panel-2", x=.8, y=.7)],
        "internal_links": [{"from_slot_key": "first", "to_slot_key": "second"}],
    })
    assert response.status_code == 201, response.text
    detail = client.get(f"/v1/library/object-blueprints/{response.json()['blueprint_ref']['entity_id']}/versions/{response.json()['version_ref']['entity_id']}")
    assert detail.status_code == 200
    assert detail.json()["next_panel_number"] == 3
    assert detail.json()["panels"][1]["display_name"] == "Rear"
    assert detail.json()["slots"][1]["rendered_position"] == {"x": .8, "y": .7}


def test_version_preserves_key_and_additive_upgrade():
    blueprint_id, first_id = create_blueprint([slot("stable", "NETWORK_PORT", name="old")])
    initial = instantiate(blueprint_id, first_id)
    object_id = initial["physical_object_ref"]["entity_id"]
    response = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={
        "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "panels": [panel(name="Control", x=5), panel(key="panel-2", number=2, name="Panel 2", x=105)],
        "slots": [slot("stable", "NETWORK_PORT", panel_key="panel-2", x=.8, name="renamed"), slot("new", name="added")],
        "internal_links": [],
    })
    assert response.status_code == 201, response.text
    second_id = response.json()["version_ref"]["entity_id"]
    detail = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{second_id}")
    assert [item["panel_key"] for item in detail.json()["panels"]] == ["panel-1", "panel-2"]
    assert next(item for item in detail.json()["slots"] if item["key"] == "stable")["panel_key"] == "panel-2"
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


def test_slot_cannot_reference_a_panel_from_another_blueprint_version():
    blueprint_id, first_id = create_blueprint([])
    response = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={
        "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "panels": [panel(key="panel-2", number=2, name="Second")],
        "slots": [], "internal_links": [],
    })
    assert response.status_code == 201, response.text
    second_id = response.json()["version_ref"]["entity_id"]
    with pytest.raises(IntegrityError), SessionLocal.begin() as session:
        session.execute(insert(BlueprintEndpointSlot).values(
            id=uuid.uuid4(), blueprint_version_id=uuid.UUID(second_id),
            slot_key="foreign-panel", display_name="Foreign", kind="CONNECTION_POINT",
            panel_key="panel-1", position_x=.5, position_y=.5,
        ))
    assert first_id != second_id


def test_reused_panel_key_keeps_its_number_across_versions():
    blueprint_id, _ = create_blueprint([])
    response = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={
        "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "panels": [panel(number=2)], "slots": [], "internal_links": [],
    })
    assert response.status_code == 422, response.text


def test_deleted_panel_key_and_number_are_not_reused():
    blueprint_id, _ = create_blueprint([])

    def next_version(panels: list[dict]):
        return client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={
            "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
            "panels": panels, "slots": [], "internal_links": [],
        })

    original = panel()
    removed = panel(key="panel-b", number=2, name="Panel B", x=100)
    added = next_version([original, removed])
    assert added.status_code == 201
    deleted = next_version([original])
    assert deleted.status_code == 201
    detail = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{deleted.json()['version_ref']['entity_id']}")
    assert detail.json()["next_panel_number"] == 3

    resurrected = next_version([original, removed])
    assert resurrected.status_code == 422, resurrected.text
    reused_number = next_version([original, panel(key="panel-c", number=2, name="Panel C", x=100)])
    assert reused_number.status_code == 422, reused_number.text

    next_panel = panel(key="panel-c", number=3, name="Panel C", x=100)
    assert next_version([original, next_panel]).status_code == 201
    skipped_number = next_version([original, next_panel, panel(key="panel-e", number=5)])
    assert skipped_number.status_code == 201, skipped_number.text
    assert next_version([original, next_panel, panel(key="panel-d", number=4), panel(key="panel-e", number=5)]).status_code == 422
    detail = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{skipped_number.json()['version_ref']['entity_id']}")
    assert detail.json()["next_panel_number"] == 6
