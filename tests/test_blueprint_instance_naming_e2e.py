"""C-CAP-02A: exact Port Block structure with Blueprint-local endpoint names."""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.blueprint_catalog import ObjectBlueprintCatalog
from app.database import SessionLocal
from app.main import app
from app.models import BlueprintPortBlockInstance, EntityMetadata

client = TestClient(app)
placement = {"x": .1, "y": .1, "width": .4, "height": .4}


def block(rows=1, kind="NETWORK_PORT"):
    ports = [{"local_id": f"p{order}", "kind": kind, "row": row, "column": index + 1, "layout_order": order}
             for order, (row, index) in enumerate(((row, index) for row in range(1, rows + 1) for index in range(2)), 1)]
    created = client.post("/v1/library/port-blocks", json={"name": "Reusable pair", "ports": ports})
    assert created.status_code == 201, created.text
    return created.json()["port_block_ref"]["entity_id"], created.json()["version_ref"]["entity_id"]


def naming(prefix, start, mode="SINGLE", overrides=None):
    return {"prefix": prefix, "starting_number": start, "mode": mode, "overrides": overrides or {}}


def blueprint(block_version, instances, name="Device"):
    created = client.post("/v1/library/object-blueprints", json={"name": name, "body": {"kind": "RECTANGLE", "width": 100, "height": 40}, "composition": {"instances": [{"instance_key": key, "port_block_version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": block_version}, "face": "FRONT", "placement": placement, "naming": recipe} for key, recipe in instances]}, "internal_links": []})
    assert created.status_code == 201, created.text
    return created.json()["blueprint_ref"]["entity_id"], created.json()["version_ref"]["entity_id"]


def detail(blueprint_id, version_id):
    response = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}")
    assert response.status_code == 200, response.text
    return response.json()


def test_exact_block_reused_across_blueprints_and_instances_with_independent_names():
    block_id, version = block()
    a_id, a_version = blueprint(version, [("data-a", naming("Ge1/0/", 1)), ("storage-a", naming("fc", 0))], "HV-A")
    b_id, b_version = blueprint(version, [("data-a", naming("Ethernet", 11, overrides={"p2": "MGMT-A"}))], "HV-B")
    assert {slot["display_name"] for slot in detail(a_id, a_version)["slots"]} == {"Ge1/0/1", "Ge1/0/2", "fc0", "fc1"}
    b = detail(b_id, b_version)
    assert {slot["display_name"] for slot in b["slots"]} == {"Ethernet11", "MGMT-A"}
    assert b["composition"]["instances"][0]["naming"] == naming("Ethernet", 11, overrides={"p2": "MGMT-A"})
    assert {slot["key"] for slot in b["slots"]} == {ObjectBlueprintCatalog.composed_slot_key("data-a", local) for local in ("p1", "p2")}
    assert client.get(f"/v1/library/port-blocks/{block_id}/versions/{version}").json()["ports"] == [{"local_id": f"p{i}", "kind": "NETWORK_PORT", "row": 1, "column": i, "layout_order": i} for i in (1, 2)]
    with SessionLocal() as session:
        rows = tuple(session.scalars(select(BlueprintPortBlockInstance).where(BlueprintPortBlockInstance.blueprint_version_id == uuid.UUID(b_version))))
        assert len(rows) == 1 and rows[0].naming_prefix == "Ethernet" and rows[0].naming_overrides == {"p2": "MGMT-A"}


@pytest.mark.parametrize("mode,expected", [
    ("SEQUENTIAL", ["X1", "X2", "X3", "X4"]),
    ("ODD_EVEN", ["X1", "X3", "X2", "X4"]),
    ("EVEN_ODD", ["X2", "X4", "X1", "X3"]),
])
def test_two_row_modes(mode, expected):
    _, version = block(rows=2)
    blueprint_id, blueprint_version = blueprint(version, [("ports", naming("X", 1, mode))])
    slots = detail(blueprint_id, blueprint_version)["slots"]
    by_local = {slot["key"]: slot["display_name"] for slot in slots}
    assert [by_local[ObjectBlueprintCatalog.composed_slot_key("ports", f"p{i}")] for i in range(1, 5)] == expected


def test_next_blueprint_version_keeps_provenance_and_prior_snapshot_immutable_and_materializes_aliases():
    _, version = block()
    blueprint_id, old_version = blueprint(version, [("ports", naming("fc", 0))])
    old = detail(blueprint_id, old_version)
    existing = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions/{old_version}/instantiate", json={"display_name": "Existing"})
    assert existing.status_code == 201, existing.text
    recipe = old["composition"]["instances"][0]["naming"]
    assert recipe == naming("fc", 0)
    next_recipe = {**recipe, "prefix": "Ge", "overrides": {"p2": "MGMT-A"}}
    created = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={"body": {"kind": "RECTANGLE", "width": 100, "height": 40}, "composition": {"instances": [{"instance_key": "ports", "port_block_version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": version}, "face": "FRONT", "placement": placement, "naming": next_recipe}]}, "internal_links": []})
    assert created.status_code == 201, created.text
    newer = detail(blueprint_id, created.json()["version_ref"]["entity_id"])
    assert detail(blueprint_id, old_version) == old
    assert {slot["key"] for slot in newer["slots"]} == {slot["key"] for slot in old["slots"]}
    assert {slot["display_name"] for slot in newer["slots"]} == {"Ge0", "MGMT-A"}
    with SessionLocal() as session:
        existing_aliases = {session.scalar(select(EntityMetadata.value).where(EntityMetadata.connection_point_id == uuid.UUID(slot["connection_point_ref"]["entity_id"]), EntityMetadata.key == "alias.display")) for slot in existing.json()["slots"]}
    assert existing_aliases == {"fc0", "fc1"}
    materialized = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions/{created.json()['version_ref']['entity_id']}/instantiate", json={"display_name": "HV"})
    assert materialized.status_code == 201, materialized.text
    with SessionLocal() as session:
        for slot in materialized.json()["slots"]:
            expected = next(item["display_name"] for item in newer["slots"] if item["key"] == slot["slot_key"])
            point_id = uuid.UUID(slot["connection_point_ref"]["entity_id"])
            interface_id = uuid.UUID(slot["network_interface_ref"]["entity_id"])
            assert session.scalar(select(EntityMetadata.value).where(EntityMetadata.connection_point_id == point_id, EntityMetadata.key == "alias.display")) == expected
            assert session.scalar(select(EntityMetadata.value).where(EntityMetadata.network_interface_id == interface_id, EntityMetadata.key == "alias.display")) == expected
