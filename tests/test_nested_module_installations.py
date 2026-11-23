import copy
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import pytest
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.errors import ModelError
from app.hardware_catalog import HardwareCatalog
from app.models import BaseTemplate, Cable, ModuleInstallation
from app.schemas import CreateBaseTemplateRequest
from app.module_geometry import initial_geometry
from app.module_reconciliation import ModuleReconciliation
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests import test_base_template_review as base_review
from tests import test_module_template_review as module_review
from tests.cable_type_fixtures import copper_cable_spec
from tests.module_port_type_fixtures import ensure_module_port_type_id
from tests.port_type_fixtures import ensure_port_type_id
from tests.test_hardware_configuration import base_payload, client, create_base, create_object
from tests.test_module_reconciliation import apply, package, revision
from tests.test_module_layout_editing import request as layout_request
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


def physical_transceiver(mount):
    connector_name = f"Lab socket {uuid.uuid4()}"
    connector = created(client.post("/v1/connector-types", json={
        "name": connector_name, "mating_profile": "Lab", "termination": "SOCKET", "color": "#336699",
    }))
    port = created(client.post("/v1/port-types", json={
        "name": "Lab termination", "medium": "FIBER", "members": ["Optical"],
        "connector_type_id": connector["id"], "color": "#336699",
    }))
    return {"name": "Physical transceiver", **mount, "transceiver": {}, "geometry": initial_geometry(["optical"]),
            "endpoints": [{"key": "optical", "display_name": "Optical", "kind": "CONNECTION_POINT", "port_type_id": port["id"]}]}


def place(key, mount):
    return {"key": key, "display_name": key, "x": .25, "y": .65, **mount}


def install(object_id, template, key, parent=None, orientation="HORIZONTAL"):
    return client.post(f"/v1/topology/physical-objects/{object_id}/module-installations", json={
        "module_template_id": template["template_id"], "bay_key": key,
        "parent_installation_id": parent, "orientation": orientation,
    })


# Seed states that could have been persisted by MOD-02A/02B before this policy.
def historical_install(*args):
    with patch("app.hardware_catalog.validate_nested_installation"):
        return created(install(*args))


def historical_revision(template_id, transform):
    with patch("app.module_template_review.validate_module_authoring"):
        return revision(template_id, transform)


def setup(*, historical=False):
    mount = bay_mount("PCIe")
    sfp = {"mount_kind": "MODULE_PORT", "module_port_type_id": ensure_module_port_type_id("SFP+")}
    places = [place("SFP port", sfp), {**place("SFP port 2", sfp), "x": .75}]
    if historical:
        with patch("app.hardware_catalog.validate_module_authoring"):
            card = module("PCIe card", mount, [place("extension", mount), *places[:1]], has_endpoint=True)
    else:
        card = module("PCIe card", mount, places, has_endpoint=True)
    transceiver = module("Structural transceiver", sfp)
    payload = base_payload()
    bay = payload["bays"][0]
    del bay["module_port_type_id"]
    bay.update(mount, bay_key="root")
    if historical:
        with SessionLocal.begin() as session:
            template = BaseTemplate(name=payload["name"])
            session.add(template)
            session.flush()
            base = str(template.id)
            HardwareCatalog(session)._create_version(template.id, 1, CreateBaseTemplateRequest.model_validate(payload))
    else:
        bay.update(kind="LOGICAL", x=None, y=None, width=None, height=None)
        payload["bays"].append({**bay, "bay_key": "spare"})
        payload["bays"].append({**sfp, "bay_key": "top-sfp", "display_name": "Direct SFP+",
                                "panel_key": bay["panel_key"], "kind": "PLACED", "x": .25, "y": .65})
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



