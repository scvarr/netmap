from tests.module_port_type_fixtures import ensure_module_port_type_id
import copy
import uuid

import pytest

from tests.test_hardware_configuration import base_payload, client, counts, create_base, create_module, create_object, install
from tests.test_module_template_review import check, open_draft, save
from tests import test_base_template_review as base_review


def module_port():
    return {"key": str(uuid.uuid4()), "display_name": " Гнездо 1 ", "mount_kind": "MODULE_PORT", "module_port_type_id": ensure_module_port_type_id(" Lab / оптика 42 "),
            "x": .15, "y": .2, "width": .41, "height": .35}


def test_base_template_three_elements_materialize_only_physical_endpoints():
    payload = base_payload()
    bay = payload["bays"][0]
    bay.update(module_port_type_id=ensure_module_port_type_id(" Lab / оптика 42 "), kind="PLACED")
    payload["bays"].append({**bay, "bay_key": "logical", "kind": "LOGICAL",
                            "x": None, "y": None, "width": None, "height": None})
    payload["slots"].append({**payload["slots"][0], "key": "point", "display_name": "Patch", "kind": "CONNECTION_POINT"})
    invalid = {**payload, "internal_links": [{"from_slot_key": "point", "to_slot_key": bay["bay_key"]}]}
    assert client.post("/v1/library/base-templates", json=invalid).status_code == 422
    base, _ = create_base(payload)
    before = counts()
    obj = create_object(base)
    assert counts() == tuple(n + delta for n, delta in zip(before, (2, 1, 1, 1, 0)))
    assert sorted(bool(item.get("network_interface_ref")) for item in obj["slots"]) == [False, True]
    config = client.get(f"/v1/topology/physical-objects/{obj['physical_object_ref']['entity_id']}/configuration").json()
    assert {item["bay_key"]: item for item in config["bays"]} == {
        item["bay_key"]: {**item, "installation": None} for item in payload["bays"]
    }


def test_module_port_revision_copy_and_workspace_roundtrip():
    from tests.test_nested_module_installations import bay_mount, module as create_board

    mount = bay_mount("Board slot")
    payload = base_payload()
    bay = payload["bays"][0]
    bay.pop("module_port_type_id")
    bay.update(mount, kind="LOGICAL", x=None, y=None, width=None, height=None)
    base, _ = create_base(payload)
    module = create_board("Board", mount, has_endpoint=True)
    object_id = create_object(base)["physical_object_ref"]["entity_id"]
    bay_key = payload["bays"][0]["bay_key"]
    template_id = module["template_id"]
    assert install(object_id, template_id, bay_key).status_code == 201
    canonical = client.get("/v1/workspace/package").json()["canonical"]
    draft = open_draft(template_id)
    definition = copy.deepcopy(draft["definition"])
    port = module_port()
    marker = {"key": str(uuid.uuid4()), "display_name": "Anchor", "mount_kind": "MODULE_PORT", "module_port_type_id": ensure_module_port_type_id("Open spec"), "x": 1, "y": 0}
    definition["module_places"] = [port, marker]
    definition["endpoints"].append({**definition["endpoints"][0], "key": "patch", "kind": "CONNECTION_POINT", "display_name": "Patch"})
    checked = check(template_id, save(template_id, draft, definition))
    candidate = checked["review"]
    assert open_draft(template_id)["definition"] == candidate["definition"] == definition
    assert {"section": "module_places", "operation": "added", "key": port["key"], "before": None, "after": port} in candidate["result"]["changes"]
    assert candidate["result"]["installations"][0]["classification"] == "potentially_safe"
    published = client.post(f"/v1/library/module-templates/{template_id}/candidates/{candidate['candidate_id']}/publish")
    assert published.status_code == 200, published.text
    reconciled = client.post(f"/v1/library/module-templates/{template_id}/reconcile")
    assert reconciled.status_code == 200, reconciled.text
    result, = reconciled.json()["installations"]
    assert result["status"] == "updated"
    updated_canonical = client.get("/v1/workspace/package").json()["canonical"]
    assert all(row in updated_canonical[entity] for entity, rows in canonical.items() for row in rows)

    fresh_object = create_object(base)["physical_object_ref"]["entity_id"]
    installed = install(fresh_object, template_id, bay_key)
    assert installed.status_code == 201, installed.text
    assert [place["bay_key"] for place in installed.json()["bays"][0]["installation"]["module_places"]] == [port["key"], marker["key"]]

    current = next(item for item in client.get("/v1/library/module-templates").json()["modules"] if item["template_id"] == template_id)
    assert {key: current[key] for key in definition} == definition
    duplicate = client.post("/v1/library/module-templates", json={**definition, "name": "Copy"})
    assert duplicate.status_code == 201, duplicate.text
    assert duplicate.json()["module_places"] == [port, marker]

    reopened = open_draft(template_id)
    renamed = {**port, "display_name": "Moved", "x": .25}
    save(template_id, reopened, {**definition, "module_places": [renamed, marker]})
    package = client.get("/v1/workspace/package").json()
    revisions = {item["id"]: item for item in package["authoring"]["ModuleTemplateRevision"]}
    assert revisions[module["revision_id"]]["module_places"] == []
    assert revisions[published.json()["revision_id"]]["module_places"] == [port, marker]
    assert client.delete("/v1/workspace/dataset").status_code == 204
    imported = client.post("/v1/workspace/package", json=package)
    assert imported.status_code == 204, imported.text
    assert client.get("/v1/workspace/package").json() == package
    assert open_draft(template_id)["definition"]["module_places"] == [renamed, marker]


