import copy
import uuid

import pytest
from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models import HardwareInterfaceAssociation
from app.repository import CanonicalRepository
from tests import test_base_template_review as base_review
from tests.cable_type_fixtures import copper_cable_fields
from tests.test_base_template_publication import publish
from tests.test_hardware_configuration import base_payload, client, create_base, create_object
from tests.test_module_reconciliation import apply, package, revision
from tests.test_module_uninstall import uninstall
from tests.test_nested_module_installations import (
    bay_mount, created, install, module, place, read, reason,
)
from tests.test_object_reconciliation import reconcile


@pytest.fixture
def hardware():
    payload = base_payload()
    direct = payload["bays"][0]
    direct.update(bay_key="direct", hardware_interface_key=str(uuid.uuid4()))
    board_mount = bay_mount("PCIe")
    payload["bays"].append({
        **board_mount, "bay_key": "board", "display_name": "Board",
        "panel_key": direct["panel_key"], "kind": "LOGICAL",
    })
    base, _ = create_base(payload)
    sfp = {"mount_kind": direct["mount_kind"], "module_port_type_id": direct["module_port_type_id"]}
    socket = {**place("socket", sfp), "hardware_interface_key": str(uuid.uuid4())}
    card = module("Board", board_mount, [socket], has_endpoint=True)
    return base, card, direct, socket, sfp


def create_installation(hardware):
    base, card, _, _, _ = hardware
    object_id = create_object(base)["physical_object_ref"]["entity_id"]
    tree = created(install(object_id, card, "board"))
    return object_id, tree["bays"][0]["installation"], tree["bays"][1]


def test_empty_ports_have_distinct_owned_interfaces_and_no_physical_endings(hardware):
    object_id, board, direct = create_installation(hardware)
    _, _, declaration, socket, sfp = hardware
    child, = board["module_places"]
    assert child["installation_id"] is None and direct["installation"] is None
    assert direct["hardware_interface_key"] == declaration["hardware_interface_key"]
    assert child["hardware_interface_key"] == socket["hardware_interface_key"]
    declared_ids = {direct["network_interface_id"], child["network_interface_id"]}
    assert len(declared_ids) == 2
    snapshot = package()
    canonical = snapshot["canonical"]
    assert len(canonical["NetworkInterface"]) == 4  # Two declarations and two NETWORK_PORTs.
    assert len(canonical["ConnectionPoint"]) == len(canonical["InterfacePhysicalBinding"]) == 2
    assert declared_ids.isdisjoint(row["interface_id"] for row in canonical["InterfacePhysicalBinding"])
    assert {row["physical_object_id"] for row in canonical["NetworkInterfacePhysicalOwner"]} == {object_id}
    associations = {row["interface_id"]: row for row in snapshot["authoring"]["HardwareInterfaceAssociation"]}
    assert associations[direct["network_interface_id"]]["parent_installation_id"] is None
    assert associations[child["network_interface_id"]]["parent_installation_id"] == board["id"]

    optic = module("Structural transceiver", sfp)
    leaf, = created(install(object_id, optic, "socket", board["id"]))["nested_installations"]
    assert uninstall(object_id, leaf["id"]).status_code == 200
    assert package()["canonical"] == canonical
    response = client.post("/v1/topology/physical-connections", json={
        **copper_cable_fields(),
        "source": {"kind": "NETWORK_INTERFACE", "network_interface_id": child["network_interface_id"]},
        "target": {"kind": "NETWORK_INTERFACE", "network_interface_id": direct["network_interface_id"]},
    })
    reason(response, 422, "TRANSCEIVER_BINDING_REQUIRED")
    assert read(object_id)["bays"][0]["installation"]["module_places"][0] == child


def test_roundtrip_and_prewrite_validation(hardware):
    object_id, board, direct = create_installation(hardware)
    other_id, other_board, _ = create_installation(hardware)
    original = package()
    assert original["format_version"] == 15
    assert client.delete("/v1/workspace/dataset").status_code == 204
    empty = package()
    for mutation in ("foreign_owner", "foreign_parent", "wrong_place", "wrong_key", "duplicate", "missing",
                     "network_port", "wrong_revision"):
        invalid = copy.deepcopy(original)
        rows = invalid["authoring"]["HardwareInterfaceAssociation"]
        row = next(row for row in rows if row["parent_installation_id"] == board["id"])
        if mutation == "foreign_owner":
            row["physical_object_id"] = other_id
        elif mutation == "foreign_parent":
            row["parent_installation_id"] = other_board["id"]
        elif mutation == "wrong_place":
            row["bay_key"] = direct["bay_key"]
        elif mutation == "wrong_key":
            row["hardware_interface_key"] = str(uuid.uuid4())
        elif mutation == "duplicate":
            rows.append({**row, "id": str(uuid.uuid4())})
        elif mutation == "missing":
            rows.remove(row)
        elif mutation == "network_port":
            row["interface_id"] = board["endpoints"][0]["network_interface_id"]
        else:
            pinned, = invalid["authoring"]["ModuleTemplateRevision"]
            pinned["module_places"][0].pop("hardware_interface_key")
        response = client.post("/v1/workspace/package", json=invalid)
        assert response.status_code == 422 and "hardware interface association" in response.text, response.text
        assert package() == empty
    response = client.post("/v1/workspace/package", json=original)
    assert response.status_code == 204, response.text
    assert package() == original
    assert read(object_id)["bays"][0]["installation"] == board