def test_board_and_structural_transceiver_keep_the_same_physical_object():
    _, obj, card, optic, _ = setup()
    oid = obj["physical_object_ref"]["entity_id"]
    before = package()
    tree = created(install(oid, card, "root"))
    root, spare, direct = tree["bays"]
    assert root["kind"] == spare["kind"] == "LOGICAL"
    assert root["mount_kind"] == spare["mount_kind"] == "MODULE_BAY"
    board = root["installation"]
    assert [place["bay_key"] for place in board["module_places"]] == ["SFP port", "SFP port 2"]
    assert all(place["installation_id"] is None for place in board["module_places"])
    with_board = package()
    assert with_board["canonical"]["PhysicalObject"] == before["canonical"]["PhysicalObject"]
    assert with_board["authoring"]["ObjectConfiguration"] == before["authoring"]["ObjectConfiguration"]
    leaf, = created(install(oid, optic, "SFP port 2", board["id"]))["nested_installations"]
    assert leaf["parent_installation_id"] == board["id"]
    assert leaf["endpoints"] == []
    assert created(install(oid, optic, direct["bay_key"]))["bays"][2]["installation"]["endpoints"] == []
    assert package()["canonical"] == with_board["canonical"]
    reason(uninstall(oid, board["id"]), 409, "MODULE_INSTALLATION_HAS_CHILDREN")


def test_authoring_rejects_invalid_places_even_for_a_preexisting_candidate():
    mount = bay_mount("PCIe")
    sfp = {"mount_kind": "MODULE_PORT", "module_port_type_id": ensure_module_port_type_id("SFP+")}
    definition = {"name": "Test module", **mount, "endpoints": [], "geometry": initial_geometry([]),
                  "module_places": [place("extension", mount)]}
    url = "/v1/library/module-templates"
    reason(client.post(url, json=definition), 422, "NESTED_MODULE_BAY_FORBIDDEN")
    reason(client.post(url, json={**definition, **sfp, "module_bay_type_id": None,
                                 "module_places": [place("optic", sfp)]}),
           422, "TRANSCEIVER_CHILD_PLACES_FORBIDDEN")
    tid = module("Board", mount)["template_id"]
    draft = module_review.open_draft(tid)
    reason(client.put(f"{url}/{tid}/draft?expected_generation={draft['generation']}", json=definition),
           422, "NESTED_MODULE_BAY_FORBIDDEN")
    with patch("app.module_template_review.validate_module_authoring"):
        generation = module_review.save(tid, draft, definition)
        candidate = module_review.check(tid, generation)["review"]["candidate_id"]
    before = package()
    reason(client.post(f"{url}/{tid}/candidates/{candidate}/publish"), 422, "NESTED_MODULE_BAY_FORBIDDEN")
    assert package() == before


def test_new_base_template_rejects_placed_board_bays():
    payload = base_payload()
    bay = payload["bays"][0]
    bay.pop("module_port_type_id")
    bay.update(bay_mount("PCIe"))
    reason(client.post("/v1/library/base-templates", json=payload), 422, "MODULE_BAY_MUST_BE_LOGICAL")

def test_nested_reuse_endpoints_geometry_and_bottom_up_removal():
    _, obj, card, transceiver, _ = setup(historical=True)
    oid = obj["physical_object_ref"]["entity_id"]
    root = created(install(oid, card, "root", orientation="VERTICAL"))["bays"][0]["installation"]
    reason(install(oid, card, "extension", root["id"]), 409, "UNSUPPORTED_NESTED_MODULE_INSTALLATION")
    child, = historical_install(oid, card, "extension", root["id"])["nested_installations"]
    reason(install(oid, transceiver, "SFP port", child["id"]), 409, "UNSUPPORTED_NESTED_MODULE_INSTALLATION")
    tree = historical_install(oid, transceiver, "SFP port", child["id"])
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
    physical = created(client.post("/v1/library/module-templates", json=physical_transceiver(sfp)))
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


