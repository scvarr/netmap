import copy
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models import ModuleInstallation
from app.module_geometry import initial_geometry
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests import test_base_template_review as base_review
from tests.module_port_type_fixtures import ensure_module_port_type_id
from tests.port_type_fixtures import ensure_port_type_id
from tests.test_hardware_configuration import base_payload, client, create_base, create_object
from tests.test_module_reconciliation import apply, package, revision
from tests.test_module_uninstall import uninstall


def bay_mount(name):
    response = client.post("/v1/module-bay-types", json={"name": name})
    assert response.status_code == 201, response.text
    return {"mount_kind": "MODULE_BAY", "module_bay_type_id": response.json()["id"]}


def module(name, mount, places=(), has_endpoint=False):
    endpoints = ([{"key": "lan", "display_name": "LAN", "kind": "NETWORK_PORT",
                   "port_type_id": ensure_port_type_id()}] if has_endpoint else [])
    response = client.post("/v1/library/module-templates", json={
        "name": name, **mount, "module_places": list(places), "endpoints": endpoints,
        "geometry": initial_geometry(e["key"] for e in endpoints),
    })
    assert response.status_code == 201, response.text
    return response.json()


def place(key, mount):
    return {"key": key, "display_name": key, "x": .25, "y": .65, **mount}


def install(object_id, template, key, parent=None, orientation="HORIZONTAL"):
    return client.post(f"/v1/topology/physical-objects/{object_id}/module-installations", json={
        "module_template_id": template["template_id"], "bay_key": key,
        "parent_installation_id": parent, "orientation": orientation,
    })


def setup():
    mount = bay_mount("PCIe")
    sfp = {"mount_kind": "MODULE_PORT", "module_port_type_id": ensure_module_port_type_id("SFP")}
    card = module("PCIe card", mount, [place("extension", mount), place("SFP port", sfp)], has_endpoint=True)
    transceiver = module("Structural transceiver", sfp)
    payload = base_payload()
    bay = payload["bays"][0]
    del bay["module_port_type_id"]
    bay.update(mount, bay_key="root")
    base, _ = create_base(payload)
    obj = create_object(base)
    return base, obj, card, transceiver, sfp


def read(object_id):
    response = client.get(f"/v1/topology/physical-objects/{object_id}/configuration")
    assert response.status_code == 200, response.text
    return response.json()


def created(response):
    assert response.status_code == 201, response.text
    return response.json()


