import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.blueprint_catalog import ObjectBlueprintCatalog
from app.database import SessionLocal
from app.main import app
from app.models import BlueprintEndpointSlot, BlueprintInstance, ConnectionPoint, InterfacePhysicalBinding, NetworkInterface, ObjectBlueprint, ObjectBlueprintVersion


client = TestClient(app)
composed_slot_key = ObjectBlueprintCatalog.composed_slot_key


def slot(local_id: str, kind: str = "CONNECTION_POINT") -> dict:
    return {"local_id": local_id, "display_label": local_id, "kind": kind, "row": 1, "column": 1, "layout_order": 1}


def create_port_block(ports: list[dict], name: str = "Port Block") -> tuple[str, str]:
    normalized = [{**item, "column": index + 1, "layout_order": index + 1} for index, item in enumerate(ports)]
    response = client.post("/v1/library/port-blocks", json={"name": name, "ports": normalized})
    assert response.status_code == 201, response.text
    body = response.json()
    return body["port_block_ref"]["entity_id"], body["version_ref"]["entity_id"]


def create_blueprint(slots: list[dict], links: list[dict] | None = None, *, instance_key: str = "instance", name: str = "Blueprint", port_block: tuple[str, str] | None = None, **extra: object) -> tuple[str, str]:
    port_block_id, port_block_version_id = port_block or create_port_block(slots, f"{name} ports")
    generated = {item["local_id"]: composed_slot_key(instance_key, item["local_id"]) for item in slots}
    response = client.post("/v1/library/object-blueprints", json={
        "name": name,
        "body": extra.pop("body", {"kind": "RECTANGLE", "width": 100, "height": 40}),
        "default_physical_object_class": extra.pop("default_physical_object_class", None),
        "composition": {"instances": [{"instance_key": instance_key, "port_block_version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": port_block_version_id}}]},
        "internal_links": [{"from_slot_key": generated[item["from_slot_key"]], "to_slot_key": generated[item["to_slot_key"]]} for item in (links or [])],
        **extra,
    })
    assert response.status_code == 201, response.text
    body = response.json()
    return body["blueprint_ref"]["entity_id"], body["version_ref"]["entity_id"]


def instantiate(blueprint_id: str, version_id: str, display_name: str) -> dict:
    response = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}/instantiate", json={"display_name": display_name})
    assert response.status_code == 201, response.text
    return response.json()


def test_composition_expands_exact_ports_and_reads_provenance():
    block_id, block_version_id = create_port_block([slot("p1"), slot("p2", "NETWORK_PORT")], "Panel")
    blueprint_id, version_id = create_blueprint([slot("p1"), slot("p2", "NETWORK_PORT")], instance_key="K", port_block=(block_id, block_version_id))
    detail = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert [item["key"] for item in body["slots"]] == [composed_slot_key("K", "p1"), composed_slot_key("K", "p2")]
    assert [item["display_name"] for item in body["slots"]] == ["p1", "p2"]
    assert body["composition"] == {"instances": [{"instance_key": "K", "port_block_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlock", "entity_id": block_id}, "port_block_version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": block_version_id}}]}
    with SessionLocal() as session:
        slots = tuple(session.scalars(select(BlueprintEndpointSlot).where(BlueprintEndpointSlot.blueprint_version_id == uuid.UUID(version_id))))
    assert {(item.port_block_instance_id is not None, item.port_block_local_id) for item in slots} == {(True, "p1"), (True, "p2")}


def test_empty_composition_is_authored_and_not_read_as_historical_snapshot():
    payload = {
        "name": "Empty composition",
        "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "composition": {"instances": []},
        "internal_links": [],
    }
    created = client.post("/v1/library/object-blueprints", json=payload)
    assert created.status_code == 201, created.text
    blueprint_id = created.json()["blueprint_ref"]["entity_id"]
    version_id = created.json()["version_ref"]["entity_id"]
    detail = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}")
    assert detail.status_code == 200
    assert detail.json()["composition"] == {"instances": []}


def test_next_version_can_replace_composition_with_empty_composition():
    blueprint_id, _ = create_blueprint([slot("p1")])
    response = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={
        "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "composition": {"instances": []},
        "internal_links": [],
    })
    assert response.status_code == 201, response.text
    version_id = response.json()["version_ref"]["entity_id"]
    detail = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}")
    assert detail.status_code == 200
    assert detail.json()["composition"] == {"instances": []}


