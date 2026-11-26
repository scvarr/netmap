import copy
import uuid
from concurrent.futures import ThreadPoolExecutor
from time import monotonic, sleep

import pytest
from sqlalchemy import delete, event, text

from app.database import SessionLocal
from app.errors import ModelError
from app.models import Cable, Connection, InterfacePhysicalBinding, L2Binding, L2ForwardingContext, Location, PhysicalObject, PortType
from app.module_installation_deletion import ModuleInstallationDeletionCatalog
from app.physical_connections import ConnectionPointEndpoint, PhysicalConnectionCatalog
from app.repository import CanonicalRepository, ConnectionMemberInput
from app.schemas import CableReconnectRequest, PhysicalCompatibilityConfirmation, ReplaceTransceiverRequest
from tests.l1_builders import confirmed_payload, create_object_with_point, post_confirmed_physical
from tests.test_hardware_configuration import base_payload, client, create_base, create_object
from tests.test_module_reconciliation import apply, package, revision
from tests.test_module_uninstall import uninstall
from tests.test_nested_module_installations import created, install, physical_transceiver, read, reason
from tests.test_parent_hardware_interfaces import create_installation, hardware
from tests.test_physical_compatibility_e2e import typed_points


def point_end(point_id):
    return {"kind": "CONNECTION_POINT", "connection_point_id": point_id, "member_index": 1}


def replacement_input(config, socket, installed, target, board=None):
    return {
        "configuration_id": config["configuration_id"], "base_revision_id": config["base_revision_id"],
        "bay_key": socket["bay_key"], "parent_installation_id": board["id"] if board else None,
        "parent_revision_id": board["module_revision_id"] if board else None,
        "source_revision_id": installed["module_revision_id"],
        "source_point_id": installed["endpoints"][0]["connection_point_id"],
        "interface_id": socket["network_interface_id"], "module_template_id": target["template_id"],
        "target_revision_id": target["revision_id"],
    }


def replace(object_id, installation_id, body):
    return client.post(f"/v1/topology/physical-objects/{object_id}/module-installations/{installation_id}/replacement", json=body)