def test_reconcile_moves_subtree_preserves_identity_and_round_trips_workspace():
    base, obj, card, transceiver, sfp = setup(historical=True)
    oid = obj["physical_object_ref"]["entity_id"]
    child_template = module("Extension", {"mount_kind": card["mount_kind"],
                            "module_bay_type_id": card["module_bay_type_id"]},
                            [place("optics", sfp)], has_endpoint=True)
    tree = created(install(oid, card, "root", orientation="VERTICAL"))
    root = tree["bays"][0]["installation"]
    layout = layout_request(tree)
    response = client.put(f"/v1/topology/physical-objects/{oid}/module-installations/{root['id']}/layout", json=layout)
    assert response.status_code == 200, response.text
    child, = historical_install(oid, child_template, "extension", root["id"], "VERTICAL")["nested_installations"]
    tree = historical_install(oid, transceiver, "optics", child["id"], "VERTICAL")
    leaf = tree["nested_installations"][1]
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        peer = repository.add_connection_point(repository.add_physical_object().id, 1)
        connection, _ = repository.add_connection(uuid.UUID(child["endpoints"][0]["connection_point_id"]),
                                                  peer.id, 1, [ConnectionMemberInput(1, 1, 1)])
        session.add(Cable(connection_id=connection.id, cable_type_id=copper_cable_spec().cable_type_id))
    before = package()

    def move(definition):
        definition["module_places"][0].update(key="moved", x=.8, y=.4, width=.15, height=.2)

    target = historical_revision(card["template_id"], move)
    child_target = revision(child_template["template_id"], lambda d: d["geometry"]["endpoints"]["lan"].update(x=.2, y=.3))
    revision(transceiver["template_id"], lambda d: d.update(name="New optics"))
    assert apply(card["template_id"])[0]["status"] == "updated"
    moved_tree = read(oid)
    moved, moved_leaf = moved_tree["nested_installations"]
    assert moved_tree["bays"][0]["installation"]["layout"] == layout["layout"]
    assert moved_tree["bays"][0]["installation"]["module_revision_id"] == target["revision_id"]
    assert (moved["id"], moved["parent_installation_id"], moved["bay_key"]) == (child["id"], root["id"], "moved")
    assert moved["module_revision_id"] == child_template["revision_id"]
    assert moved_leaf["global_layout"] != leaf["global_layout"]
    assert moved_leaf["layout"] == leaf["layout"]
    assert apply(child_template["template_id"])[0]["status"] == "updated"
    updated, updated_leaf = read(oid)["nested_installations"]
    assert updated["module_revision_id"] == child_target["revision_id"]
    assert (updated_leaf["id"], updated_leaf["parent_installation_id"], updated_leaf["module_revision_id"]) == (
        leaf["id"], child["id"], transceiver["revision_id"])
    bounds = updated["global_layout"]
    # Two vertical ancestors rotate the child's endpoint and places by 180°.
    assert updated["endpoints"][0]["x"] == pytest.approx(bounds["x"] + .8 * bounds["width"])
    assert updated["endpoints"][0]["y"] == pytest.approx(bounds["y"] + .7 * bounds["height"])
    leaf_bounds = updated_leaf["layout"]
    assert updated_leaf["global_layout"]["x"] == pytest.approx(
        bounds["x"] + (1 - leaf_bounds["x"] - leaf_bounds["width"]) * bounds["width"])
    assert apply(child_template["template_id"])[0]["status"] == "already_current"
    assert apply(card["template_id"])[0]["status"] == "already_current"

    draft = base_review.open_draft(base)
    definition = {**draft["definition"], "name": "Updated base"}
    checked = base_review.check(base, base_review.save(base, draft, definition))["review"]
    assert checked["result"]["objects"][0]["classification"] == "potentially_safe"
    published = client.post(f"/v1/library/base-templates/{base}/candidates/{checked['candidate_id']}/publish")
    assert published.status_code == 200, published.text
    response = client.post(f"/v1/library/base-templates/{base}/reconcile")
    assert response.status_code == 200, response.text
    assert response.json()["objects"][0]["status"] == "updated"
    retry = client.post(f"/v1/library/base-templates/{base}/reconcile")
    assert retry.status_code == 200, retry.text
    assert retry.json()["objects"][0]["status"] == "already_current"
    final_tree = read(oid)
    assert final_tree["nested_installations"] == [updated, updated_leaf]
    exported = package()
    assert exported["format_version"] == 15
    assert exported["canonical"] == before["canonical"]
    def mappings(pkg):
        return {row["id"]: (row["installation_id"], row["connection_point_id"], row["network_interface_id"])
                for row in pkg["authoring"]["ModuleEndpointMapping"]}
    assert mappings(exported) == mappings(before)
    assert client.delete("/v1/workspace/dataset").status_code == 204
    response = client.post("/v1/workspace/package", json=exported)
    assert response.status_code == 204, response.text
    assert package() == exported
    assert read(oid) == final_tree


