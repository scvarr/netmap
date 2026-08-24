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
from app.repository import CanonicalRepository, ConnectionMemberInput


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


def test_operational_details_expose_blueprint_ports_internal_pairs_and_no_manual_provenance():
    blueprint_id, version_id = create_blueprint(
        [slot("A01", "NETWORK_PORT"), slot("B01")],
        [{"from_slot_key": "A01", "to_slot_key": "B01"}],
    )
    created = instantiate(blueprint_id, version_id, "Panel")
    details = client.get(f"/v1/topology/physical-objects/{created['physical_object_ref']['entity_id']}").json()
    assert details["blueprint_provenance"] == {
        "blueprint_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "ObjectBlueprint", "entity_id": blueprint_id},
        "version_ref": {"ref_type": "LIBRARY_RECORD", "entity_type": "ObjectBlueprintVersion", "entity_id": version_id},
        "version_number": 1,
    }
    ports = {port["blueprint_slot"]["slot_key"]: port for port in details["connection_points"]}
    assert list(port["ordering_key"] for port in details["connection_points"]) == ["A01", "B01"]
    assert ports["A01"]["blueprint_slot"]["kind"] == "NETWORK_PORT"
    assert ports["A01"]["direct_interface_bindings"][0]["label"] == "A01"
    assert ports["A01"]["internal_physical_counterparts"][0]["label"] == "B01"
    manual = client.post("/v1/topology/physical-objects", json={"display_name": "Manual", "initial_connection_point": {"display_name": "M1"}}).json()
    assert "blueprint_provenance" not in manual


def test_operational_details_resolve_only_recognised_simple_cables():
    with SessionLocal.begin() as session:
        repository, catalog = CanonicalRepository(session), None
        from app.device_catalog import DeviceCatalog
        catalog = DeviceCatalog(session)
        source = catalog.create_physical_object("Source", "S1")
        remote = catalog.create_physical_object("Remote", "R1")
        cable = catalog.create_physical_object("Cable-1", "C1")
        catalog.set_physical_object_class(cable.physical_object_id, "cable")
        cable_second = catalog.create_connection_point(cable.physical_object_id, "C2")
        first, _ = repository.add_connection(source.connection_point_id, cable.connection_point_id, 1, [ConnectionMemberInput(1, 1, 1)])
        second, _ = repository.add_connection(cable_second.connection_point_id, remote.connection_point_id, 1, [ConnectionMemberInput(1, 1, 1)])
    port = client.get(f"/v1/topology/physical-objects/{source.physical_object_id}").json()["connection_points"][0]
    attachment = port["external_physical_attachments"][0]
    assert attachment["kind"] == "SIMPLE_CABLE" and attachment["cable_label"] == "Cable-1"
    assert attachment["remote_physical_object_label"] == "Remote" and attachment["remote_connection_point_label"] == "R1"
    assert first.id and second.id


def test_operational_details_do_not_guess_through_non_simple_cable_topology():
    with SessionLocal.begin() as session:
        from app.device_catalog import DeviceCatalog
        repository, catalog = CanonicalRepository(session), DeviceCatalog(session)
        source = catalog.create_physical_object("Source", "S1")
        cable = catalog.create_physical_object("Cable", "C1")
        catalog.set_physical_object_class(cable.physical_object_id, "cable")
        catalog.create_connection_point(cable.physical_object_id, "C2")
        catalog.create_connection_point(cable.physical_object_id, "C3")
        repository.add_connection(source.connection_point_id, cable.connection_point_id, 1, [ConnectionMemberInput(1, 1, 1)])
    attachment = client.get(f"/v1/topology/physical-objects/{source.physical_object_id}").json()["connection_points"][0]["external_physical_attachments"][0]
    assert attachment["kind"] == "UNRESOLVED"
    assert "cable_ref" not in attachment and attachment["remote_physical_object_label"] == "Cable"


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


def test_blueprint_library_list_is_stable_and_version_detail_is_exact_without_canonical_rows():
    cable_id, cable_version = create_blueprint(
        [slot("A"), slot("B")], [{"from_slot_key": "A", "to_slot_key": "B"}],
        name="Z Cable", body={"kind": "RECTANGLE", "width": 120, "height": 6, "fill_color": "#123456"},
        default_physical_object_class="cable",
    )
    panel_id, panel_version = create_blueprint(
        [slot("front01"), slot("rear01")], [{"from_slot_key": "front01", "to_slot_key": "rear01"}],
        name="A Panel",
    )
    response = client.get("/v1/library/object-blueprints")
    assert response.status_code == 200
    document = response.json()
    assert [item["name"] for item in document["blueprints"]] == ["A Panel", "Z Cable"]
    assert all(item["blueprint_ref"]["ref_type"] == "LIBRARY_RECORD" for item in document["blueprints"])
    assert all(item["version_ref"]["ref_type"] == "LIBRARY_RECORD" for item in document["blueprints"])
    cable = next(item for item in document["blueprints"] if item["blueprint_ref"]["entity_id"] == cable_id)
    assert cable["version_ref"]["entity_id"] == cable_version
    assert cable["slot_count"] == 2 and cable["internal_link_count"] == 1
    detail = client.get(f"/v1/library/object-blueprints/{panel_id}/versions/{panel_version}")
    assert detail.status_code == 200
    assert detail.json()["body"] == {"kind": "RECTANGLE", "width": 100.0, "height": 40.0, "fill_color": None}
    assert detail.json()["slots"] == [
        {"key": "front01", "display_name": "front01", "kind": "CONNECTION_POINT", "anchor": {"side": "LEFT", "offset": 0.5}},
        {"key": "rear01", "display_name": "rear01", "kind": "CONNECTION_POINT", "anchor": {"side": "LEFT", "offset": 0.5}},
    ]
    assert detail.json()["internal_links"] == [{"from_slot_key": "front01", "to_slot_key": "rear01"}]
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PhysicalObject)) == 0
        assert session.scalar(select(func.count()).select_from(ConnectionPoint)) == 0


