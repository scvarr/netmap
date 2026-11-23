from copy import deepcopy
from uuid import UUID

import pytest

from app import models as m
from app.database import SessionLocal
from app.module_geometry import initial_geometry
from tests.module_port_type_fixtures import ensure_module_port_type_id
from tests.test_hardware_configuration import client
from tests.test_module_template_publication import publish
from tests.test_module_template_review import check, open_draft, save
from tests.test_nested_module_installations import created, install, reason, setup
from tests.test_object_reconciliation import package


LIBRARY = "/v1/library/module-templates"


def physical_definition(mount, model, connector, medium, members, specifications):
    connector_id = created(client.post("/v1/connector-types", json={
        "name": connector, "mating_profile": connector, "termination": "SOCKET", "color": "#336699",
    }))["id"]
    port_type = created(client.post("/v1/port-types", json={
        "name": f"{connector} termination", "medium": medium, "members": members,
        "connector_type_id": connector_id, "color": "#336699",
    }))
    return {
        "name": model, **mount, "transceiver": specifications,
        "endpoints": [{"key": "external", "kind": "CONNECTION_POINT", "display_name": "External",
                       "port_type_id": port_type["id"]}],
        "geometry": initial_geometry(["external"]),
    }, port_type


@pytest.mark.parametrize("model,connector,medium,members,specifications", [
    ("SFP+ 10G LR", "LC Duplex", "FIBER", ["TX", "RX"],
     {"speed_mbps": 10000, "reach_m": 10000, "tx_wavelength_nm": 1310, "rx_wavelength_nm": 1310, "fiber_type": "OS2"}),
    ("SFP BiDi", "LC Simplex", "FIBER", ["BiDi"],
     {"speed_mbps": 1000, "tx_wavelength_nm": 1310, "rx_wavelength_nm": 1490}),
    ("SFP 1000BASE-T", "RJ45", "COPPER", ["Pair group"], {"speed_mbps": 1000, "reach_m": 100}),
])
def test_transceiver_library_lifecycle(model, connector, medium, members, specifications):
    _, obj, board, structural, mount = setup()
    object_id = obj["physical_object_ref"]["entity_id"]
    board_installation = created(install(object_id, board, "root"))["bays"][0]["installation"]["id"]
    definition, port_type = physical_definition(mount, model, connector, medium, members, specifications)
    before = package()
    transceiver = created(client.post(LIBRARY, json=definition))
    tid = transceiver["template_id"]
    assert transceiver["mount_kind"] == "MODULE_PORT"
    assert transceiver["module_port_type_id"] == structural["module_port_type_id"]
    assert transceiver["transceiver"] == specifications
    assert port_type["members"] == members and port_type["cardinality"] == len(members)
    reason(install(object_id, transceiver, "top-sfp"), 409, "TRANSCEIVER_BINDING_REQUIRED")
    reason(install(object_id, transceiver, "SFP port", board_installation), 409, "TRANSCEIVER_BINDING_REQUIRED")
    reason(install(object_id, transceiver, "spare"), 409, "MODULE_MOUNT_MISMATCH")
    created(install(object_id, structural, "top-sfp"))
    assert package()["canonical"] == before["canonical"]

    before = package()
    draft = open_draft(tid)
    revised_specifications = {**specifications, "manufacturer": "Example", "part_number": "A-1",
                              "description": "Field model", "notes": "Qualified at the lab"}
    saved = save(tid, draft, {**draft["definition"], "transceiver": revised_specifications})
    assert open_draft(tid)["definition"]["transceiver"] == revised_specifications
    checked = check(tid, saved)
    assert checked["review"]["result"]["changes"] == [{
        "section": "properties", "key": "transceiver", "operation": "changed",
        "before": specifications, "after": revised_specifications,
    }]
    response = publish(tid, checked["review"]["candidate_id"])
    assert response.status_code == 200, response.text
    latest = {item["template_id"]: item for item in client.get(LIBRARY).json()["modules"]}
    assert latest[tid]["revision_id"] == response.json()["revision_id"] != transceiver["revision_id"]
    assert latest[tid]["transceiver"] == revised_specifications
    assert latest[board["template_id"]]["revision_id"] == board["revision_id"]
    assert latest[structural["template_id"]]["revision_id"] == structural["revision_id"]
    assert "transceiver" not in latest[structural["template_id"]]

    exported = package()
    assert exported["format_version"] == 15
    assert exported["canonical"] == before["canonical"]
    assert exported["authoring"]["ModuleInstallation"] == before["authoring"]["ModuleInstallation"]
    historical = next(row for row in exported["authoring"]["ModuleTemplateRevision"]
                      if row["id"] == transceiver["revision_id"])
    assert historical["transceiver"] == specifications
    assert client.delete("/v1/workspace/dataset").status_code == 204
    corrupted = deepcopy(exported)
    latest_row = next(row for row in corrupted["authoring"]["ModuleTemplateRevision"]
                      if row["id"] == latest[tid]["revision_id"])
    latest_row["transceiver"]["description"] = "Altered immutable snapshot"
    assert client.post("/v1/workspace/package", json=corrupted).status_code == 422
    restored = client.post("/v1/workspace/package", json=exported)
    assert restored.status_code == 204, restored.text
    assert package() == exported
    assert open_draft(tid)["definition"]["transceiver"] == revised_specifications