@pytest.mark.parametrize("nested,old_members,new_members,mapping", [
    (False, ("A",), ("B",), {}),
    (True, ("A", "B"), ("C", "D"), {}),
    (False, ("A",), ("B", "C"), {}),
    (True, ("A", "B"), ("C",), {}),
    (True, ("A",), ("B",), {1: 1}),
    (False, ("A",), ("B", "C"), {1: 2}),
    (True, ("A", "B"), ("C",), {2: 1}),
    (False, ("A", "B"), ("C", "D"), {1: 1, 2: 2}),
    (True, ("A", "B"), ("C", "D"), {1: 2, 2: 1}),
])
def test_transceiver_replacement_preserves_interface_and_reprojects(hardware, nested, old_members, new_members, mapping):
    object_id, board, direct = create_installation(hardware)
    socket = board["module_places"][0] if nested else direct
    parent = board if nested else None
    old = created(client.post("/v1/library/module-templates", json=physical_transceiver(hardware[-1], members=old_members)))
    new = created(client.post("/v1/library/module-templates", json={
        **physical_transceiver(hardware[-1], members=new_members, port_name="Replacement termination"), "name": "New optic",
    }))
    config = created(install(object_id, old, socket["bay_key"], parent["id"] if parent else None))
    installed = config["nested_installations"][0] if nested else config["bays"][1]["installation"]
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface_id = uuid.UUID(socket["network_interface_id"])
        context = L2ForwardingContext()
        session.add(context)
        session.flush()
        session.add(L2Binding(interface_id=interface_id, forwarding_context_id=context.id))
        repository.add_l3_binding(interface_id, repository.add_routing_context().id)
    body = replacement_input(config, socket, installed, new, parent)
    cable_ids = {}
    for old_index in mapping:
        _, peer = create_object_with_point(client, f"Peer {old_index}")
        local = {**point_end(body["source_point_id"]), "member_index": old_index}
        source, target = (local, point_end(peer)) if old_index == 1 else (point_end(peer), local)
        linked = created(post_confirmed_physical(client, "/v1/topology/physical-connections", json={
            "source": source, "target": target, "cable_label": f"Patch {old_index}",
            "fiber_type": "SM" if old_index == 1 else "MM",
        }))
        cable_ids[old_index] = linked["cable_ref"]["entity_id"]
    before = package()
    if mapping:
        body["cable_assignments"] = [
            {"cable_id": cable_ids[old_index], "member_index": new_index} for old_index, new_index in mapping.items()
        ]
        preview = replacement_preview(object_id, installed["id"], body)
        assert preview["compatibility"]["verdict"] == "UNKNOWN"
        assert {cable["local"]["member_index"] for cable in preview["cables"]} == mapping.keys()
        assert package() == before
        unconfirmed = {**body, "compatibility": {"token": preview["compatibility"]["token"], "accept_unknown": False}}
        assert replace(object_id, installed["id"], unconfirmed).json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_CONFIRMATION_REQUIRED"
        assert package() == before
        body = confirmed_payload(preview["compatibility"], body)
    result = replace(object_id, installed["id"], body)
    assert result.status_code == 200, result.text
    config = result.json()
    replacement = config["nested_installations"][0] if nested else config["bays"][1]["installation"]
    endpoint, = replacement["endpoints"]
    assert replacement["id"] != installed["id"]
    assert replacement["module_revision_id"] == new["revision_id"]
    assert replacement["parent_installation_id"] == body["parent_installation_id"]
    assert replacement["bay_key"] == installed["bay_key"]
    assert endpoint["members"] == list(new_members)
    point_id = endpoint["connection_point_id"]
    assert point_id != body["source_point_id"]
    after = package()
    for table in ("PhysicalObject", "NetworkInterface", "NetworkInterfacePhysicalOwner", "L2Binding", "L3Binding"):
        assert after["canonical"][table] == before["canonical"][table]
    for table in ("ObjectConfiguration", "HardwareInterfaceAssociation"):
        assert after["authoring"][table] == before["authoring"][table]
    assert after["canonical"]["Cable"] == before["canonical"]["Cable"]
    connections = {row["id"]: row for row in before["canonical"]["Connection"]}
    members = {row["connection_id"]: row for row in before["canonical"]["ConnectionMember"]}
    for old_index, cable_id in cable_ids.items():
        row, = [row for row in before["canonical"]["Cable"] if row["id"] == cable_id]
        assert row["fiber_type"] == ("SM" if old_index == 1 else "MM")
        connection_id = row["connection_id"]
        side = "a" if old_index == 1 else "b"
        connections[connection_id][f"point_{side}_id"] = point_id
        members[connection_id][f"point_{side}_member"] = mapping[old_index]
    assert after["canonical"]["Connection"] == list(connections.values())
    assert after["canonical"]["ConnectionMember"] == list(members.values())
    assert [row for row in after["authoring"]["ModuleInstallation"] if row["id"] != replacement["id"]] == [
        row for row in before["authoring"]["ModuleInstallation"] if row["id"] != installed["id"]
    ]
    for table, field in (("ConnectionPoint", "id"), ("InterfacePhysicalBinding", "point_id"),
                         ("EntityMetadata", "connection_point_id")):
        assert all(row.get(field) != body["source_point_id"] for row in after["canonical"][table])
    assert all(row["connection_point_id"] != body["source_point_id"] for row in after["authoring"]["ModuleEndpointMapping"])
    assert {(row["interface_id"], row["point_member"]) for row in after["canonical"]["InterfacePhysicalBinding"]
            if row["point_id"] == point_id} == {(body["interface_id"], i) for i in range(1, len(new_members) + 1)}
    projection = client.post("/v1/topology/projection", json={
        "layer": "L1", "detail_level": "PHYSICAL_OBJECT",
        "scope": {"include_location_subtrees": [], "include_entities": []},
    })
    assert projection.status_code == 200, projection.text
    slots = [slot for node in projection.json()["nodes"]
             for slot in node["attributes"].get("blueprint_presentation", {}).get("slots", [])]
    assert body["source_point_id"] not in {slot["connection_point_id"] for slot in slots}
    slot, = [slot for slot in slots if slot["connection_point_id"] == point_id]
    assert slot["installation_id"] == replacement["id"]
    assert slot["external_attachment"]
    if mapping:
        assert_cable_blockers(object_id, endpoint, set(mapping.values()))
        edge_pairs = {pair["cable_ref"]["entity_id"]: pair for edge in projection.json()["edges"]
                      for pair in edge["attributes"].get("endpoint_pairs", [])}
        for old_index, cable_id in cable_ids.items():
            pair = edge_pairs[cable_id]
            projected = {(pair[f"{side}_connection_point_id"], pair[f"{side}_member_index"])
                         for side in ("from", "to")}
            connection = connections[pair["connection_id"]]
            member = members[connection["id"]]
            assert pair["connection_member_id"] == member["id"]
            assert projected == {(connection[f"point_{side}_id"], member[f"point_{side}_member"])
                                 for side in ("a", "b")}
    reason(replace(object_id, installed["id"], body), 409, "INSTALLATION_CHANGED")
    assert package() == after