def test_same_exact_block_twice_has_distinct_final_slots_and_duplicate_instance_key_is_rejected():
    block_id, version_id = create_port_block([slot("p1")])
    ref = {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": version_id}
    payload = {"name": "Twice", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "composition": {"instances": [{"instance_key": "left", "port_block_version_ref": ref}, {"instance_key": "right", "port_block_version_ref": ref}]}, "internal_links": []}
    created = client.post("/v1/library/object-blueprints", json=payload)
    assert created.status_code == 201
    detail = client.get(f"/v1/library/object-blueprints/{created.json()['blueprint_ref']['entity_id']}/versions/{created.json()['version_ref']['entity_id']}").json()
    assert {item["key"] for item in detail["slots"]} == {composed_slot_key("left", "p1"), composed_slot_key("right", "p1")}
    duplicate = client.post("/v1/library/object-blueprints", json={**payload, "composition": {"instances": [{"instance_key": "same", "port_block_version_ref": ref}, {"instance_key": "same", "port_block_version_ref": ref}]}})
    assert duplicate.status_code == 422


def test_exact_version_reference_validation_and_compact_version_list():
    block_id, version_id = create_port_block([slot("p1")])
    versions = client.get(f"/v1/library/port-blocks/{block_id}/versions")
    assert versions.status_code == 200 and versions.json()["versions"] == [{"port_block_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlock", "entity_id": block_id}, "version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": version_id}, "version_number": 1, "port_count": 1}]
    base = {"name": "Invalid", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "internal_links": []}
    wrong_kind = client.post("/v1/library/object-blueprints", json={**base, "composition": {"instances": [{"instance_key": "one", "port_block_version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlock", "entity_id": block_id}}]}})
    missing = client.post("/v1/library/object-blueprints", json={**base, "composition": {"instances": [{"instance_key": "one", "port_block_version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": "00000000-0000-0000-0000-000000000001"}}]}})
    assert wrong_kind.status_code == 422 and missing.status_code == 422


def test_explicit_cross_block_links_reject_self_missing_and_unordered_duplicates():
    block_id, block_version_id = create_port_block([slot("p1")])
    ref = {"ref_type": "LIBRARY_RECORD", "entity_type": "PortBlockVersion", "entity_id": block_version_id}
    left, right = composed_slot_key("left", "p1"), composed_slot_key("right", "p1")
    base = {"name": "Links", "body": {"kind": "RECTANGLE", "width": 1, "height": 1}, "composition": {"instances": [{"instance_key": "left", "port_block_version_ref": ref}, {"instance_key": "right", "port_block_version_ref": ref}]}}
    assert client.post("/v1/library/object-blueprints", json={**base, "internal_links": [{"from_slot_key": left, "to_slot_key": right}]}).status_code == 201
    for links in ([{"from_slot_key": left, "to_slot_key": left}], [{"from_slot_key": left, "to_slot_key": "missing"}], [{"from_slot_key": left, "to_slot_key": right}, {"from_slot_key": right, "to_slot_key": left}]):
        assert client.post("/v1/library/object-blueprints", json={**base, "internal_links": links}).status_code == 422


def test_composed_materialization_creates_expected_canonical_rows_and_delete_preserves_port_block():
    block_id, block_version_id = create_port_block([slot("cp"), slot("ni", "NETWORK_PORT")])
    blueprint_id, version_id = create_blueprint([slot("cp"), slot("ni", "NETWORK_PORT")], port_block=(block_id, block_version_id), name="Materialized")
    instance = instantiate(blueprint_id, version_id, "object")
    assert len(instance["slots"]) == 2
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(ConnectionPoint)) >= 2
        assert session.scalar(select(func.count()).select_from(NetworkInterface)) >= 1
        assert session.scalar(select(func.count()).select_from(InterfacePhysicalBinding)) >= 1
    assert client.delete(f"/v1/library/object-blueprints/{blueprint_id}").status_code == 409
    disposable_id, disposable_version = create_blueprint([slot("only")], port_block=create_port_block([slot("only")]), name="Disposable")
    assert client.delete(f"/v1/library/object-blueprints/{disposable_id}").status_code == 204
    assert client.get(f"/v1/library/port-blocks/{block_id}/versions/{block_version_id}").status_code == 200
    assert client.get(f"/v1/library/object-blueprints/{disposable_id}/versions/{disposable_version}").status_code == 422


def test_historical_snapshot_without_composition_remains_readable_and_instantiable():
    blueprint_id, version_id, slot_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with SessionLocal.begin() as session:
        session.add(ObjectBlueprint(id=blueprint_id, name="Historical"))
        session.add(ObjectBlueprintVersion(id=version_id, blueprint_id=blueprint_id, version_number=1, body_kind="RECTANGLE", width=1, height=1))
        session.flush()
        session.add(BlueprintEndpointSlot(id=slot_id, blueprint_version_id=version_id, slot_key="legacy", display_name="Legacy", kind="CONNECTION_POINT", anchor_side="LEFT", anchor_offset=.5))
    detail = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}")
    assert detail.status_code == 200 and detail.json()["composition"] is None
    assert instantiate(str(blueprint_id), str(version_id), "historical")["slots"][0]["slot_key"] == "legacy"