def reason(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"]["details"]["reason"] == code


def test_nested_reuse_endpoints_geometry_and_bottom_up_removal():
    _, obj, card, transceiver, _ = setup()
    oid = obj["physical_object_ref"]["entity_id"]
    root = created(install(oid, card, "root", orientation="VERTICAL"))["bays"][0]["installation"]
    child, = created(install(oid, card, "extension", root["id"]))["nested_installations"]
    tree = created(install(oid, transceiver, "SFP port", child["id"]))
    leaf = tree["nested_installations"][1]
    tree = created(install(oid, transceiver, "SFP port", root["id"]))
    assert tree == read(oid)
    assert len({root["id"], *(node["id"] for node in tree["nested_installations"])}) == 4
    assert child["module_revision_id"] == root["module_revision_id"] == card["revision_id"]
    assert leaf["parent_installation_id"] == child["id"]
    assert leaf["endpoints"] == []
    root_after = tree["bays"][0]["installation"]
    assert root_after["module_places"][0]["x"] == .25
    assert root_after["module_places"][0]["global_position"]["x"] == pytest.approx(
        root["layout"]["x"] + .35 * root["layout"]["width"])
    assert root_after["endpoints"] == root["endpoints"]
    point = child["endpoints"][0]
    assert point["connection_point_id"] != root["endpoints"][0]["connection_point_id"]
    assert point["network_interface_id"] != root["endpoints"][0]["network_interface_id"]
    assert point["contextual_display_name"].endswith(" / extension / LAN")
    reason(uninstall(oid, root["id"]), 409, "MODULE_INSTALLATION_HAS_CHILDREN")
    assert read(oid) == tree
    assert uninstall(oid, leaf["id"]).status_code == 200
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        built_in = obj["slots"][0]["connection_point_ref"]["entity_id"]
        repository.add_connection(uuid.UUID(point["connection_point_id"]), uuid.UUID(built_in), 1,
                                  [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
    before = package()
    reason(uninstall(oid, child["id"]), 409, "MODULE_INSTALLATION_IN_USE")
    assert package() == before


def test_invalid_targets_and_concurrent_occupancy():
    base, obj, card, transceiver, sfp = setup()
    oid = obj["physical_object_ref"]["entity_id"]
    root = created(install(oid, card, "root"))["bays"][0]["installation"]
    other = create_object(base)["physical_object_ref"]["entity_id"]
    physical = module("Physical transceiver", sfp, has_endpoint=True)
    other_type = module("Other port", {**sfp, "module_port_type_id": ensure_module_port_type_id("QSFP")})
    before = package()
    reason(install(oid, physical, "SFP port", root["id"]), 409, "TRANSCEIVER_BINDING_REQUIRED")
    reason(install(oid, card, "SFP port", root["id"]), 409, "MODULE_MOUNT_MISMATCH")
    reason(install(oid, other_type, "SFP port", root["id"]), 409, "MODULE_MOUNT_MISMATCH")
    reason(install(oid, transceiver, "absent", root["id"]), 422, "INVALID_MODULE_PLACE")
    reason(install(other, transceiver, "SFP port", root["id"]), 422, "INVALID_MODULE_PARENT")
    assert package() == before
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: install(oid, transceiver, "SFP port", root["id"]), range(2)))
    assert sorted(r.status_code for r in responses) == [201, 409]
    reason(install(oid, transceiver, "SFP port", root["id"]), 409, "MODULE_PLACE_OCCUPIED")
    assert len(read(oid)["nested_installations"]) == 1


def test_reconcile_blocks_nested_tree_and_updates_independent_root():
    base, obj, card, transceiver, _ = setup()
    oid = obj["physical_object_ref"]["entity_id"]
    other = create_object(base)["physical_object_ref"]["entity_id"]
    root = created(install(oid, card, "root"))["bays"][0]["installation"]
    created(install(other, card, "root"))
    pinned = created(install(oid, transceiver, "SFP port", root["id"]))
    revision(card["template_id"], lambda definition: definition.update(name="New card"))
    revision(transceiver["template_id"], lambda definition: definition.update(name="New optics"))
    statuses = {row["physical_object_id"]: row for row in apply(card["template_id"])}
    assert statuses[other]["status"] == "updated"
    assert statuses[oid]["reasons"] == [{"code": "NESTED_INSTALLATION_RECONCILE_BLOCKED"}]
    result, = apply(transceiver["template_id"])
    assert result["reasons"] == [{"code": "NESTED_INSTALLATION_RECONCILE_BLOCKED"}]
    draft = base_review.open_draft(base)
    definition = {**draft["definition"], "name": "Updated base"}
    checked = base_review.check(base, base_review.save(base, draft, definition))["review"]
    statuses = {row["physical_object_id"]: row for row in checked["result"]["objects"]}
    assert statuses[oid]["reasons"][0]["code"] == "NESTED_INSTALLATION_RECONCILE_BLOCKED"
    published = client.post(f"/v1/library/base-templates/{base}/candidates/{checked['candidate_id']}/publish")
    assert published.status_code == 200, published.text
    response = client.post(f"/v1/library/base-templates/{base}/reconcile")
    assert response.status_code == 200, response.text
    statuses = {row["physical_object_id"]: row["status"] for row in response.json()["objects"]}
    assert statuses == {oid: "requires_intervention", other: "updated"}
    assert read(oid) == pinned


def test_workspace_tree_round_trip_and_prewrite_rejection():
    base, obj, card, transceiver, _ = setup()
    oid = obj["physical_object_ref"]["entity_id"]
    other = create_object(base)["physical_object_ref"]["entity_id"]
    other_root = created(install(other, card, "root"))["bays"][0]["installation"]
    root = created(install(oid, card, "root"))["bays"][0]["installation"]
    child, = created(install(oid, card, "extension", root["id"]))["nested_installations"]
    pinned = created(install(oid, transceiver, "SFP port", child["id"]))
    original = package()
    assert original["format_version"] == 14
    assert client.delete("/v1/workspace/dataset").status_code == 204
    empty = package()
    for target, error in [(str(uuid.uuid4()), "missing"), (other_root["id"], "another configuration"),
                          (child["id"], "cycle")]:
        invalid = copy.deepcopy(original)
        row = next(r for r in invalid["authoring"]["ModuleInstallation"] if r["id"] == child["id"])
        row["parent_installation_id"] = target
        response = client.post("/v1/workspace/package", json=invalid)
        assert response.status_code == 422 and error in response.text, response.text
        assert package() == empty
    invalid = copy.deepcopy(original)
    rows = invalid["authoring"]["ModuleInstallation"]
    leaf = next(r for r in rows if r["id"] == pinned["nested_installations"][1]["id"])
    rows.append({**leaf, "id": str(uuid.uuid4())})
    response = client.post("/v1/workspace/package", json=invalid)
    assert response.status_code == 422 and "occupied" in response.text
    assert package() == empty
    leaf["bay_key"] = "extension"
    rows.pop()
    response = client.post("/v1/workspace/package", json=invalid)
    assert response.status_code == 422 and "compatible place" in response.text
    assert package() == empty
    imported = client.post("/v1/workspace/package", json=original)
    assert imported.status_code == 204, imported.text
    assert package() == original
    assert read(oid) == pinned


def test_database_rejects_multirow_cycle():
    _, obj, card, _, _ = setup()
    tree = created(install(obj["physical_object_ref"]["entity_id"], card, "root"))
    root = tree["bays"][0]["installation"]
    a, b = uuid.uuid4(), uuid.uuid4()
    values = {"configuration_id": uuid.UUID(tree["configuration_id"]),
              "module_revision_id": uuid.UUID(card["revision_id"]), "bay_key": "extension",
              "orientation": "HORIZONTAL", "layout": root["layout"]}
    with pytest.raises(IntegrityError, match="hierarchy contains a cycle"), SessionLocal.begin() as session:
        session.execute(insert(ModuleInstallation.__table__).values([
            {**values, "id": a, "parent_installation_id": b},
            {**values, "id": b, "parent_installation_id": a},
        ]))
