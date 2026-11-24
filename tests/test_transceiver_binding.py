import copy
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.database import SessionLocal
from app.errors import ModelError
from app.repository import CanonicalRepository
from tests.test_hardware_configuration import base_payload, client, create_base, create_object
from tests.test_module_reconciliation import apply, package, revision
from tests.test_module_uninstall import uninstall
from tests.test_nested_module_installations import created, install, physical_transceiver, read, reason
from tests.test_parent_hardware_interfaces import create_installation, hardware


def point_end(point_id):
    return {"kind": "CONNECTION_POINT", "connection_point_id": point_id, "member_index": 1}


@pytest.mark.parametrize("nested", [False, True])
@pytest.mark.parametrize("members", [("1",), ("Alpha", "Beta")])
def test_install_and_protect_physical_transceiver(hardware, nested, members):
    object_id, board, direct = create_installation(hardware)
    socket = board["module_places"][0] if nested else direct
    parent_id = board["id"] if nested else None
    optic = created(client.post("/v1/library/module-templates", json=physical_transceiver(hardware[-1], members=members)))
    before = package()
    config = created(install(object_id, optic, socket["bay_key"], parent_id))
    installed = config["nested_installations"][0] if nested else config["bays"][1]["installation"]
    endpoint, = installed["endpoints"]
    assert installed["module_revision_id"] == optic["revision_id"]
    assert endpoint["network_interface_id"] is None
    assert endpoint["cardinality"] == len(members)
    assert endpoint["members"] == list(members)
    point_id = endpoint["connection_point_id"]
    installed_snapshot = package()
    canonical = installed_snapshot["canonical"]
    assert canonical["NetworkInterface"] == before["canonical"]["NetworkInterface"]
    assert len(canonical["ConnectionPoint"]) == len(before["canonical"]["ConnectionPoint"]) + 1
    assert len(canonical["InterfacePhysicalBinding"]) == len(before["canonical"]["InterfacePhysicalBinding"]) + len(members)
    bindings = [row for row in canonical["InterfacePhysicalBinding"] if row["point_id"] == point_id]
    assert {(row["interface_id"], row["point_member"]) for row in bindings} == {
        (socket["network_interface_id"], member) for member in range(1, len(members) + 1)
    }
    point, = [row for row in canonical["ConnectionPoint"] if row["id"] == point_id]
    assert point["cardinality"] == len(members)
    for table in ("Connection", "ConnectionMember", "Cable", "NetworkInterfacePhysicalOwner"):
        assert canonical[table] == before["canonical"][table]
    assert installed_snapshot["authoring"]["HardwareInterfaceAssociation"] == before["authoring"]["HardwareInterfaceAssociation"]
    details = client.get(f"/v1/topology/physical-objects/{object_id}").json()
    detail, = [row for row in details["connection_points"] if row["connection_point_ref"]["entity_id"] == point_id]
    assert detail["direct_interface_binding_count"] == len(members)
    assert detail["internal_physical_counterparts"] == []
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
    optic = created(client.post("/v1/library/module-templates", json=physical_transceiver(
        hardware[-1], members=("Alpha", "Beta"),
    )))
    payload = base_payload()
    bare_base, _ = create_base(payload)
    bare_id = create_object(bare_base)["physical_object_ref"]["entity_id"]
    unsupported = created(client.post("/v1/library/module-templates", json=physical_transceiver(
        hardware[-1], members=("1", "2", "3"),
    )))
    conflict_id, _, conflict_socket = create_installation(hardware)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        point = repository.add_connection_point(uuid.UUID(conflict_id), cardinality=1)
        repository.add_interface_physical_binding(uuid.UUID(conflict_socket["network_interface_id"]), point.id, point_member=1)
    before = package()
    reason(install(bare_id, optic, payload["bays"][0]["bay_key"]), 409, "TRANSCEIVER_BINDING_REQUIRED")
    reason(install(object_id, optic, "board"), 409, "MODULE_PLACE_OCCUPIED")
    reason(install(object_id, hardware[1], "direct"), 409, "MODULE_MOUNT_MISMATCH")
    reason(install(object_id, unsupported, "direct"), 409, "UNSUPPORTED_TRANSCEIVER_TERMINATION")
    reason(install(conflict_id, optic, "direct"), 409, "HARDWARE_INTERFACE_ALREADY_BOUND")
    assert package() == before
    with ThreadPoolExecutor(max_workers=2) as workers:
        responses = list(workers.map(lambda _: install(object_id, optic, "direct"), range(2)))
    assert sorted(response.status_code for response in responses) == [201, 409]
    reason(next(response for response in responses if response.status_code == 409), 409, "MODULE_PLACE_OCCUPIED")
    assert len(read(object_id)["bays"][1]["installation"]["endpoints"]) == 1
    assert len(package()["canonical"]["InterfacePhysicalBinding"]) == len(before["canonical"]["InterfacePhysicalBinding"]) + 2


