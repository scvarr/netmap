import copy
from concurrent.futures import ThreadPoolExecutor

import pytest

from tests.test_hardware_configuration import base_payload, client, create_base, create_object
from tests.test_module_reconciliation import apply, package, revision
from tests.test_module_uninstall import uninstall
from tests.test_nested_module_installations import created, install, physical_transceiver, read, reason
from tests.test_parent_hardware_interfaces import create_installation, hardware


def point_end(point_id):
    return {"kind": "CONNECTION_POINT", "connection_point_id": point_id, "member_index": 1}


@pytest.mark.parametrize("nested", [False, True])
def test_install_and_protect_physical_transceiver(hardware, nested):
    object_id, board, direct = create_installation(hardware)
    socket = board["module_places"][0] if nested else direct
    parent_id = board["id"] if nested else None
    optic = created(client.post("/v1/library/module-templates", json=physical_transceiver(hardware[-1])))
    before = package()
    config = created(install(object_id, optic, socket["bay_key"], parent_id))
    installed = config["nested_installations"][0] if nested else config["bays"][1]["installation"]
    endpoint, = installed["endpoints"]
    assert installed["module_revision_id"] == optic["revision_id"]
    assert endpoint["network_interface_id"] is None
    point_id = endpoint["connection_point_id"]
    installed_snapshot = package()
    canonical = installed_snapshot["canonical"]
    assert canonical["NetworkInterface"] == before["canonical"]["NetworkInterface"]
    assert len(canonical["ConnectionPoint"]) == len(before["canonical"]["ConnectionPoint"]) + 1
    assert len(canonical["InterfacePhysicalBinding"]) == len(before["canonical"]["InterfacePhysicalBinding"]) + 1
    binding, = [row for row in canonical["InterfacePhysicalBinding"] if row["point_id"] == point_id]
    assert (binding["interface_id"], binding["point_member"]) == (socket["network_interface_id"], 1)
    reason(install(object_id, optic, socket["bay_key"], parent_id), 409, "MODULE_PLACE_OCCUPIED")
    reason(uninstall(object_id, installed["id"]), 409, "TRANSCEIVER_REMOVAL_UNSUPPORTED")
    if nested:
        reason(uninstall(object_id, parent_id), 409, "MODULE_INSTALLATION_HAS_CHILDREN")
    assert package() == installed_snapshot
    if nested:
        board_template = hardware[1]["template_id"]
        revision(board_template, lambda d: d["module_places"][0].pop("hardware_interface_key"))
        assert apply(board_template)[0]["status"] == "requires_intervention"
    revision(optic["template_id"], lambda d: d.update(name="Optic renamed"))
    assert apply(optic["template_id"])[0]["status"] == "updated"
    assert package()["canonical"] == canonical
    def change_termination(d):
        d["endpoints"][0]["key"] = "replacement"
        d["geometry"]["endpoints"]["replacement"] = d["geometry"]["endpoints"].pop("optical")
    revision(optic["template_id"], change_termination)
    assert apply(optic["template_id"])[0]["status"] == "requires_intervention"
    assert package()["canonical"] == canonical
    assert client.delete(f"/v1/topology/physical-objects/{object_id}").status_code == 204
    assert package()["canonical"]["InterfacePhysicalBinding"] == []


def test_opposite_transceiver_modes_allow_cable_and_workspace_roundtrip(hardware):
    object_id, board, _ = create_installation(hardware)
    peer_id, _, _ = create_installation(hardware)
    definition = physical_transceiver(hardware[-1])
    optic = created(client.post("/v1/library/module-templates", json=definition))
    mm = created(client.post("/v1/library/module-templates", json={
        **definition, "name": "Multimode model", "transceiver": {"fiber_type": "MM"},
    }))
    a = created(install(object_id, optic, "socket", board["id"]))["nested_installations"][0]["endpoints"][0]
    b = created(install(peer_id, mm, "direct"))["bays"][1]["installation"]["endpoints"][0]
    data = {"source": point_end(a["connection_point_id"]), "target": point_end(b["connection_point_id"])}
    preview = client.post("/v1/topology/physical-connections?preview=true", json=data)
    assert preview.status_code == 200 and preview.json()["verdict"] == "ALLOW", preview.text
    connected = created(client.post("/v1/topology/physical-connections", json=data))
    reason(client.post("/v1/topology/physical-connections", json=data), 422, "CONNECTION_POINT_MEMBER_OCCUPIED")
    reason(client.delete(f"/v1/topology/physical-objects/{object_id}"), 409, "PHYSICAL_OBJECT_IN_USE")
    snapshot = package()
    assert snapshot["format_version"] == 17
    assert client.delete("/v1/workspace/dataset").status_code == 204
    empty = package()
    for invalid_member in (None, 2):
        invalid = copy.deepcopy(snapshot)
        bindings = invalid["canonical"]["InterfacePhysicalBinding"]
        row = next(row for row in bindings if row["point_id"] == a["connection_point_id"])
        if invalid_member is None:
            bindings.remove(row)
        else:
            row["point_member"] = invalid_member
        response = client.post("/v1/workspace/package", json=invalid)
        assert response.status_code == 422, response.text
        assert package() == empty
    response = client.post("/v1/workspace/package", json=snapshot)
    assert response.status_code == 204, response.text
    assert package() == snapshot
    connection_id = connected["connection_ref"]["entity_id"]
    assert client.delete(f"/v1/topology/physical-connections/{connection_id}").status_code == 204
    assert package()["canonical"]["InterfacePhysicalBinding"] == snapshot["canonical"]["InterfacePhysicalBinding"]


def test_install_validation_and_concurrency(hardware):
    object_id, _, _ = create_installation(hardware)
    definition = physical_transceiver(hardware[-1])
    optic = created(client.post("/v1/library/module-templates", json=definition))
    payload = base_payload()
    bare_base, _ = create_base(payload)
    bare_id = create_object(bare_base)["physical_object_ref"]["entity_id"]
    port = next(row for row in client.get("/v1/port-types").json()
                if row["id"] == definition["endpoints"][0]["port_type_id"])
    duplex_port = created(client.post("/v1/port-types", json={
        "name": "Duplex", "color": "#336699", "medium": "FIBER",
        "members": ["1", "2"],
    }))
    duplex_definition = copy.deepcopy(definition)
    duplex_definition.update(name="Duplex optic")
    duplex_definition["endpoints"][0]["port_type_id"] = duplex_port["id"]
    duplex = created(client.post("/v1/library/module-templates", json=duplex_definition))
    before = package()
    reason(install(bare_id, optic, payload["bays"][0]["bay_key"]), 409, "TRANSCEIVER_BINDING_REQUIRED")
    reason(install(object_id, optic, "board"), 409, "MODULE_PLACE_OCCUPIED")
    reason(install(object_id, hardware[1], "direct"), 409, "MODULE_MOUNT_MISMATCH")
    reason(install(object_id, duplex, "direct"), 409, "UNSUPPORTED_TRANSCEIVER_TERMINATION")
    assert package() == before
    with ThreadPoolExecutor(max_workers=2) as workers:
        responses = list(workers.map(lambda _: install(object_id, optic, "direct"), range(2)))
    assert sorted(response.status_code for response in responses) == [201, 409]
    reason(next(response for response in responses if response.status_code == 409), 409, "MODULE_PLACE_OCCUPIED")
    assert len(read(object_id)["bays"][1]["installation"]["endpoints"]) == 1
    assert len(package()["canonical"]["InterfacePhysicalBinding"]) == len(before["canonical"]["InterfacePhysicalBinding"]) + 1