def test_blueprint_library_read_rejects_missing_or_mismatched_version():
    blueprint_id, version_id = create_blueprint([slot("A")])
    assert client.get(
        f"/v1/library/object-blueprints/00000000-0000-0000-0000-000000000001/versions/{version_id}"
    ).status_code == 422


def version_snapshot(left: str, right: str) -> dict:
    recipe = {
        "endpoint_groups": [
            {"group_id": "left", "key_prefix": left, "display_prefix": left, "kind": "CONNECTION_POINT", "side": "LEFT", "count": 1, "starting_number": 1},
            {"group_id": "right", "key_prefix": right, "display_prefix": right, "kind": "CONNECTION_POINT", "side": "RIGHT", "count": 1, "starting_number": 1},
        ],
        "pair_recipes": [{"group_a_id": "left", "group_b_id": "right"}],
    }
    return {
        "default_physical_object_class": "cable",
        "body": {"kind": "RECTANGLE", "width": 120, "height": 6, "fill_color": "#123456"},
        "slots": [
            {"key": f"{left}01", "display_name": f"{left}01", "kind": "CONNECTION_POINT", "anchor": {"side": "LEFT", "offset": .5}},
            {"key": f"{right}01", "display_name": f"{right}01", "kind": "CONNECTION_POINT", "anchor": {"side": "RIGHT", "offset": .5}},
        ],
        "internal_links": [{"from_slot_key": f"{left}01", "to_slot_key": f"{right}01"}],
        "authoring_recipe": recipe,
    }


def test_blueprint_versions_are_immutable_latest_is_listed_and_recipe_round_trips():
    first = version_snapshot("A", "B")
    response = client.post("/v1/library/object-blueprints", json={"name": "Versioned cable", **first})
    assert response.status_code == 201
    blueprint_id, v1_id = response.json()["blueprint_ref"]["entity_id"], response.json()["version_ref"]["entity_id"]
    second = version_snapshot("C", "D")
    v2 = client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json=second)
    assert v2.status_code == 201
    v2_id = v2.json()["version_ref"]["entity_id"]
    first_detail = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{v1_id}").json()
    second_detail = client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{v2_id}").json()
    assert first_detail["version_number"] == 1 and [slot["key"] for slot in first_detail["slots"]] == ["A01", "B01"]
    assert first_detail["authoring_recipe"] == first["authoring_recipe"]
    assert second_detail["version_number"] == 2 and [slot["key"] for slot in second_detail["slots"]] == ["C01", "D01"]
    listing = client.get("/v1/library/object-blueprints").json()["blueprints"]
    item = next(item for item in listing if item["blueprint_ref"]["entity_id"] == blueprint_id)
    assert item["version_ref"]["entity_id"] == v2_id and item["version_count"] == 2
    old_instance = instantiate(blueprint_id, v1_id, "old cable")
    new_instance = instantiate(blueprint_id, v2_id, "new cable")
    assert old_instance["slots"][0]["slot_key"] == "A01"
    assert new_instance["slots"][0]["slot_key"] == "C01"


def test_blueprint_version_creation_is_atomic_and_delete_is_safe():
    blueprint_id, version_id = create_blueprint([slot("A")], name="Disposable")
    invalid = version_snapshot("C", "D")
    invalid["slots"] = invalid["slots"][:1]
    assert client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json=invalid).status_code == 422
    assert client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}").status_code == 200
    assert client.delete(f"/v1/library/object-blueprints/{blueprint_id}").status_code == 204
    assert client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{version_id}").status_code == 422
    protected_id, protected_version = create_blueprint([slot("P")], name="Protected")
    instance = instantiate(protected_id, protected_version, "materialized")
    assert client.delete(f"/v1/library/object-blueprints/{protected_id}").status_code == 409
    assert client.get(f"/v1/library/object-blueprints/{protected_id}/versions/{protected_version}").status_code == 200
    with SessionLocal() as session:
        assert session.get(PhysicalObject, uuid.UUID(instance["physical_object_ref"]["entity_id"])) is not None
    assert client.get(
        f"/v1/library/object-blueprints/{blueprint_id}/versions/00000000-0000-0000-0000-000000000002"
    ).status_code == 422


def test_next_version_can_rename_atomically_without_mutating_v1():
    first = version_snapshot("A", "B")
    created = client.post("/v1/library/object-blueprints", json={"name": "Original", **first})
    blueprint_id = created.json()["blueprint_ref"]["entity_id"]
    v1_id = created.json()["version_ref"]["entity_id"]
    second = version_snapshot("C", "D")
    response = client.post(
        f"/v1/library/object-blueprints/{blueprint_id}/versions",
        json={"blueprint_name": "Renamed", **second},
    )
    assert response.status_code == 201
    v2_id = response.json()["version_ref"]["entity_id"]
    assert client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{v1_id}").json()["slots"][0]["key"] == "A01"
    assert client.get(f"/v1/library/object-blueprints/{blueprint_id}/versions/{v2_id}").json()["name"] == "Renamed"
    invalid = version_snapshot("E", "F"); invalid["slots"] = invalid["slots"][:1]
    assert client.post(f"/v1/library/object-blueprints/{blueprint_id}/versions", json={"blueprint_name": "Should not persist", **invalid}).status_code == 422
    listing = client.get("/v1/library/object-blueprints").json()["blueprints"]
    item = next(item for item in listing if item["blueprint_ref"]["entity_id"] == blueprint_id)
    assert item["name"] == "Renamed" and item["version_count"] == 2