@pytest.mark.parametrize(("count", "code"), [(0, "NO_COMPATIBLE_NESTED_PLACEMENT"), (2, "AMBIGUOUS_NESTED_PLACEMENT")])
def test_unsafe_assignment_refused_in_review_and_apply(count, code):
    base, obj, card, transceiver, sfp = setup()
    oid = obj["physical_object_ref"]["entity_id"]
    other = create_object(base)["physical_object_ref"]["entity_id"]
    root = created(install(oid, card, "root"))["bays"][0]["installation"]
    created(install(other, card, "root"))
    pinned = created(install(oid, transceiver, "SFP port", root["id"]))
    child, = pinned["nested_installations"]
    tid = card["template_id"]
    revision(tid, lambda d: d.update(module_places=[place(f"new-{i}", sfp) for i in range(count)]))
    review = module_review.open_draft(tid)["review"]["result"]["installations"]
    expected = {"code": code, "installation_id": child["id"], "key": "SFP port", "mount": sfp}
    assert next(row for row in review if row["physical_object_id"] == oid)["reasons"] == [expected]
    before = package()
    statuses = {row["physical_object_id"]: row for row in apply(tid)}
    assert statuses[other]["status"] == "updated"
    assert statuses[oid]["reasons"] == [expected]
    assert read(oid) == pinned
    assert package()["canonical"] == before["canonical"]


def test_nested_transceiver_and_incompatible_target_mount_are_refused():
    _, obj, card, transceiver, sfp = setup()
    oid = obj["physical_object_ref"]["entity_id"]
    root = created(install(oid, card, "root"))["bays"][0]["installation"]
    created(install(oid, transceiver, "SFP port", root["id"]))
    tid = transceiver["template_id"]
    revision(card["template_id"], lambda d: d.update(module_places=[]))
    target = revision(tid, lambda d: d.update(name="Structural optics v2"))
    assert apply(tid)[0]["status"] == "updated"
    pinned = read(oid)
    assert pinned["bays"][0]["installation"]["module_revision_id"] == card["revision_id"]
    assert pinned["nested_installations"][0]["module_revision_id"] == target["revision_id"]
    revision(tid, lambda d: d.update(endpoints=[], module_port_type_id=ensure_module_port_type_id("QSFP")))
    before = package()
    assert apply(tid)[0]["reasons"][0]["code"] == "NESTED_PLACE_COMPATIBILITY_MISMATCH"
    assert package() == before
    definition = physical_transceiver(sfp)
    revision(tid, lambda d: d.update(definition))
    before = package()
    assert apply(tid)[0]["reasons"][0]["code"] == "TRANSCEIVER_BINDING_REQUIRED"
    assert package() == before