def test_constraints_and_reconcile_uninstall_are_atomic(hardware):
    object_id, board, _ = create_installation(hardware)
    other_id, other_board, _ = create_installation(hardware)
    interface_id = board["module_places"][0]["network_interface_id"]
    snapshot = package()
    root = next(row for row in snapshot["authoring"]["HardwareInterfaceAssociation"]
                if row["physical_object_id"] == object_id and row["parent_installation_id"] is None)
    with pytest.raises(IntegrityError, match="fk_hardware_association_configuration_owner"), SessionLocal.begin() as session:
        session.execute(insert(HardwareInterfaceAssociation), {
            **root, "id": uuid.uuid4(), "interface_id": uuid.UUID(other_board["endpoints"][0]["network_interface_id"]),
            "physical_object_id": uuid.UUID(other_id), "bay_key": "different",
            "hardware_interface_key": uuid.uuid4(),
        })
    with pytest.raises(IntegrityError, match="uq_hardware_association_place"), SessionLocal.begin() as session:
        session.execute(insert(HardwareInterfaceAssociation), {
            **root, "id": uuid.uuid4(), "interface_id": uuid.UUID(board["endpoints"][0]["network_interface_id"]),
            "hardware_interface_key": uuid.uuid4(),
        })

    template_id = hardware[1]["template_id"]
    revision(template_id, lambda definition: definition.update(name="Retitled"))
    assert all(row["status"] == "updated" for row in apply(template_id))
    assert read(object_id)["bays"][0]["installation"]["module_places"][0]["network_interface_id"] == interface_id
    revision(template_id, lambda definition: definition["module_places"][0].pop("hardware_interface_key"))
    before = package()
    reconcile = apply(template_id)
    assert all(row["status"] == "requires_intervention" for row in reconcile)
    assert all({"code": "HARDWARE_INTERFACE_ASSOCIATION_CHANGE"} in row["reasons"] for row in reconcile)
    assert package() == before

    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        dependency = repository.add_network_interface_realization(
            uuid.UUID(interface_id), uuid.UUID(board["endpoints"][0]["network_interface_id"]))
    before = package()
    reason(uninstall(object_id, board["id"]), 409, "MODULE_INSTALLATION_IN_USE")
    assert package() == before
    with SessionLocal.begin() as session:
        session.delete(session.merge(dependency))
    assert uninstall(object_id, board["id"]).status_code == 200
    assert interface_id not in {row["id"] for row in package()["canonical"]["NetworkInterface"]}
    assert client.delete(f"/v1/topology/physical-objects/{object_id}").status_code == 204
    assert all(row["physical_object_id"] != object_id
               for row in package()["authoring"]["HardwareInterfaceAssociation"])


def test_duplicate_and_wrong_kind_declarations_are_invalid(hardware):
    payload = base_payload()
    port = payload["bays"][0]
    port["hardware_interface_key"] = str(uuid.uuid4())
    payload["bays"].append({**port, "bay_key": "duplicate"})
    assert client.post("/v1/library/base-templates", json=payload).status_code == 422
    _, card, _, socket, _ = hardware
    definition = {key: value for key, value in card.items() if key not in ("template_id", "revision_id")}
    definition["module_places"].append({**socket, "key": "duplicate"})
    assert client.post("/v1/library/module-templates", json=definition).status_code == 422
    definition["module_places"] = [{**socket, "mount_kind": "MODULE_BAY",
                                    "module_port_type_id": None, "module_bay_type_id": card["module_bay_type_id"]}]
    assert client.post("/v1/library/module-templates", json=definition).status_code == 422


def test_v14_import_preserves_historical_objects_without_provisioning():
    base, _ = create_base()
    object_id = create_object(base)["physical_object_ref"]["entity_id"]
    current = package()
    old = copy.deepcopy(current)
    old["format_version"] = 14
    del old["authoring"]["HardwareInterfaceAssociation"]
    for bay in old["authoring"]["ModuleBay"]:
        del bay["hardware_interface_key"]
    assert client.delete("/v1/workspace/dataset").status_code == 204
    response = client.post("/v1/workspace/package", json=old)
    assert response.status_code == 204, response.text
    assert package() == current
    assert "network_interface_id" not in read(object_id)["bays"][0]


def test_base_publication_preserves_declaration_and_reconcile_preserves_identity():
    payload = base_payload()
    port = payload["bays"][0]
    port["hardware_interface_key"] = str(uuid.uuid4())
    base, _ = create_base(payload)
    obj = create_object(base)
    object_id = obj["physical_object_ref"]["entity_id"]
    interface_id = read(object_id)["bays"][0]["network_interface_id"]
    published_url = f"/v1/library/base-templates/{base}/versions/{obj['version_ref']['entity_id']}"
    original = client.get(published_url).json()
    assert original["bays"][0]["hardware_interface_key"] == port["hardware_interface_key"]
    draft = base_review.open_draft(base)
    definition = draft["definition"]
    definition["bays"][0]["display_name"] = "Relabeled port"
    checked = base_review.check(base, base_review.save(base, draft, definition))
    response = publish(base, checked["review"]["candidate_id"])
    assert response.status_code == 200, response.text
    assert reconcile(base)[object_id]["status"] == "updated"
    assert read(object_id)["bays"][0]["network_interface_id"] == interface_id
    assert client.get(published_url).json() == original

    draft = base_review.open_draft(base)
    draft["definition"]["bays"][0].pop("hardware_interface_key")
    base_review.assert_structure_rejected(base, base_review.save(base, draft, draft["definition"]))
    assert read(object_id)["bays"][0]["network_interface_id"] == interface_id
