import copy
import uuid

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.module_geometry import initial_geometry
from app.models import ModuleTemplateCandidate, ModuleTemplateDraft
from tests.l1_builders import point_endpoint, post_confirmed_physical
from tests.module_port_type_fixtures import ensure_module_port_type_id
from tests.port_type_fixtures import ensure_port_type_id
from tests.test_hardware_configuration import board_base_payload, client, create_base, create_object, install
from tests.test_module_layout_editing import request as layout_request
from tests.test_module_reconciliation import apply, package, revision
from tests.test_module_template_publication import publish
from tests.test_module_template_review import check, open_draft, save


def link(left, right, pairs):
    return {"from_endpoint_key": left, "to_endpoint_key": right, "member_mappings": [
        {"from_member_index": a, "to_member_index": b} for a, b in pairs
    ]}


def module_definition(pairs, *, capacity=3):
    bay = board_base_payload()["bays"][0]
    keys = ("rear", "front", "spare")
    port_type = ensure_port_type_id(capacity)
    return {"name": "Passive board", "mount_kind": "MODULE_BAY", "module_bay_type_id": bay["module_bay_type_id"],
            "geometry": initial_geometry(keys), "internal_links": [link("rear", "front", pairs)],
            "endpoints": [{"key": key, "display_name": key, "port_type_id": port_type,
                           "kind": "CONNECTION_POINT"} for key in keys]}


def create_module(definition):
    response = client.post("/v1/library/module-templates", json=definition)
    assert response.status_code == 201, response.text
    assert response.json().get("internal_links", []) == definition["internal_links"]
    return response.json()


def setup(pairs, *, capacity=3, count=1):
    definition = module_definition(pairs, capacity=capacity)
    module = create_module(definition)
    payload = board_base_payload()
    payload["bays"].extend({**payload["bays"][0], "bay_key": str(uuid.uuid4())} for _ in range(count - 1))
    base, _ = create_base(payload)
    oid = create_object(base)["physical_object_ref"]["entity_id"]
    for bay in payload["bays"]:
        response = install(oid, module["template_id"], bay["bay_key"])
        assert response.status_code == 201, response.text
    document = response.json()
    return module, base, oid, document


def points(installation):
    return {endpoint["key"]: endpoint["connection_point_id"] for endpoint in installation["endpoints"]}


def trace(left, a, right, b):
    response = client.post("/v1/traces/l1", json={
        "from": {"point_id": left, "member_index": a}, "to": {"point_id": right, "member_index": b},
    })
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(("capacity", "pairs"), [(1, [(1, 1)]), (3, [(2, 3)]), (3, [(1, 3), (2, 1), (3, 2)])])
def test_installations_materialize_only_exact_members(capacity, pairs):
    _, _, _, document = setup(pairs, capacity=capacity, count=2)
    first, second = [points(bay["installation"]) for bay in document["bays"]]
    assert not set(first.values()) & set(second.values())
    canonical = package()["canonical"]
    assert not canonical["Cable"]
    assert len(canonical["Connection"]) == 2
    assert len(canonical["ConnectionMember"]) == 2 * len(pairs)
    for instance in (first, second):
        connection, = [c for c in canonical["Connection"] if c["point_a_id"] == instance["rear"]]
        assert connection["point_b_id"] == instance["front"]
        assert {(m["point_a_member"], m["point_b_member"]) for m in canonical["ConnectionMember"]
                if m["connection_id"] == connection["id"]} == set(pairs)
        for a in range(1, capacity + 1):
            for b in range(1, capacity + 1):
                assert trace(instance["rear"], a, instance["front"], b)["verdict"] == (
                    "REACHABLE" if (a, b) in pairs else "UNKNOWN")
    assert trace(first["rear"], pairs[0][0], second["front"], pairs[0][1])["verdict"] == "UNKNOWN"


@pytest.mark.parametrize("damage", ["unknown", "socket", "active", "transceiver", "self", "zero",
                                   "range", "duplicate_member", "duplicate_pair", "cross_link", "implicit"])