def replacement_preview(object_id, installation_id, body, status=200):
    result = client.post(
        f"/v1/topology/physical-objects/{object_id}/module-installations/{installation_id}/replacement?preview=true",
        json=body,
    )
    assert result.status_code == status, result.text
    return result.json()


def connected_optic(hardware, *, duplex=False, typed_peer=False):
    object_id, _, socket = create_installation(hardware)
    definition = physical_transceiver(hardware[-1], members=("Tx", "Rx") if duplex else ("Tx",))
    optic = created(client.post("/v1/library/module-templates", json=definition))
    config = created(install(object_id, optic, "direct"))
    installed = config["bays"][1]["installation"]
    target = created(client.post("/v1/library/module-templates", json={**definition, "name": "Target optic"}))
    body = replacement_input(config, socket, installed, target)
    cable_ids = []
    for index in range(1, 3 if duplex else 2):
        if typed_peer:
            _, (peer,) = typed_points(f"Peer {index}", definition["endpoints"][0]["port_type_id"])
        else:
            _, peer = create_object_with_point(client, f"Peer {index}")
        cable_ids.append(created(post_confirmed_physical(client, "/v1/topology/physical-connections", json={
            "source": {**point_end(body["source_point_id"]), "member_index": index}, "target": point_end(peer),
        }))["cable_ref"]["entity_id"])
    body["cable_assignments"] = [{"cable_id": cable_id, "member_index": index}
                                for index, cable_id in enumerate(cable_ids, 1)]
    return object_id, installed["id"], body, cable_ids


def test_connected_replacement_rejects_invalid_mappings_and_other_dependencies(hardware):
    object_id, installation, body, cables = connected_optic(hardware, duplex=True)
    before = package()
    first, second = body["cable_assignments"]
    for assignments, status in [
        ([first], 409),
        ([first, second, {"cable_id": str(uuid.uuid4()), "member_index": 3}], 409),
        ([first, {**second, "cable_id": cables[0]}], 422),
        ([first, {**second, "member_index": 1}], 422),
        ([first, {**second, "member_index": 3}], 422),
    ]:
        replacement_preview(object_id, installation, {**body, "cable_assignments": assignments}, status)
        assert package() == before
    simplex = created(client.post("/v1/library/module-templates", json=physical_transceiver(hardware[-1])))
    replacement_preview(object_id, installation, {
        **body, "module_template_id": simplex["template_id"], "target_revision_id": simplex["revision_id"],
    }, 422)
    assert package()["canonical"] == before["canonical"]
    with SessionLocal.begin() as session:
        session.execute(delete(InterfacePhysicalBinding).where(
            InterfacePhysicalBinding.point_id == uuid.UUID(body["source_point_id"]),
            InterfacePhysicalBinding.point_member == 1,
        ))
    blocked = package()
    result = replacement_preview(object_id, installation, body, 409)
    assert result["error"]["details"]["blockers"] == {"CONNECTION": 2, "INTERFACE_PHYSICAL_BINDING": 1}
    assert package() == blocked


def test_connected_replacement_uses_existing_allow_and_deny_rules(hardware):
    object_id, installation, body, _ = connected_optic(hardware, typed_peer=True)
    incompatible = created(client.post("/v1/library/module-templates", json=physical_transceiver(
        hardware[-1], port_name="Incompatible termination",
    )))
    denied = {**body, "module_template_id": incompatible["template_id"], "target_revision_id": incompatible["revision_id"]}
    before = package()
    check = replacement_preview(object_id, installation, denied)["compatibility"]
    assert check["verdict"] == "DENY" and check["token"] is None
    assert replace(object_id, installation, denied).json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_DENIED"
    check = replacement_preview(object_id, installation, body)["compatibility"]
    assert check["verdict"] == "ALLOW"
    assert replace(object_id, installation, body).json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_STALE"
    assert package() == before
    assert replace(object_id, installation, confirmed_payload(check, body)).status_code == 200


