import copy
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import event

from app.database import SessionLocal
from app.errors import ModelError
from app.hardware_catalog import HardwareCatalog
from app.object_reconciliation import ObjectReconciliation, reconcile_objects
from app.schemas import InstallModuleRequest
from tests.module_port_type_fixtures import ensure_module_bay_type_id, ensure_module_port_type_id
from tests.test_base_template_review import assert_structure_rejected, open_draft, save
from tests.test_hardware_configuration import base_payload, client, create_base, create_module, create_object
from tests.test_nested_module_installations import created, install, module, read
from tests.test_object_reconciliation import connect, endpoint, oid, package, reconcile, revision


def setup_base(*, second_endpoint=False):
    payload = base_payload()
    socket = payload["bays"][0]
    socket.update(bay_key="retained", hardware_interface_key=str(uuid.uuid4()), x=.2, width=.1)
    for key, x in (("free-1", .4), ("free-2", .6), ("keep-occupied", .8)):
        payload["bays"].append({**socket, "bay_key": key, "display_name": key, "x": x,
                                "hardware_interface_key": None})
    payload["bays"].append({"bay_key": "board", "display_name": "Board", "kind": "LOGICAL",
                            "panel_key": socket["panel_key"], "mount_kind": "MODULE_BAY",
                            "module_bay_type_id": ensure_module_bay_type_id("PCIe x16")})
    if second_endpoint:
        payload["slots"].append({**payload["slots"][0], "key": "second"})
    return create_base(payload)


def assign(definition):
    for bay in definition["bays"]:
        if bay["bay_key"].startswith("free"):
            bay["hardware_interface_key"] = str(uuid.uuid4())
    definition["name"] = "Renamed with hardware interfaces"


def test_reconcile_materializes_only_new_declarations_and_preserves_workspace():
    template, payload = setup_base()
    objects = [create_object(template) for _ in range(3)]
    touched, _, blocked = map(oid, objects)
    template_mount = {"mount_kind": "MODULE_PORT", "module_port_type_id": payload["bays"][0]["module_port_type_id"]}
    structural = module("Structural transceiver", template_mount)
    created(install(blocked, structural, "free-2"))
    created(install(touched, structural, "keep-occupied"))
    created(install(touched, create_module("PCIe x16"), "board"))
    with SessionLocal.begin() as session:
        connect(session, endpoint(objects[0])[0])
    before = package()
    target = revision(template, assign)
    assert all(read(oid(obj))["base_revision_id"] == obj["version_ref"]["entity_id"] for obj in objects)
    assert package()["canonical"] == before["canonical"]

    # Two callers contend for the same configurations and see either the old
    # configuration or the fully provisioned target.
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(reconcile, [template, template]))
    for obj in objects[:2]:
        identifier = oid(obj)
        assert {r[identifier]["status"] for r in results} == {"updated", "already_current"}
        config = read(identifier)
        assert config["base_revision_id"] == target
        assert len({bay["network_interface_id"] for bay in config["bays"] if "network_interface_id" in bay}) == 3
    for result in results:
        assert result[blocked]["status"] == "requires_intervention"
        assert "HARDWARE_INTERFACE_SOCKET_OCCUPIED" in {reason["code"] for reason in result[blocked]["reasons"]}
    assert not any("network_interface_id" in bay for bay in read(blocked)["bays"] if bay["bay_key"].startswith("free"))

    after = package()
    for entity in ("NetworkInterface", "NetworkInterfacePhysicalOwner"):
        records = after["canonical"][entity]
        assert len(records) == len(before["canonical"][entity]) + 4
        assert all(row in records for row in before["canonical"][entity])
    for entity in ("PhysicalObject", "ConnectionPoint", "InterfacePhysicalBinding", "Connection", "Cable"):
        assert after["canonical"][entity] == before["canonical"][entity]
    for entity in ("ModuleInstallation", "ModuleEndpointMapping"):
        assert after["authoring"][entity] == before["authoring"][entity]
    assert {row["id"] for row in after["authoring"]["ObjectConfiguration"]} == {
        row["id"] for row in before["authoring"]["ObjectConfiguration"]}
    assert reconcile(template)[touched]["status"] == "already_current"
    assert package() == after
    assert after["format_version"] == 15
    assert client.delete("/v1/workspace/dataset").status_code == 204
    imported = client.post("/v1/workspace/package", json=after)
    assert imported.status_code == 204, imported.text
    assert package() == after


