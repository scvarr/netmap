import copy
import uuid

import pytest

from tests.test_hardware_configuration import base_payload, client, counts, create_base, create_module, create_object, install
from tests.test_module_template_review import check, open_draft, save


def module_port():
    return {"key": str(uuid.uuid4()), "display_name": " Гнездо 1 ", "compatibility": " Lab / оптика 42 ",
            "x": .15, "y": .2, "width": .41, "height": .35}


def test_base_template_three_elements_materialize_only_physical_endpoints():
    payload = base_payload()
    bay = payload["bays"][0]
    bay.update(compatibility=" Lab / оптика 42 ", kind="PLACED")
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
    base, payload = create_base()
    module = create_module(names=("GE",))
    object_id = create_object(base)["physical_object_ref"]["entity_id"]
    bay_key = payload["bays"][0]["bay_key"]
    template_id = module["template_id"]
    assert install(object_id, template_id, bay_key).status_code == 201
    canonical = client.get("/v1/workspace/package").json()["canonical"]
    draft = open_draft(template_id)
    definition = copy.deepcopy(draft["definition"])
    port = module_port()
    definition["module_ports"] = [port]
    definition["endpoints"].append({**definition["endpoints"][0], "key": "patch", "kind": "CONNECTION_POINT", "display_name": "Patch"})
    checked = check(template_id, save(template_id, draft, definition))
    candidate = checked["review"]
    assert open_draft(template_id)["definition"] == candidate["definition"] == definition
    assert {"section": "module_ports", "operation": "added", "key": port["key"], "before": None, "after": port} in candidate["result"]["changes"]
    assert candidate["result"]["installations"][0]["reasons"] == [{"code": "NESTED_MODULE_PORTS_UNSUPPORTED"}]
    published = client.post(f"/v1/library/module-templates/{template_id}/candidates/{candidate['candidate_id']}/publish")
    assert published.status_code == 200, published.text
    reconciled = client.post(f"/v1/library/module-templates/{template_id}/reconcile")
    assert reconciled.status_code == 200, reconciled.text
    result, = reconciled.json()["installations"]
    assert result["status"] == "requires_intervention"
    assert result["reasons"] == [{"code": "NESTED_MODULE_PORTS_UNSUPPORTED"}]
    assert client.get("/v1/workspace/package").json()["canonical"] == canonical

    fresh_object = create_object(base)["physical_object_ref"]["entity_id"]
    before = counts()
    refused = install(fresh_object, template_id, bay_key)
    assert refused.status_code == 409
    assert refused.json()["error"]["details"]["reason"] == "NESTED_MODULE_PORTS_UNSUPPORTED"
    assert counts() == before

    current = next(item for item in client.get("/v1/library/module-templates").json()["modules"] if item["template_id"] == template_id)
    assert {key: current[key] for key in definition} == definition
    duplicate = client.post("/v1/library/module-templates", json={**definition, "name": "Copy"})
    assert duplicate.status_code == 201, duplicate.text
    assert duplicate.json()["module_ports"] == [port]

    reopened = open_draft(template_id)
    renamed = {**port, "display_name": "Moved", "x": .25}
    save(template_id, reopened, {**definition, "module_ports": [renamed]})
    package = client.get("/v1/workspace/package").json()
    revisions = {item["id"]: item for item in package["authoring"]["ModuleTemplateRevision"]}
    assert revisions[module["revision_id"]]["module_ports"] == []
    assert revisions[published.json()["revision_id"]]["module_ports"] == [port]
    assert client.delete("/v1/workspace/dataset").status_code == 204
    imported = client.post("/v1/workspace/package", json=package)
    assert imported.status_code == 204, imported.text
    assert client.get("/v1/workspace/package").json() == package
    assert open_draft(template_id)["definition"]["module_ports"] == [renamed]


@pytest.mark.parametrize("invalid", [{"compatibility": "  "}, {"x": .9}, {"width": 0}, {"port_type_id": None}, {"key": "endpoint"}])
def test_module_port_definition_rejects_invalid_structure(invalid):
    definition = {"name": "Module", "compatibility": "Custom", "endpoints": [],
                  "geometry": {"width": 240, "height": 80, "fill_color": "#000000", "endpoints": {}},
                  "module_ports": [{**module_port(), **invalid}]}
    if invalid.get("key") == "endpoint":
        definition["endpoints"] = [{"key": "endpoint", "display_name": "Physical", "kind": "NETWORK_PORT",
                                    "port_type_id": str(uuid.uuid4())}]
        definition["geometry"]["endpoints"] = {"endpoint": {"x": .5, "y": .5}}
    response = client.post("/v1/library/module-templates", json=definition)
    assert response.status_code == 422, response.text