def test_invalid_definition_is_atomic(damage):
    definition = module_definition([(1, 2)])
    links = definition["internal_links"]
    item = links[0]
    if damage in ("unknown", "socket", "self"):
        item["to_endpoint_key"] = {"unknown": "missing", "socket": "socket", "self": "rear"}[damage]
        if damage == "socket":
            definition["module_places"] = [{"key": "socket", "display_name": "Socket", "mount_kind": "MODULE_PORT",
                                            "module_port_type_id": ensure_module_port_type_id(), "x": .4, "y": .4}]
    elif damage == "active":
        definition["endpoints"][0].update(kind="NETWORK_PORT", port_type_id=ensure_port_type_id())
    elif damage == "transceiver":
        definition.pop("module_bay_type_id")
        definition.update(mount_kind="MODULE_PORT", module_port_type_id=ensure_module_port_type_id())
    elif damage in ("zero", "range"):
        item["member_mappings"][0]["to_member_index"] = 0 if damage == "zero" else 4
    elif damage == "duplicate_member":
        item["member_mappings"].append({"from_member_index": 1, "to_member_index": 3})
    elif damage == "duplicate_pair":
        links.append(link("front", "rear", [(1, 3)]))
    elif damage == "cross_link":
        links.append(link("spare", "rear", [(2, 1)]))
    else:
        item.pop("member_mappings")
    before = package()
    assert client.post("/v1/library/module-templates", json=definition).status_code == 422
    assert package() == before


def test_external_cable_uses_same_member_and_blocks_dismantling():
    _, base, oid, document = setup([(1, 2)])
    installation = document["bays"][0]["installation"]
    local = points(installation)
    peer = create_object(base)["slots"][0]["connection_point_ref"]["entity_id"]
    source = {**point_endpoint(local["front"]), "member_index": 2}
    response = post_confirmed_physical(client, "/v1/topology/physical-connections",
                                       json={"source": source, "target": point_endpoint(peer)})
    assert response.status_code == 201, response.text
    cable_id = response.json()["cable_ref"]["entity_id"]
    assert trace(local["rear"], 1, peer, 1)["verdict"] == "REACHABLE"
    assert trace(local["rear"], 2, peer, 1)["verdict"] == "UNKNOWN"
    url = f"/v1/topology/physical-objects/{oid}/module-installations/{installation['id']}"
    before = package()
    assert client.delete(url).status_code == 409
    assert package() == before
    assert client.delete(f"/v1/cables/{cable_id}").status_code == 204
    assert trace(local["rear"], 1, local["front"], 2)["verdict"] == "REACHABLE"
    assert client.delete(url).status_code == 200
    after = package()
    assert not after["authoring"]["ModuleInstallation"]
    assert not after["canonical"]["Connection"]
    assert not after["canonical"]["ConnectionMember"]
    assert not set(local.values()) & {p["id"] for p in after["canonical"]["ConnectionPoint"]}


def test_review_enforces_immutable_wiring_without_installations():
    module = create_module(module_definition([(1, 2)]))
    tid = module["template_id"]
    draft = open_draft(tid)
    assert draft["definition"]["internal_links"] == module["internal_links"]
    invalid = copy.deepcopy(draft["definition"])
    invalid["internal_links"][0]["member_mappings"][0]["to_member_index"] = 4
    url = f"/v1/library/module-templates/{tid}/draft"
    assert client.put(url, params={"expected_generation": draft["generation"]}, json=invalid).status_code == 422
    saved = save(tid, draft, {**draft["definition"], "internal_links": [link("rear", "front", [(1, 3)])]})
    refused = client.post(f"{url}/check", params={"expected_generation": saved["generation"]})
    assert refused.status_code == 409 and "PHYSICAL_STRUCTURE_IMMUTABLE" in refused.text

    # Publication repeats the guard independently of a previously approved result.
    ready = check(tid, save(tid, saved, draft["definition"]))
    candidate_id = ready["review"]["candidate_id"]
    with SessionLocal.begin() as session:
        changed = saved["definition"]
        session.get(ModuleTemplateCandidate, uuid.UUID(candidate_id)).definition = changed
        draft_row = session.scalar(select(ModuleTemplateDraft).where(ModuleTemplateDraft.template_id == uuid.UUID(tid)))
        draft_row.definition = changed
    refused = publish(tid, candidate_id)
    assert refused.status_code == 409 and "PHYSICAL_STRUCTURE_IMMUTABLE" in refused.text
    assert len(package()["authoring"]["ModuleTemplateRevision"]) == 1


