import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import BlueprintPortBlockInstance, PortBlock, PortBlockPort, PortBlockVersion


client = TestClient(app)


def port(local_id: str, label: str, row: int, column: int, order: int, kind: str = "NETWORK_PORT") -> dict:
    return {
        "local_id": local_id,
        "display_label": label,
        "kind": kind,
        "row": row,
        "column": column,
        "layout_order": order,
    }


def create_block(name: str = "48 x RJ45", ports: list[dict] | None = None) -> tuple[str, str]:
    response = client.post("/v1/library/port-blocks", json={
        "name": name,
        "ports": ports or [port("p1", "1", 1, 1, 1), port("p2", "2", 1, 2, 2)],
    })
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["port_block_ref"] == {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlock", "entity_id": body["port_block_ref"]["entity_id"]}
    return body["port_block_ref"]["entity_id"], body["version_ref"]["entity_id"]


def test_port_block_creates_exact_immutable_layout_snapshot_and_lists_latest_version():
    block_id, version_id = create_block(ports=[
        port("p2", "48", 2, 24, 2),
        port("p1", "1", 1, 1, 1, "CONNECTION_POINT"),
    ])
    detail = client.get(f"/v1/library/port-blocks/{block_id}/versions/{version_id}")
    assert detail.status_code == 200
    assert detail.json()["ports"] == [
        port("p1", "1", 1, 1, 1, "CONNECTION_POINT"),
        port("p2", "48", 2, 24, 2),
    ]
    listing = client.get("/v1/library/port-blocks")
    assert listing.status_code == 200
    assert listing.json()["port_blocks"] == [{
        "port_block_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlock", "entity_id": block_id},
        "name": "48 x RJ45",
        "version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": version_id},
        "version_number": 1,
        "port_count": 2,
        "version_count": 1,
    }]
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PortBlock)) == 1
        assert session.scalar(select(func.count()).select_from(PortBlockVersion)) == 1
        assert session.scalar(select(func.count()).select_from(PortBlockPort)) == 2


def test_port_block_next_version_preserves_prior_snapshot_and_local_identity_is_not_presentation_derived():
    block_id, v1 = create_block(ports=[port("p1", "01", 1, 1, 1), port("p2", "02", 1, 2, 2)])
    response = client.post(f"/v1/library/port-blocks/{block_id}/versions", json={
        "port_block_name": "24 x SFP+",
        "ports": [port("p2", "uplink-B", 2, 1, 2), port("p1", "uplink-A", 1, 8, 1)],
    })
    assert response.status_code == 201, response.text
    v2 = response.json()["version_ref"]["entity_id"]
    assert v1 != v2
    assert client.get(f"/v1/library/port-blocks/{block_id}/versions/{v1}").json()["ports"] == [
        port("p1", "01", 1, 1, 1), port("p2", "02", 1, 2, 2),
    ]
    assert client.get(f"/v1/library/port-blocks/{block_id}/versions/{v2}").json()["ports"] == [
        port("p1", "uplink-A", 1, 8, 1), port("p2", "uplink-B", 2, 1, 2),
    ]
    latest = client.get("/v1/library/port-blocks").json()["port_blocks"][0]
    assert latest["name"] == "24 x SFP+" and latest["version_number"] == 2 and latest["version_count"] == 2


@pytest.mark.parametrize("ports", [
    [],
    [port("p1", "1", 1, 1, 1), port("p1", "2", 1, 2, 2)],
    [port("p1", "1", 1, 1, 1), port("p2", "2", 1, 1, 2)],
    [port("p1", "1", 1, 1, 1), port("p2", "2", 1, 2, 1)],
    [port("p1", "1", 1, 1, 1), port("p2", "2", 1, 2, 3)],
    [port("p1", "1", 2, 1, 1)],
    [port("p1", "1", 3, 1, 1)],
])
def test_port_block_validation_rejects_invalid_snapshot_without_writes(ports: list[dict]):
    response = client.post("/v1/library/port-blocks", json={"name": "invalid", "ports": ports})
    assert response.status_code == 422
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PortBlock)) == 0
        assert session.scalar(select(func.count()).select_from(PortBlockVersion)) == 0
        assert session.scalar(select(func.count()).select_from(PortBlockPort)) == 0


def test_port_block_version_read_rejects_missing_and_mismatched_parent():
    first_id, version_id = create_block()
    second_id, _ = create_block(name="other")
    assert client.get(f"/v1/library/port-blocks/{first_id}/versions/{uuid.uuid4()}").status_code == 422
    assert client.get(f"/v1/library/port-blocks/{second_id}/versions/{version_id}").status_code == 422


def test_port_block_delete_removes_all_versions_and_ports_but_rejects_blueprint_provenance():
    block_id, first_version_id = create_block()
    next_version = client.post(f"/v1/library/port-blocks/{block_id}/versions", json={
        "ports": [port("p3", "3", 1, 1, 1)],
    })
    assert next_version.status_code == 201, next_version.text
    assert client.delete(f"/v1/library/port-blocks/{block_id}").status_code == 204
    assert client.get(f"/v1/library/port-blocks/{block_id}/versions/{first_version_id}").status_code == 422
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PortBlock)) == 0
        assert session.scalar(select(func.count()).select_from(PortBlockVersion)) == 0
        assert session.scalar(select(func.count()).select_from(PortBlockPort)) == 0

    block_id, version_id = create_block(name="Referenced")
    next_version = client.post(f"/v1/library/port-blocks/{block_id}/versions", json={
        "ports": [port("p3", "3", 1, 1, 1)],
    })
    assert next_version.status_code == 201, next_version.text
    blueprint = client.post("/v1/library/object-blueprints", json={
        "name": "Uses port module",
        "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "internal_links": [],
        "composition": {"instances": [{
            "instance_key": "module",
            "port_block_version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": version_id},
            "face": "FRONT",
            "placement": {"x": 0, "y": 0, "width": 1, "height": 1},
        }]},
    })
    assert blueprint.status_code == 201, blueprint.text
    rejected = client.delete(f"/v1/library/port-blocks/{block_id}")
    assert rejected.status_code == 409
    assert rejected.json()["error"]["details"] == {
        "reason": "PORT_BLOCK_IN_USE_BY_OBJECT_BLUEPRINT", "port_block_id": block_id,
    }
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PortBlock).where(PortBlock.id == uuid.UUID(block_id))) == 1
        assert session.scalar(select(func.count()).select_from(PortBlockVersion).where(PortBlockVersion.port_block_id == uuid.UUID(block_id))) == 2
        assert session.scalar(select(func.count()).select_from(PortBlockPort)) == 3
        assert session.scalar(select(func.count()).select_from(BlueprintPortBlockInstance)) == 1
    assert client.delete(f"/v1/library/port-blocks/{uuid.uuid4()}").status_code == 422