def test_structural_installation_stays_pinned_after_physical_revision():
    _, obj, board, structural, mount = setup()
    object_id = obj["physical_object_ref"]["entity_id"]
    parent = created(install(object_id, board, "root"))["bays"][0]["installation"]["id"]
    created(install(object_id, structural, "SFP port", parent))
    created(install(object_id, structural, "top-sfp"))
    tid = structural["template_id"]
    definition, _ = physical_definition(mount, "Updated model", "Lab duplex", "FIBER", ["Duplex"], {})
    before = package()
    checked = check(tid, save(tid, open_draft(tid), definition))
    assert checked["review"]["definition"]["transceiver"] == {}
    for impact in checked["review"]["result"]["installations"]:
        assert {entry["code"] for entry in impact["reasons"]} == {"TRANSCEIVER_BINDING_REQUIRED"}
    assert len(checked["review"]["result"]["installations"]) == 2
    assert publish(tid, checked["review"]["candidate_id"]).status_code == 200
    reconciled = client.post(f"{LIBRARY}/{tid}/reconcile")
    assert reconciled.status_code == 200, reconciled.text
    assert [result["status"] for result in reconciled.json()["installations"]] == ["requires_intervention"] * 2
    after = package()
    assert after["canonical"] == before["canonical"]
    assert after["authoring"]["ModuleInstallation"] == before["authoring"]["ModuleInstallation"]


def test_incompatible_definitions_and_historical_endings():
    _, obj, board, _, mount = setup()
    definition, port_type = physical_definition(mount, "Optic", "Lab negative", "FIBER", ["TX", "RX"], {})
    before = package()
    for change in (
        {"transceiver": None},
        {"transceiver": {"reach_m": -10}},
        {"transceiver": {"speed_mbps": "10"}},
        {"endpoints": [], "geometry": initial_geometry([])},
        {"endpoints": [{**definition["endpoints"][0], "kind": "NETWORK_PORT"}]},
        {"module_port_type_id": str(UUID(int=0))},
        {"mount_kind": "MODULE_BAY", "module_port_type_id": None, "module_bay_type_id": board["module_bay_type_id"]},
    ):
        assert client.post(LIBRARY, json={**definition, **change}).status_code == 422
    assert package() == before

    other = created(client.post(LIBRARY, json={**definition, "module_port_type_id": ensure_module_port_type_id("QSFP")}))
    oid = obj["physical_object_ref"]["entity_id"]
    reason(install(oid, other, "top-sfp"), 409, "MODULE_MOUNT_MISMATCH")
    with SessionLocal.begin() as session:
        historical = m.ModuleTemplate(name="Historical optic")
        session.add(historical)
        session.flush()
        revision = m.ModuleTemplateRevision(template_id=historical.id, name=historical.name, version_number=1,
            mount_kind="MODULE_PORT", module_port_type_id=UUID(mount["module_port_type_id"]), geometry=definition["geometry"])
        session.add(revision)
        session.flush()
        session.add(m.ModuleEndpointDefinition(module_revision_id=revision.id, definition_key="external", display_name="LC",
            order_index=0, kind="CONNECTION_POINT", port_type_id=UUID(port_type["id"])))
        historical_id = str(historical.id)
    draft = open_draft(historical_id)
    assert "transceiver" not in draft["definition"]
    assert draft["definition"]["endpoints"][0]["port_type_id"] == port_type["id"]
    checked = check(historical_id, save(historical_id, draft, {**draft["definition"], "name": "Historical optic v2"}))
    assert publish(historical_id, checked["review"]["candidate_id"]).status_code == 200
    reason(install(oid, {"template_id": historical_id}, "top-sfp"), 409, "TRANSCEIVER_BINDING_REQUIRED")