def test_duplex_wiring_preserves_installed_bindings_and_workspace_roundtrip(hardware):
    from tests.l1_builders import create_object_with_point, post_confirmed_physical

    object_id, board, direct = create_installation(hardware)
    optic = created(client.post("/v1/library/module-templates", json=physical_transceiver(
        hardware[-1], members=("Alpha", "Beta"),
    )))
    point = created(install(object_id, optic, "direct"))["bays"][1]["installation"]["endpoints"][0]
    point_id = point["connection_point_id"]
    created(install(object_id, optic, "socket", board["id"]))
    _, peer = create_object_with_point(client, "Peer")
    _, other = create_object_with_point(client, "Other")
    url = "/v1/topology/physical-connections"
    connected = created(post_confirmed_physical(client, url, json={"source": point_end(peer), "target": point_end(other)}))
    reconnect = f"/v1/cables/{connected['cable_ref']['entity_id']}/reconnect"
    reconnect_request = {"side": "A", "new_point_id": point_id, "expected": client.get(reconnect).json()["expected"]}
    pair = {"source": point_end(point_id), "target": point_end(peer)}
    snapshot = package()
    for path, body in (
        (f"{url}/bulk", {"pairs": [pair]}), (f"{url}/bulk?preview=true", {"pairs": [pair]}),
        (reconnect, reconnect_request), (f"{reconnect}/compatibility-preview", reconnect_request),
    ):
        response = client.post(path, json=body)
        assert response.status_code == 422, response.text
    assert package() == snapshot
    _, free_peer = create_object_with_point(client, "Free peer")
    wired = created(post_confirmed_physical(client, url, json={
        "source": {**point_end(point_id), "member_index": 2}, "target": point_end(free_peer),
    }))
    assert wired["source"]["member_index"] == 2
    detail = client.get(f"/v1/topology/physical-objects/{object_id}").json()
    endpoint = next(row for row in detail["connection_points"] if row["connection_point_ref"]["entity_id"] == point_id)
    assert endpoint["members"] == [
        {"index": 1, "designation": "Alpha", "occupied": False},
        {"index": 2, "designation": "Beta", "occupied": True},
    ]
    snapshot = package()
    assert snapshot["format_version"] == 17
    assert client.delete("/v1/workspace/dataset").status_code == 204
    empty = package()
    for mutation in ("missing", "duplicate", "extra", "invalid_member", "foreign_interface",
                     "cardinality", "definition", "association"):
        invalid = copy.deepcopy(snapshot)
        canonical, authoring = invalid["canonical"], invalid["authoring"]
        bindings = canonical["InterfacePhysicalBinding"]
        binding = next(row for row in bindings if row["point_id"] == point_id and row["point_member"] == 2)
        if mutation == "missing":
            bindings.remove(binding)
        elif mutation == "duplicate":
            bindings.append({**binding, "id": str(uuid.uuid4())})
        elif mutation == "extra":
            bindings.append({**binding, "id": str(uuid.uuid4()), "point_id": peer, "point_member": 1})
        elif mutation == "invalid_member":
            binding["point_member"] = 3
        elif mutation == "foreign_interface":
            binding["interface_id"] = board["module_places"][0]["network_interface_id"]
        elif mutation == "cardinality":
            next(row for row in canonical["ConnectionPoint"] if row["id"] == point_id)["cardinality"] = 1
        elif mutation == "definition":
            next(row for row in authoring["ModuleEndpointMapping"] if row["connection_point_id"] == point_id)[
                "definition_id"] = board["endpoints"][0]["definition_id"]
        else:
            next(row for row in authoring["HardwareInterfaceAssociation"] if row["interface_id"] == direct["network_interface_id"])[
                "hardware_interface_key"] = str(uuid.uuid4())
        result = client.post("/v1/workspace/package", json=invalid)
        assert result.status_code == 422, (mutation, result.text)
        assert package() == empty
    restored = client.post("/v1/workspace/package", json=snapshot)
    assert restored.status_code == 204, restored.text
    assert package() == snapshot
    assert client.delete(f"{url}/{wired['connection_ref']['entity_id']}").status_code == 204
    disconnected = package()
    assert disconnected["canonical"]["InterfacePhysicalBinding"] == snapshot["canonical"]["InterfacePhysicalBinding"]
    assert disconnected["authoring"] == snapshot["authoring"]


def test_failed_second_member_rolls_back_duplex_installation(hardware, monkeypatch):
    object_id, _, _ = create_installation(hardware)
    optic = created(client.post("/v1/library/module-templates", json=physical_transceiver(
        hardware[-1], members=("Alpha", "Beta"),
    )))
    before = package()
    add_binding = CanonicalRepository.add_interface_physical_binding

    def fail_second(repository, interface_id, point_id, *, point_member):
        if point_member == 2:
            raise ModelError("Injected failure", {"reason": "TEST_BINDING_FAILURE"})
        return add_binding(repository, interface_id, point_id, point_member=point_member)

    monkeypatch.setattr(CanonicalRepository, "add_interface_physical_binding", fail_second)
    reason(install(object_id, optic, "direct"), 409, "TEST_BINDING_FAILURE")
    assert package() == before