def test_base_marker_revision_and_legacy_installation_survive_workspace_roundtrip():
    payload = base_payload()
    legacy = {**payload["bays"][0], "kind": "PLACED"}
    marker = {**legacy, "bay_key": "point", "display_name": "Edit me", "x": 1, "y": 0, "width": None, "height": None}
    payload["bays"] = [legacy, marker]
    base, _ = create_base(payload)
    obj = create_object(base)
    object_id = obj["physical_object_ref"]["entity_id"]
    from tests.test_nested_module_installations import module as create_structural_transceiver
    module = create_structural_transceiver("Structural optic", {
        "mount_kind": "MODULE_PORT", "module_port_type_id": legacy["module_port_type_id"],
    })
    for bay in (legacy, marker):
        response = install(object_id, module["template_id"], bay["bay_key"])
        assert response.status_code == 201, response.text
    configuration_url = f"/v1/topology/physical-objects/{object_id}/configuration"
    pinned = client.get(configuration_url).json()
    layouts = {b["bay_key"]: b["installation"]["layout"] for b in pinned["bays"]}
    assert layouts[legacy["bay_key"]]["x"] == pytest.approx(.2)
    assert layouts[marker["bay_key"]]["x"] + layouts[marker["bay_key"]]["width"] == pytest.approx(1)
    assert layouts[marker["bay_key"]]["y"] == 0
    draft = base_review.open_draft(base)
    definition = copy.deepcopy(draft["definition"])
    edited = next(b for b in definition["bays"] if b["bay_key"] == marker["bay_key"])
    edited.update(x=.25, y=.75, display_name="Moved marker")
    checked = base_review.check(base, base_review.save(base, draft, definition))
    result = client.post(f"/v1/library/base-templates/{base}/candidates/{checked['review']['candidate_id']}/publish")
    assert result.status_code == 200, result.text
    assert edited in base_review.open_draft(base)["definition"]["bays"]
    assert client.get(configuration_url).json() == pinned
    package = client.get("/v1/workspace/package").json()
    assert package["format_version"] == 14
    assert client.delete("/v1/workspace/dataset").status_code == 204
    imported = client.post("/v1/workspace/package", json=package)
    assert imported.status_code == 204, imported.text
    assert client.get("/v1/workspace/package").json() == package
    assert client.get(configuration_url).json() == pinned


@pytest.mark.parametrize("invalid", [{"module_port_type_id": "  "}, {"x": .9}, {"width": 0}, {"port_type_id": None}, {"key": "endpoint"}])
def test_module_port_definition_rejects_invalid_structure(invalid):
    definition = {"name": "Module", "mount_kind": "MODULE_PORT", "module_port_type_id": ensure_module_port_type_id("Custom"), "endpoints": [],
                  "geometry": {"width": 240, "height": 80, "fill_color": "#000000", "endpoints": {}},
                  "module_places": [{**module_port(), **invalid}]}
    if invalid.get("key") == "endpoint":
        definition["endpoints"] = [{"key": "endpoint", "display_name": "Physical", "kind": "NETWORK_PORT",
                                    "port_type_id": str(uuid.uuid4())}]
        definition["geometry"]["endpoints"] = {"endpoint": {"x": .5, "y": .5}}
    response = client.post("/v1/library/module-templates", json=definition)
    assert response.status_code == 422, response.text