def test_locked_preflight_rechecks_children_added_after_review():
    _, obj, card, transceiver, _ = setup()
    oid = obj["physical_object_ref"]["entity_id"]
    root = created(install(oid, card, "root"))["bays"][0]["installation"]
    tid = card["template_id"]
    revision(tid, lambda d: d.update(module_places=[]))
    assert module_review.open_draft(tid)["review"]["result"]["installations"][0]["classification"] == "potentially_safe"
    child, = created(install(oid, transceiver, "SFP port", root["id"]))["nested_installations"]
    before = package()
    with ThreadPoolExecutor(max_workers=1) as pool, SessionLocal.begin() as writer:
        writer.scalar(select(ModuleInstallation).where(ModuleInstallation.id == uuid.UUID(child["id"])).with_for_update())
        assert pool.submit(apply, tid).result(timeout=10)[0]["reasons"] == [{"code": "CONCURRENT_CHANGE"}]
    assert apply(tid)[0]["reasons"][0]["code"] == "NO_COMPATIBLE_NESTED_PLACEMENT"
    assert package() == before


def test_unique_swap_is_atomic_when_apply_fails_after_writes(monkeypatch):
    _, obj, card, transceiver, sfp = setup(historical=True)
    oid = obj["physical_object_ref"]["entity_id"]
    root = created(install(oid, card, "root"))["bays"][0]["installation"]
    mount = {"mount_kind": card["mount_kind"], "module_bay_type_id": card["module_bay_type_id"]}
    extension = module("Extension", mount)
    child, = historical_install(oid, extension, "extension", root["id"])["nested_installations"]
    tree = created(install(oid, transceiver, "SFP port", root["id"]))
    optic = tree["nested_installations"][1]
    tid = card["template_id"]
    historical_revision(tid, lambda d: d.update(module_places=[place("extension", sfp), place("SFP port", mount)]))
    before = package()
    original_apply = ModuleReconciliation.apply

    def fail_after_write(self, *args):
        assert original_apply(self, *args)["status"] == "updated"
        raise ModelError("Simulated concurrent conflict after writes", {"reason": "CONCURRENT_CHANGE"})

    with monkeypatch.context() as patch:
        patch.setattr(ModuleReconciliation, "apply", fail_after_write)
        assert apply(tid)[0]["reasons"] == [{"code": "CONCURRENT_CHANGE"}]
    assert package() == before
    assert apply(tid)[0]["status"] == "updated"
    assert {i["id"]: i["bay_key"] for i in read(oid)["nested_installations"]} == {
        child["id"]: "SFP port", optic["id"]: "extension"}


def test_invalid_nested_place_blocks_base_metadata_reconciliation():
    base, obj, card, transceiver, _ = setup()
    oid = obj["physical_object_ref"]["entity_id"]
    root = created(install(oid, card, "root"))["bays"][0]["installation"]
    child, = created(install(oid, transceiver, "SFP port", root["id"]))["nested_installations"]
    with SessionLocal.begin() as writer:
        writer.get(ModuleInstallation, uuid.UUID(child["id"])).bay_key = "missing"
    draft = base_review.open_draft(base)
    checked = base_review.check(base, base_review.save(base, draft, {**draft["definition"], "name": "New base"}))["review"]
    expected = {"code": "INVALID_NESTED_PLACEMENT", "installation_id": child["id"], "key": "missing"}
    assert checked["result"]["objects"][0]["reasons"] == [expected]
    published = client.post(f"/v1/library/base-templates/{base}/candidates/{checked['candidate_id']}/publish")
    assert published.status_code == 200, published.text
    before = package()
    response = client.post(f"/v1/library/base-templates/{base}/reconcile")
    assert response.status_code == 200, response.text
    assert response.json()["objects"][0]["reasons"] == [expected]
    assert package() == before


def test_workspace_tree_round_trip_and_prewrite_rejection():
    base, obj, card, transceiver, _ = setup(historical=True)
    oid = obj["physical_object_ref"]["entity_id"]
    other = create_object(base)["physical_object_ref"]["entity_id"]
    other_root = created(install(other, card, "root"))["bays"][0]["installation"]
    root = created(install(oid, card, "root"))["bays"][0]["installation"]
    child, = historical_install(oid, card, "extension", root["id"])["nested_installations"]
    pinned = historical_install(oid, transceiver, "SFP port", child["id"])
    original = package()
    assert original["format_version"] == 15
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
    _, obj, card, _, _ = setup(historical=True)
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