@pytest.mark.parametrize("mutation", ["replace", "remove", "bay_key", "mount", "add", "delete", "endpoint", "link"])
def test_added_interface_cannot_authorize_other_physical_changes(mutation):
    template, _ = setup_base(second_endpoint=mutation == "link")
    draft = open_draft(template)
    definition = copy.deepcopy(draft["definition"])
    assign(definition)
    socket = next(bay for bay in definition["bays"] if bay["bay_key"] == "retained")
    if mutation == "replace":
        socket["hardware_interface_key"] = str(uuid.uuid4())
    elif mutation == "remove":
        socket.pop("hardware_interface_key")
    elif mutation == "bay_key":
        socket["bay_key"] = "new-address"
    elif mutation == "mount":
        socket["module_port_type_id"] = ensure_module_port_type_id("Other type")
    elif mutation == "add":
        definition["bays"].append({**socket, "bay_key": "extra", "hardware_interface_key": None})
    elif mutation == "delete":
        definition["bays"].pop()
    elif mutation == "endpoint":
        definition["slots"][0]["kind"] = "CONNECTION_POINT"
    else:
        definition["internal_links"].append({"from_slot_key": definition["slots"][0]["key"], "to_slot_key": "second"})
    assert_structure_rejected(template, save(template, draft, definition))


def test_stale_target_refused_and_materialization_rolls_back_on_failure(monkeypatch):
    template, _ = setup_base()
    obj = create_object(template)
    object_id = uuid.UUID(oid(obj))
    target = revision(template, assign)
    before = package()
    with pytest.raises(ModelError, match="Published revision changed"), SessionLocal.begin() as session:
        ObjectReconciliation(session).apply(uuid.UUID(template), object_id, uuid.UUID(obj["version_ref"]["entity_id"]))
    assert package() == before


    materialize = HardwareCatalog._materialize_hardware_interfaces

    def fail_after_first(catalog, config, parent_id, places, *, place_key):
        materialize(catalog, config, parent_id, places[:1], place_key=place_key)
        catalog.session.flush()
        raise RuntimeError("Interrupted after the first interface")

    monkeypatch.setattr(HardwareCatalog, "_materialize_hardware_interfaces", fail_after_first)
    with pytest.raises(RuntimeError, match="Interrupted"), SessionLocal.begin() as session:
        ObjectReconciliation(session).apply(uuid.UUID(template), object_id, uuid.UUID(target))
    assert package() == before


def test_installation_that_wins_object_lock_blocks_retrofit():
    template, payload = setup_base()
    obj = create_object(template)
    original = read(oid(obj))
    mount = {"mount_kind": "MODULE_PORT", "module_port_type_id": payload["bays"][0]["module_port_type_id"]}
    optic = module("Structural transceiver", mount)
    revision(template, assign)
    attempting_object_lock = Event()

    def before_execute(_connection, _cursor, statement, _parameters, _context, _executemany):
        if "FROM physical_objects" in statement and "FOR UPDATE" in statement:
            attempting_object_lock.set()

    with SessionLocal() as updater, SessionLocal.begin() as writer, ThreadPoolExecutor(max_workers=1) as pool:
        HardwareCatalog(writer).install_module(uuid.UUID(oid(obj)), InstallModuleRequest(
            module_template_id=uuid.UUID(optic["template_id"]), bay_key="free-2", orientation="HORIZONTAL"))

        @event.listens_for(updater, "after_begin")
        def after_begin(_session, _transaction, connection):
            event.listen(connection, "before_cursor_execute", before_execute)

        future = pool.submit(reconcile_objects, updater, uuid.UUID(template))
        assert attempting_object_lock.wait(5)
        writer.commit()
        result, = future.result(timeout=5)["objects"]
    assert result["status"] == "requires_intervention"
    assert result["reasons"][0]["code"] == "HARDWARE_INTERFACE_SOCKET_OCCUPIED"
    config = read(oid(obj))
    assert config["base_revision_id"] == original["base_revision_id"]
    assert not any("network_interface_id" in bay for bay in config["bays"] if bay["bay_key"].startswith("free"))