@pytest.mark.parametrize("change", ["label", "remove", "add", "reconnect", "publication", "port_rule"])
def test_connected_replacement_requires_fresh_preview(hardware, change):
    object_id, installation, body, cables = connected_optic(hardware, duplex=True)
    if change == "add":
        assert client.delete(f"/v1/cables/{cables[1]}").status_code == 204
        body["cable_assignments"].pop()
    check = replacement_preview(object_id, installation, body)["compatibility"]
    if change == "label":
        assert client.put(f"/v1/cables/{cables[0]}/label", json={"label": "Changed"}).status_code == 204
    elif change == "remove":
        assert client.delete(f"/v1/cables/{cables[0]}").status_code == 204
    elif change == "add":
        _, peer = create_object_with_point(client, "Extra peer")
        created(post_confirmed_physical(client, "/v1/topology/physical-connections", json={
            "source": {**point_end(body["source_point_id"]), "member_index": 2}, "target": point_end(peer),
        }))
    elif change == "reconnect":
        _, peer = create_object_with_point(client, "New peer")
        url = f"/v1/cables/{cables[0]}/reconnect"
        response = post_confirmed_physical(client, url, json={
            "side": "B", "new_point_id": peer, "new_member_index": 1, "expected": client.get(url).json()["expected"],
        })
        assert response.status_code == 204, response.text
    elif change == "publication":
        revision(body["module_template_id"], lambda definition: definition.update(name="New publication"))
    else:
        with SessionLocal.begin() as session:
            session.query(PortType).filter(PortType.members == ["Tx", "Rx"]).one().compatibility_mode = "UNDEFINED"
    before = package()
    response = replace(object_id, installation, confirmed_payload(check, body))
    assert response.status_code == 409, response.text
    assert package() == before


def test_connected_replacement_conflicts_with_cable_lock_and_rolls_back_second_move(hardware):
    object_id, installation, body, cables = connected_optic(hardware, duplex=True)
    check = replacement_preview(object_id, installation, body)["compatibility"]
    body = confirmed_payload(check, body)
    before = package()
    with SessionLocal.begin() as session:
        session.get(Cable, uuid.UUID(cables[0]), with_for_update=True)
        reason(replace(object_id, installation, body), 409, "TRANSCEIVER_REPLACEMENT_BUSY")
    assert package() == before

    class SecondMoveFailed(Exception):
        pass

    updated = []
    with pytest.raises(SecondMoveFailed), SessionLocal.begin() as session:
        @event.listens_for(session, "after_flush")
        def fail_after_first_transfer(session, context):
            updated.extend(row.id for row in session.dirty if isinstance(row, Connection))
        @event.listens_for(session, "before_flush")
        def reject_second_transfer(session, context, instances):
            if len(updated) == 1 and any(isinstance(row, Connection) for row in session.dirty):
                raise SecondMoveFailed

        ModuleInstallationDeletionCatalog(session).replace_transceiver(
            uuid.UUID(object_id), uuid.UUID(installation), ReplaceTransceiverRequest.model_validate(body),
        )
    assert len(updated) == 1
    assert package() == before
    cable_url = f"/v1/cables/{cables[0]}/reconnect"
    expected = client.get(cable_url).json()["expected"]
    with ThreadPoolExecutor(max_workers=1) as worker:
        with SessionLocal.begin() as session:
            pid = session.scalar(text("SELECT pg_backend_pid()"))
            ModuleInstallationDeletionCatalog(session).replace_transceiver(
                uuid.UUID(object_id), uuid.UUID(installation), ReplaceTransceiverRequest.model_validate(body),
            )
            # Other sessions see the old complete graph until commit.
            assert package() == before
            reconnect = client.post(cable_url, json={
                "side": "A", "new_point_id": body["source_point_id"], "new_member_index": 2, "expected": expected,
            })
            assert reconnect.json()["error"]["code"] == "CABLE_RECONNECT_CONFLICT"
            competing = worker.submit(replace, object_id, installation, body)
            wait_for_blocked_transaction(pid)
        reason(competing.result(timeout=5), 409, "INSTALLATION_CHANGED")


