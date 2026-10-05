"""Targeted direct-slot Blueprint API and materialization contracts."""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.main import app
from app.models import BuiltInEndpointDefinition, BuiltInEndpointMapping, EntityMetadata, InterfacePhysicalBinding

client = TestClient(app, raise_server_exceptions=False)


def panel(key: str = "panel-1", number: int = 1, name: str = "Панель 1", x: float = 0, y: float = 0, width: float = 100, height: float = 40) -> dict:
    return {"panel_key": key, "panel_number": number, "display_name": name, "x": x, "y": y, "width": width, "height": height}


def slot(key: str, kind: str = "CONNECTION_POINT", panel_key: str = "panel-1", x: float = .2, y: float = .3, name: str | None = None) -> dict:
    return {"key": key, "display_name": name or key, "kind": kind, "panel_key": panel_key, "rendered_position": {"x": x, "y": y}}


def create_blueprint(slots: list[dict], links: list[dict] | None = None, *, name: str = "Blueprint", body: dict | None = None, **_: object) -> tuple[str, str]:
    dimensions = body or {"kind": "RECTANGLE", "width": 100, "height": 40}
    response = client.post("/v1/library/base-templates", json={"name": name, "body": dimensions, "panels": [panel(width=dimensions["width"], height=dimensions["height"])], "slots": slots, "internal_links": links or []})
    assert response.status_code == 201, response.text
    return response.json()["blueprint_ref"]["entity_id"], response.json()["version_ref"]["entity_id"]


def instantiate(template_id: str, version_id: str, name: str = "Object") -> dict:
    response = client.post("/v1/topology/physical-objects", json={"base_template_id": template_id, "display_name": name})
    assert response.status_code == 201, response.text
    return response.json()


def test_direct_slots_snapshot_and_materialization():
    slots = [slot("opaque-a", x=.77, y=.61, name="second point"), slot("opaque-b", "NETWORK_PORT", name="eth-custom")]
    template_id, version_id = create_blueprint(slots, [{"from_slot_key": "opaque-a", "to_slot_key": "opaque-b"}])
    detail = client.get(f"/v1/library/base-templates/{template_id}/versions/{version_id}")
    assert detail.status_code == 200, detail.text
    assert sorted(detail.json()["slots"], key=lambda item: item["key"]) == slots
    assert detail.json()["panels"] == [panel()]
    assert detail.json()["next_panel_number"] == 2
    assert "composition" not in detail.json()
    assert detail.json()["internal_links"] == [{"from_slot_key": "opaque-a", "to_slot_key": "opaque-b"}]
    created = instantiate(template_id, version_id)
    assert len(created["slots"]) == 2
    assert len([item for item in created["slots"] if item.get("network_interface_ref") is not None]) == 1
    with SessionLocal() as session:
        mappings = session.scalars(select(BuiltInEndpointMapping)).all()
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
        response = client.post("/v1/library/base-templates", json=payload)
        assert response.status_code == 422, response.text
    assert client.get("/v1/library/port-blocks").status_code == 404


def test_initial_authoring_can_save_adjacent_panels_and_local_slots():
    response = client.post("/v1/library/base-templates", json={
        "name": "Two panels", "body": {"kind": "RECTANGLE", "width": 200, "height": 40},
        "panels": [panel(), panel(key="panel-2", number=2, name="Rear", x=100)],
        "slots": [slot("first"), slot("second", panel_key="panel-2", x=.8, y=.7)],
        "internal_links": [{"from_slot_key": "first", "to_slot_key": "second"}],
    })
    assert response.status_code == 201, response.text
    detail = client.get(f"/v1/library/base-templates/{response.json()['blueprint_ref']['entity_id']}/versions/{response.json()['version_ref']['entity_id']}")
    assert detail.status_code == 200
    assert detail.json()["next_panel_number"] == 3
    assert detail.json()["panels"][1]["display_name"] == "Rear"
    assert detail.json()["slots"][1]["rendered_position"] == {"x": .8, "y": .7}




def test_slot_cannot_reference_a_panel_from_another_blueprint_version():
    template_id, first_id = create_blueprint([])
    response = client.post("/v1/library/base-templates", json={"name": "other", "body": {"kind": "RECTANGLE", "width": 100, "height": 40}, "panels": [panel(key="other-panel")], "slots": [], "internal_links": []})
    assert response.status_code == 201
    second_id = response.json()["version_ref"]["entity_id"]
    with pytest.raises(IntegrityError), SessionLocal.begin() as session:
        session.execute(insert(BuiltInEndpointDefinition).values(
            id=uuid.uuid4(), base_revision_id=uuid.UUID(second_id),
            slot_key="foreign-panel", display_name="Foreign", kind="CONNECTION_POINT",
            panel_key="panel-1", position_x=.5, position_y=.5,
        ))
    assert first_id != second_id