def test_layout_reconcile_and_workspace_preserve_canonical_continuity():
    module, _, oid, document = setup([(1, 3), (3, 1)])
    tid = module["template_id"]
    installation = document["bays"][0]["installation"]
    local = points(installation)
    before = package()
    url = f"/v1/topology/physical-objects/{oid}/module-installations/{installation['id']}/layout"
    moved = client.put(url, json=layout_request(document))
    assert moved.status_code == 200, moved.text
    assert moved.json()["bays"][0]["installation"]["layout"] != installation["layout"]
    assert package()["canonical"] == before["canonical"]

    published = revision(tid, lambda definition: definition.update(
        name="Renamed", internal_links=[link("front", "rear", [(1, 3), (3, 1)])]))
    pinned = package()
    assert pinned["authoring"]["ModuleInstallation"][0]["module_revision_id"] == module["revision_id"]
    assert client.delete("/v1/workspace/dataset").status_code == 204
    empty = package()
    for damage in ("revision", "missing_member", "wrong_member", "undeclared_link"):
        invalid = copy.deepcopy(pinned)
        if damage == "revision":
            invalid["authoring"]["ModuleTemplateRevision"][0]["internal_links"][0]["member_mappings"][0]["to_member_index"] = 99
        elif damage == "missing_member":
            invalid["canonical"]["ConnectionMember"].pop()
        elif damage == "wrong_member":
            invalid["canonical"]["ConnectionMember"][0]["point_b_member"] = 2
        else:
            identifier = str(uuid.uuid4())
            invalid["canonical"]["Connection"].append({
                "id": identifier, "point_a_id": local["rear"], "point_b_id": local["spare"], "cardinality": 1,
            })
            invalid["canonical"]["ConnectionMember"].append({
                "id": str(uuid.uuid4()), "connection_id": identifier, "index": 1,
                "point_a_member": 2, "point_b_member": 1,
            })
        refused = client.post("/v1/workspace/package", json=invalid)
        assert refused.status_code == 422, refused.text
        assert package() == empty
    restored = client.post("/v1/workspace/package", json=pinned)
    assert restored.status_code == 204, restored.text
    assert package() == pinned

    outcome, = apply(tid)
    assert outcome["status"] == "updated", outcome
    assert outcome["installation_id"] == installation["id"]
    assert outcome["target_revision_id"] == published["revision_id"]
    assert package()["canonical"] == before["canonical"]
    assert trace(local["rear"], 1, local["front"], 3)["verdict"] == "REACHABLE"


@pytest.mark.parametrize("source_pairs", [[], [(1, 2)]])
def test_restore_incompatible_draft_from_pinned_wiring(source_pairs):
    definition = module_definition(source_pairs or [(1, 2)])
    if not source_pairs:
        definition["internal_links"] = []
    module = create_module(definition)
    tid = module["template_id"]
    original = open_draft(tid)
    url = f"/v1/library/module-templates/{tid}/draft/restore-source"

    def restore(generation):
        return client.post(url, params={"expected_generation": generation})

    response = restore(original["generation"])
    assert response.status_code == 409 and "DRAFT_RESTORE_NOT_REQUIRED" in response.text
    checked = check(tid, original)
    saved = save(tid, checked, {**original["definition"], "name": "Incompatible draft",
                              "internal_links": [link("rear", "front", [(1, 3)])]})
    response = client.post(f"/v1/library/module-templates/{tid}/draft/check",
                           params={"expected_generation": saved["generation"]})
    assert response.status_code == 409 and "PHYSICAL_STRUCTURE_IMMUTABLE" in response.text
    conflict = restore(original["generation"])
    assert conflict.status_code == 409 and "DRAFT_CONFLICT" in conflict.text
    assert open_draft(tid)["definition"] == saved["definition"]
    before = package()

    restored_response = restore(saved["generation"])
    assert restored_response.status_code == 200, restored_response.text
    restored = restored_response.json()
    assert restored["definition"] == original["definition"]
    assert restored["source_revision_id"] == original["source_revision_id"]
    assert restored["generation"] == saved["generation"] + 1
    assert not restored["review"]["current"]
    assert publish(tid, checked["review"]["candidate_id"]).status_code == 409
    after = package()
    assert after["canonical"] == before["canonical"]
    assert after["authoring"]["ModuleTemplateRevision"] == before["authoring"]["ModuleTemplateRevision"]
    ready = check(tid, restored)
    assert publish(tid, ready["review"]["candidate_id"]).status_code == 200
    assert open_draft(tid)["definition"] == original["definition"]