def test_transceiver_replacement_requires_confirmed_publication_and_socket(hardware):
    object_id, _, socket = create_installation(hardware)
    optic = created(client.post("/v1/library/module-templates", json=physical_transceiver(hardware[-1])))
    config = created(install(object_id, optic, socket["bay_key"]))
    installed = config["bays"][1]["installation"]
    body = replacement_input(config, socket, installed, optic)
    before = package()
    result = replace(object_id, installed["id"], body)
    assert result.status_code == 200, result.text
    assert result.json() == config
    assert package() == before
    reason(replace(object_id, installed["id"], {**body, "bay_key": "other"}), 409, "INSTALLATION_CHANGED")
    wrong = hardware[1]
    reason(replace(object_id, installed["id"], replacement_input(config, socket, installed, wrong)),
           409, "MODULE_MOUNT_MISMATCH")
    assert package() == before
    published = revision(optic["template_id"], lambda d: d.update(name="Optic v2"))
    after_publish = package()
    reason(replace(object_id, installed["id"], body), 409, "TARGET_REVISION_CHANGED")
    assert package() == after_publish
    result = replace(object_id, installed["id"], {**body, "target_revision_id": published["revision_id"]})
    assert result.status_code == 200, result.text
    installed_v2 = result.json()["bays"][1]["installation"]
    assert installed_v2["module_revision_id"] == published["revision_id"]
    assert installed_v2["id"] != installed["id"]


@pytest.mark.parametrize("nested", [False, True])
@pytest.mark.parametrize("members", [("1",), ("Alpha", "Beta")])
def test_install_and_protect_physical_transceiver(hardware, nested, members):
    object_id, board, direct = create_installation(hardware)
    socket = board["module_places"][0] if nested else direct
    parent_id = board["id"] if nested else None
    optic = created(client.post("/v1/library/module-templates", json=physical_transceiver(hardware[-1], members=members)))
    interface_id = uuid.UUID(socket["network_interface_id"])
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = L2ForwardingContext()
        session.add(context)
        session.flush()
        session.add(L2Binding(interface_id=interface_id, forwarding_context_id=context.id))
        repository.add_l3_binding(interface_id, repository.add_routing_context().id)
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
    response = uninstall(object_id, installed["id"])
    assert response.status_code == 200, response.text
    emptied = response.json()
    removed_snapshot = package()
    assert removed_snapshot["canonical"] == before["canonical"]
    for table in ("HardwareInterfaceAssociation", "ModuleInstallation", "ModuleEndpointMapping"):
        assert removed_snapshot["authoring"][table] == before["authoring"][table]
    freed = emptied["bays"][0]["installation"]["module_places"][0] if nested else emptied["bays"][1]
    assert freed["network_interface_id"] == str(interface_id)
    assert freed["installation_id" if nested else "installation"] is None
    reinstalled = created(install(object_id, optic, socket["bay_key"], parent_id))
    replacement = reinstalled["nested_installations"][0] if nested else reinstalled["bays"][1]["installation"]
    assert replacement["id"] != installed["id"]
    new_point = replacement["endpoints"][0]["connection_point_id"]
    assert new_point != point_id
    new_snapshot = package()
    assert {b["interface_id"] for b in new_snapshot["canonical"]["InterfacePhysicalBinding"] if b["point_id"] == new_point} == {str(interface_id)}
    assert uninstall(object_id, replacement["id"]).status_code == 200


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
    cable, = assert_cable_blockers(object_id, a, {1})
    assert cable["label"] is None
    assert cable["cable_id"] == connected["cable_ref"]["entity_id"]
    assert cable["local"]["point_label"] == "Board / socket / Optical"
    assert cable["remote"]["point_label"] == f"{hardware[2]['display_name']} / Optical"
    assert cable["remote"]["point_id"] == b["connection_point_id"]
    assert (cable["local"]["cardinality"], cable["remote"]["cardinality"]) == (1, 1)
    assert package() == snapshot
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
    object_id, board, direct = create_installation(hardware)
    optic = created(client.post("/v1/library/module-templates", json=physical_transceiver(
        hardware[-1], members=("Alpha", "Beta"),
    )))
    config = created(install(object_id, optic, "direct"))
    installation = config["bays"][1]["installation"]
    target = created(client.post("/v1/library/module-templates", json=physical_transceiver(hardware[-1])))
    replacement = replacement_input(config, direct, installation, target)
    point = installation["endpoints"][0]
    point_id = point["connection_point_id"]
    created(install(object_id, optic, "socket", board["id"]))
    _, peer = create_object_with_point(client, "Peer")
    other_id, other_board, _ = create_installation(hardware)
    other = created(install(other_id, optic, "socket", other_board["id"]))["nested_installations"][0]["endpoints"][0]
    url = "/v1/topology/physical-connections"
    connected = created(post_confirmed_physical(client, url, json={
        "source": point_end(peer), "target": {**point_end(other["connection_point_id"]), "member_index": 2},
        "cable_label": "Patch 12",
    }))
    reconnect = f"/v1/cables/{connected['cable_ref']['entity_id']}/reconnect"
    reconnect_request = {"side": "A", "new_point_id": point_id, "expected": client.get(reconnect).json()["expected"]}
    pair = {
        "source": {"kind": "CONNECTION_POINT", "connection_point_id": point_id},
        "target": point_end(peer),
    }
    snapshot = package()
    for path, body in (
        (f"{url}/bulk", {"pairs": [pair]}), (f"{url}/bulk?preview=true", {"pairs": [pair]}),
        (reconnect, reconnect_request), (f"{reconnect}/compatibility-preview", reconnect_request),
    ):
        response = client.post(path, json=body)
        assert response.status_code == 422, response.text
    assert package() == snapshot
    free_owner, free_peer = create_object_with_point(client, "Free peer")
    with SessionLocal.begin() as session:
        campus = Location(name="Campus")
        room = Location(name="Room 42", parent=campus)
        session.get(PhysicalObject, uuid.UUID(free_owner)).location = room
    (wired,) = created(post_confirmed_physical(client, f"{url}/bulk", json={"pairs": [{
        "source": {**point_end(point_id), "member_index": 2}, "target": point_end(free_peer),
    }]}))["created"]
    assert wired["source_member_index"] == 2
    before = package()
    cables = assert_cable_blockers(object_id, point, {2})
    response = replace(object_id, installation["id"], replacement)
    reason(response, 409, "MODULE_INSTALLATION_IN_USE")
    assert response.json()["error"]["details"]["blocking_cables"] == cables
    assert package() == before
    moved = post_confirmed_physical(client, reconnect, json={**reconnect_request, "new_member_index": 1})
    assert moved.status_code == 204, moved.text
    after = package()
    expected = reconnect_request["expected"]
    for row in before["canonical"]["Connection"]:
        if row["id"] == expected["connection_id"]:
            row["point_a_id"] = point_id
    for row in before["canonical"]["ConnectionMember"]:
        if row["id"] == expected["connection_member_id"]:
            row["point_a_member"] = 1
    assert after == before
    cables = assert_cable_blockers(object_id, point, {1, 2})
    response = replace(object_id, installation["id"], replacement)
    reason(response, 409, "MODULE_INSTALLATION_IN_USE")
    assert response.json()["error"]["details"]["blocking_cables"] == cables
    by_member = {cable["local"]["member_index"]: cable for cable in cables}
    for index, expected_name in ((1, "Alpha"), (2, "Beta")):
        assert by_member[index]["local"]["members"][index - 1] == {"index": index, "designation": expected_name}
        assert by_member[index]["local"]["point_label"] == f"{direct['display_name']} / Optical"
    remote_optic = by_member[1]["remote"]
    assert remote_optic["object_id"] == other_id
    assert remote_optic["object_label"] == "Server"
    assert remote_optic["point_label"] == "Board / socket / Optical"
    assert remote_optic["panel"]["name"] == "Панель"
    assert remote_optic["member_index"] == 2
    assert remote_optic["members"][1]["designation"] == "Beta"
    assert by_member[1]["label"] == "Patch 12"
    assert by_member[2]["label"] is None
    remote = by_member[2]["remote"]
    assert remote["object_label"] == "Free peer"
    assert remote["point_label"] == "p1"
    assert remote["object_id"] == free_owner
    assert [part["name"] for part in remote["location_path"]] == ["Campus", "Room 42"]
    assert package() == after
    detail = client.get(f"/v1/topology/physical-objects/{object_id}").json()
    endpoint = next(row for row in detail["connection_points"] if row["connection_point_ref"]["entity_id"] == point_id)
    assert endpoint["members"] == [
        {"index": 1, "designation": "Alpha", "occupied": True},
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
    assert client.get(reconnect).json()["expected"] == {**expected, "point_a_id": point_id, "point_a_member": 1}
    assert client.delete(f"{url}/{wired['connection_id']}").status_code == 204
    disconnected = package()
    assert disconnected["canonical"]["InterfacePhysicalBinding"] == snapshot["canonical"]["InterfacePhysicalBinding"]
    assert disconnected["authoring"] == snapshot["authoring"]


def assert_cable_blockers(object_id, endpoint, members):
    response = uninstall(object_id, endpoint["installation_id"])
    reason(response, 409, "MODULE_INSTALLATION_IN_USE")
    cables = response.json()["error"]["details"]["blocking_cables"]
    assert {cable["local"]["member_index"] for cable in cables} == members
    assert len({cable["cable_id"] for cable in cables}) == len(members)
    assert all(cable["connection_id"] and cable["connection_member_id"] for cable in cables)
    assert all(cable["local"]["point_id"] == endpoint["connection_point_id"] for cable in cables)
    return cables


def test_blocking_cable_address_for_board_on_rear_panel(hardware):
    object_id, _, _ = create_installation(hardware)
    definition = physical_transceiver(hardware[-1])
    optic = created(client.post("/v1/library/module-templates", json=definition))
    local = created(install(object_id, optic, "direct"))["bays"][1]["installation"]["endpoints"][0]

    mount = {"mount_kind": "MODULE_BAY", "module_bay_type_id": hardware[1]["module_bay_type_id"]}
    payload = base_payload()
    panel = payload["panels"][0]
    panel.update(face="REAR", display_name="Rear patch panel")
    payload["bays"] = [{**mount, "bay_key": "card", "display_name": "Uplink slot",
                        "panel_key": panel["panel_key"], "kind": "LOGICAL"}]
    base, _ = create_base(payload)
    other_id = create_object(base)["physical_object_ref"]["entity_id"]
    card = created(client.post("/v1/library/module-templates", json={
        **mount, "name": "Uplink card", "geometry": definition["geometry"],
        "endpoints": [{**definition["endpoints"][0], "display_name": "LC uplink"}],
    }))
    remote = created(install(other_id, card, "card"))["bays"][0]["installation"]["endpoints"][0]
    created(post_confirmed_physical(client, "/v1/topology/physical-connections", json={
        "source": point_end(remote["connection_point_id"]), "target": point_end(local["connection_point_id"]),
    }))
    cable, = assert_cable_blockers(object_id, local, {1})
    address = cable["remote"]
    assert address["point_label"] == "Uplink slot / LC uplink"
    assert address["panel"]["name"] == "Rear patch panel"
    assert address["panel"]["face"] == "REAR"


@pytest.mark.parametrize("blocker", ["CONNECTION", "INTERFACE_PHYSICAL_BINDING"])
def test_transceiver_refuses_non_cable_dependencies_without_changes(hardware, blocker):
    object_id, _, socket = create_installation(hardware)
    optic = created(client.post("/v1/library/module-templates", json=physical_transceiver(hardware[-1])))
    config = created(install(object_id, optic, "direct"))
    installed = config["bays"][1]["installation"]
    target = created(client.post("/v1/library/module-templates", json=physical_transceiver(hardware[-1], port_name="Replacement termination")))
    point_id = uuid.UUID(installed["endpoints"][0]["connection_point_id"])
    with SessionLocal.begin() as session:
        if blocker == "CONNECTION":
            repository = CanonicalRepository(session)
            peer = repository.add_connection_point(uuid.UUID(object_id), cardinality=1)
            repository.add_connection(point_id, peer.id, 1, [ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)])
        else:
            session.execute(delete(InterfacePhysicalBinding).where(InterfacePhysicalBinding.point_id == point_id))
    before = package()
    response = uninstall(object_id, installed["id"])
    reason(response, 409, "MODULE_INSTALLATION_IN_USE")
    assert response.json()["error"]["details"]["blockers"] == {blocker: 1}
    response = replace(object_id, installed["id"], replacement_input(config, socket, installed, target))
    reason(response, 409, "MODULE_INSTALLATION_IN_USE")
    assert response.json()["error"]["details"]["blockers"] == {blocker: 1}
    assert package() == before


def wait_for_blocked_transaction(pid):
    deadline = monotonic() + 5
    with SessionLocal() as observer:
        while monotonic() < deadline:
            observer.execute(text("SELECT pg_stat_clear_snapshot()"))
            if observer.scalar(text("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE :pid = ANY(pg_blocking_pids(pid)))"), {"pid": pid}):
                return
            sleep(0.02)
    pytest.fail("Competing write did not wait for the ConnectionPoint lock")


@pytest.mark.parametrize("replacing", [False, True])
@pytest.mark.parametrize("first", ["remove", "create"])
@pytest.mark.parametrize("reconnect", [False, True])
def test_transceiver_lifecycle_serializes_with_cable_writes(hardware, first, reconnect, replacing):
    object_id, _, socket = create_installation(hardware)
    optic = created(client.post("/v1/library/module-templates", json=physical_transceiver(hardware[-1])))
    config = created(install(object_id, optic, "direct"))
    installed = config["bays"][1]["installation"]
    target = created(client.post("/v1/library/module-templates", json=physical_transceiver(
        hardware[-1], port_name="Replacement termination"))) if replacing else None
    replacement = replacement_input(config, socket, installed, target) if target else None
    point = installed["endpoints"][0]["connection_point_id"]
    _, peer = create_object_with_point(client, "Peer")
    url = "/v1/topology/physical-connections"
    payload = {"source": point_end(point), "target": point_end(peer)}
    if reconnect:
        _, other = create_object_with_point(client, "Other")
        cable = created(post_confirmed_physical(client, url, json={"source": point_end(other), "target": point_end(peer)}))
        cable_id = cable["cable_ref"]["entity_id"]
        url = f"/v1/cables/{cable_id}/reconnect"
        payload = {"side": "A", "new_point_id": point, "expected": client.get(url).json()["expected"]}
    preview = client.post(f"{url}/compatibility-preview" if reconnect else f"{url}?preview=true", json=payload)
    assert preview.status_code == 200, preview.text
    payload = confirmed_payload(preview.json(), payload)
    with ThreadPoolExecutor(max_workers=1) as worker:
        with SessionLocal.begin() as session:
            pid = session.scalar(text("SELECT pg_backend_pid()"))
            if first == "remove":
                lifecycle = ModuleInstallationDeletionCatalog(session)
                if replacing:
                    lifecycle.replace_transceiver(uuid.UUID(object_id), uuid.UUID(installed["id"]),
                                                  ReplaceTransceiverRequest.model_validate(replacement))
                else:
                    lifecycle.delete(uuid.UUID(object_id), uuid.UUID(installed["id"]))
                competing = worker.submit(client.post, url, json=payload)
                if reconnect:
                    response = competing.result(timeout=5)
                    assert response.status_code == 409, response.text
                    assert response.json()["error"]["code"] == "CABLE_RECONNECT_CONFLICT"
            else:
                catalog = PhysicalConnectionCatalog(session)
                if reconnect:
                    catalog.reconnect_cable(uuid.UUID(cable_id), CableReconnectRequest.model_validate(payload))
                else:
                    catalog.create_endpoint_link(
                        ConnectionPointEndpoint(uuid.UUID(point), 1), ConnectionPointEndpoint(uuid.UUID(peer), 1),
                        compatibility=PhysicalCompatibilityConfirmation.model_validate(payload["compatibility"]),
                    )
                competing = (worker.submit(replace, object_id, installed["id"], replacement) if replacing
                             else worker.submit(uninstall, object_id, installed["id"]))
            if not reconnect or first != "remove":
                wait_for_blocked_transaction(pid)
        response = competing.result(timeout=5)
    if first == "remove":
        if reconnect:
            response = client.post(url, json=payload)
            assert client.get(url).json()["expected"] == payload["expected"]
        assert response.status_code == 422, response.text
        actual = read(object_id)["bays"][1]["installation"]
        if replacing:
            assert actual["module_revision_id"] == target["revision_id"]
            assert actual["endpoints"][0]["connection_point_id"] != point
        else:
            assert actual is None
    else:
        reason(response, 409, "MODULE_INSTALLATION_IN_USE")
        assert read(object_id)["bays"][1]["installation"] == installed
    assert len(package()["canonical"]["Cable"]) == (reconnect or first == "create")


@pytest.mark.parametrize("replacing", [False, True])
def test_failed_second_member_rolls_back_duplex_installation(hardware, monkeypatch, replacing):
    object_id, _, socket = create_installation(hardware)
    optic = created(client.post("/v1/library/module-templates", json=physical_transceiver(
        hardware[-1], members=("Alpha", "Beta"),
    )))
    if replacing:
        source = created(client.post("/v1/library/module-templates", json=physical_transceiver(hardware[-1])))
        config = created(install(object_id, source, "direct"))
        installed = config["bays"][1]["installation"]
    before = package()
    add_binding = CanonicalRepository.add_interface_physical_binding

    def fail_second(repository, interface_id, point_id, *, point_member):
        if point_member == 2:
            raise ModelError("Injected failure", {"reason": "TEST_BINDING_FAILURE"})
        return add_binding(repository, interface_id, point_id, point_member=point_member)

    monkeypatch.setattr(CanonicalRepository, "add_interface_physical_binding", fail_second)
    response = (replace(object_id, installed["id"], replacement_input(config, socket, installed, optic))
                if replacing else install(object_id, optic, "direct"))
    reason(response, 409, "TEST_BINDING_FAILURE")
    assert package() == before
