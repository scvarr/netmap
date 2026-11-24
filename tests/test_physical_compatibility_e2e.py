import uuid
from copy import deepcopy
from threading import Barrier
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import BuiltInEndpointMapping, ObjectConfiguration
from app.module_geometry import initial_geometry
from app.physical_connections import ConnectionPointEndpoint, PhysicalConnectionCatalog
from app.schemas import PhysicalCompatibilityConfirmation
from tests.module_port_type_fixtures import ensure_module_bay_type_id
from tests.l1_builders import confirmed_payload, create_object_with_point, point_endpoint
from tests.test_cable_lines_e2e import CREATE, catalog_item
from tests.test_workspace_portability import client, isolated_workspace, snapshot


pytestmark = pytest.mark.no_database


def typed_points(name, *types, cardinality=1, internal_links=()):
    template = client.post("/v1/library/base-templates", json={
        "name": name, "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "panels": [{"panel_key": "panel", "panel_number": 1, "display_name": "Panel",
                    "x": 0, "y": 0, "width": 100, "height": 40}],
        "slots": [
            {"key": f"p{index}", "display_name": f"P{index}", "kind": "CONNECTION_POINT",
             "port_type_id": type_id, "panel_key": "panel", "cardinality": cardinality,
             "rendered_position": {"x": index / (len(types) + 1), "y": 0.5}}
            for index, type_id in enumerate(types, 1)
        ],
        "internal_links": list(internal_links),
    })
    assert template.status_code == 201, template.text
    obj = client.post("/v1/topology/physical-objects", json={
        "display_name": name, "base_template_id": template.json()["blueprint_ref"]["entity_id"],
    })
    assert obj.status_code == 201, obj.text
    return obj.json()["physical_object_ref"]["entity_id"], [
        slot["connection_point_ref"]["entity_id"] for slot in obj.json()["slots"]
    ]


def port(name, medium, mode="UNDEFINED"):
    return catalog_item("port-types", name=name, medium=medium, members=["1"],
                        compatibility_mode=mode)["id"]


def pair(a, b):
    return {"source": point_endpoint(a), "target": point_endpoint(b)}


def preview(url, payload):
    path = f"{url}/compatibility-preview" if url.endswith("/reconnect") else f"{url}?preview=true"
    response = client.post(path, json=payload)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(("medium_a", "medium_b", "mode", "reason", "verdict"), [
    ("FIBER", "FIBER", "SAME_TYPE", "COMPATIBLE", "ALLOW"),
    ("COPPER", "COPPER", "SAME_TYPE", "COMPATIBLE", "ALLOW"),
    ("COPPER", "COPPER", "UNDEFINED", "PORT_COMPATIBILITY_UNDEFINED", "UNKNOWN"),
    ("COPPER", "FIBER", "UNDEFINED", "MEDIUM_MISMATCH", "DENY"),
])
def test_pair_compatibility(medium_a, medium_b, mode, reason, verdict):
    type_a = port("LC Simplex" if medium_a == "FIBER" else "RJ45", medium_a, mode)
    type_b = type_a if medium_a == medium_b else port("LC Simplex", medium_b, mode)
    _, (a,) = typed_points("A", type_a)
    _, (b,) = typed_points("B", type_b)
    payload = pair(a, b)
    before = snapshot()
    check = preview(CREATE, payload)
    assert check["verdict"] == verdict and reason in check["pairs"][0]["reasons"]
    assert [result["pair"] for result in check["pairs"]] == [1]
    assert snapshot() == before
    if verdict == "DENY":
        assert check["token"] is None
        rejected = client.post(CREATE, json={
            **payload, "compatibility": {"token": "0" * 64, "accept_unknown": True},
        })
        assert rejected.json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_DENIED"
        assert snapshot() == before
    elif verdict == "UNKNOWN":
        for body in (payload, {**payload, "compatibility": {"token": check["token"], "accept_unknown": False}}):
            assert client.post(CREATE, json=body).json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_CONFIRMATION_REQUIRED"
        assert snapshot() == before
        response = client.post(CREATE, json=confirmed_payload(check, payload))
        assert response.status_code == 201, response.text
    else:
        response = client.post(CREATE, json=payload)
        assert response.status_code == 201, response.text


def test_bulk_is_atomic_and_requires_a_fresh_operation_confirmation():
    copper = port("Copper", "COPPER")
    fiber = port("Fiber", "FIBER")
    _, (a, b) = typed_points("Source", copper, copper)
    _, (c, d, e) = typed_points("Target", copper, copper, fiber)
    url = f"{CREATE}/bulk"
    valid = {"pairs": [pair(a, c), pair(b, d)]}
    before = snapshot()
    check = preview(url, valid)
    assert check["verdict"] == "UNKNOWN"
    assert [end["pair"] for end in check["pairs"]] == [1, 2]
    assert client.post(url, json=valid).status_code == 409
    reorder = {**valid, "pairs": list(reversed(valid["pairs"]))}
    assert client.post(url, json=confirmed_payload(check, reorder)).json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_STALE"
    denied = {**valid, "pairs": [pair(a, c), pair(b, e)]}
    assert preview(url, denied)["verdict"] == "DENY"
    assert client.post(url, json=confirmed_payload(check, denied)).json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_DENIED"
    assert snapshot() == before

    response = client.post(url, json=confirmed_payload(check, valid))
    assert response.status_code == 201, response.text
    assert len(response.json()["created"]) == 2
    after = snapshot()
    assert len(after["canonical"]["Cable"]) == len(after["canonical"]["Connection"]) == 2
    assert client.post(url, json=confirmed_payload(check, valid)).status_code == 422
    assert snapshot() == after


def test_bulk_conflict_with_concurrent_single_create_leaves_other_pair_free():
    _, (a, b) = typed_points("Source", *(port("Copper", "COPPER"),) * 2)
    _, (c, d) = typed_points("Target", *(port("Target copper", "COPPER"),) * 2)
    url = f"{CREATE}/bulk"
    payload = {"pairs": [pair(a, c), pair(b, d)]}
    confirmed = confirmed_payload(preview(url, payload), payload)
    single = pair(b, d)
    single_token = confirmed_payload(preview(CREATE, single), single)["compatibility"]
    with ThreadPoolExecutor(max_workers=1) as worker:
        with SessionLocal.begin() as session:
            PhysicalConnectionCatalog(session).create_endpoint_link(
                ConnectionPointEndpoint(uuid.UUID(b)), ConnectionPointEndpoint(uuid.UUID(d)),
                compatibility=PhysicalCompatibilityConfirmation.model_validate(single_token),
            )
            competing = worker.submit(client.post, url, json=confirmed)
        response = competing.result(timeout=5)
    assert response.json()["error"]["details"]["reason"] == "CONNECTION_POINT_MEMBER_OCCUPIED"
    (connection,) = snapshot()["canonical"]["Connection"]
    assert (connection["point_a_id"], connection["point_b_id"]) == (b, d)


def test_module_endpoint_uses_the_installed_revision_port_type():
    mount = {"mount_kind": "MODULE_BAY", "module_bay_type_id": ensure_module_bay_type_id()}
    type_id = port("Module RJ45", "COPPER", "SAME_TYPE")
    _, (peer,) = typed_points("Peer", type_id)
    base = client.post("/v1/library/base-templates", json={
        "name": "Chassis", "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "panels": [{"panel_key": "panel", "panel_number": 1, "display_name": "Panel",
                    "x": 0, "y": 0, "width": 100, "height": 40}],
        "slots": [], "internal_links": [],
        "bays": [{"bay_key": "bay", "display_name": "Bay", "panel_key": "panel", "kind": "LOGICAL", **mount}],
    })
    assert base.status_code == 201, base.text
    obj = client.post("/v1/topology/physical-objects", json={
        "display_name": "Chassis", "base_template_id": base.json()["blueprint_ref"]["entity_id"],
    })
    assert obj.status_code == 201, obj.text
    owner = obj.json()["physical_object_ref"]["entity_id"]
    module = client.post("/v1/library/module-templates", json={
        "name": "Module", **mount, "geometry": initial_geometry(["p"]),
        "endpoints": [{"key": "p", "display_name": "Port", "port_type_id": type_id, "kind": "NETWORK_PORT"}],
    })
    assert module.status_code == 201, module.text
    installation = client.post(f"/v1/topology/physical-objects/{owner}/module-installations", json={
        "module_template_id": module.json()["template_id"], "bay_key": "bay", "orientation": "HORIZONTAL",
    })
    assert installation.status_code == 201, installation.text
    (endpoint,) = installation.json()["bays"][0]["installation"]["endpoints"]
    payload = {**pair(endpoint["connection_point_id"], peer)}
    assert preview(CREATE, payload)["verdict"] == "ALLOW"


def test_reconnect_checks_the_matching_end_and_rechecks_changed_data_under_locks():
    type_id = port("RJ45 port", "COPPER", "SAME_TYPE")
    _, (a,) = typed_points("Source", type_id)
    _, b = create_object_with_point(client, "Passive ODF")
    owner, (destination,) = typed_points("Destination", type_id)
    payload = {**pair(a, b), "cable_label": "CAB01/1/48"}
    response = client.post(CREATE, json=confirmed_payload(preview(CREATE, payload), payload))
    assert response.status_code == 201, response.text
    cable_id = response.json()["cable_ref"]["entity_id"]
    url = f"/v1/cables/{cable_id}/reconnect"
    expected = client.get(url).json()["expected"]
    _, (fiber_point,) = typed_points("Fiber destination", port("Fiber port", "FIBER"))
    incompatible = {"side": "B", "expected": expected, "new_point_id": fiber_point}
    assert preview(url, incompatible)["verdict"] == "DENY"
    assert client.post(url, json=incompatible).json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_DENIED"
    assert client.get(url).json()["expected"] == expected
    move = {"side": "B", "expected": expected, "new_point_id": destination}
    check = preview(url, move)
    assert check["pairs"][0]["verdict"] == "ALLOW"
    confirmed = confirmed_payload(check, move)

    with SessionLocal.begin() as session:
        session.scalar(select(ObjectConfiguration).where(
            ObjectConfiguration.physical_object_id == uuid.UUID(owner),
        ).with_for_update())
        blocked = client.post(url, json=confirmed)
        assert blocked.json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_CONFLICT"
    assert client.get(url).json()["expected"] == expected

    # Change the provenance through a committed physical data write between preview and reconnect.
    with SessionLocal.begin() as session:
        mapping = session.scalar(select(BuiltInEndpointMapping).where(
            BuiltInEndpointMapping.connection_point_id == uuid.UUID(destination),
        ))
        session.delete(mapping)
    before = snapshot()
    assert client.post(url, json=confirmed).json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_STALE"
    assert snapshot() == before
    fresh = preview(url, move)
    assert "PORT_B_TYPE_UNRESOLVED" in fresh["pairs"][0]["reasons"]
    response = client.post(url, json=confirmed_payload(fresh, move))
    assert response.status_code == 204, response.text
    after = snapshot()
    assert before["canonical"]["Cable"] == after["canonical"]["Cable"]
    assert before["canonical"]["ConnectionMember"] == after["canonical"]["ConnectionMember"]
    assert before["settings"]["CableLabelHistory"] == after["settings"]["CableLabelHistory"]
    assert client.get(url).json()["expected"] == {**expected, "point_b_id": destination}


def test_matrix_is_symmetric_and_preview_tracks_rules_not_names():
    import copy

    first = port("First", "COPPER", "SAME_TYPE")
    second = port("Second", "COPPER", "MATRIX")
    third = port("Fiber", "FIBER", "MATRIX")
    _, (a,) = typed_points("A", first)
    _, (b,) = typed_points("B", second)
    matrix = "/v1/port-type-compatibilities"
    left = pair(a, b)
    right = pair(b, a)

    def update(port_id, **changes):
        url = f"/v1/port-types/{port_id}"
        data = client.get(url).json()
        for field in ("id", "cardinality"):
            del data[field]
        response = client.put(url, json={**data, **changes})
        assert response.status_code == 200, response.text

    assert preview(CREATE, left)["verdict"] == preview(CREATE, right)["verdict"] == "DENY"
    assert client.put(f"{matrix}/{first}/{second}", json={"allowed": True}).status_code == 422
    update(first, compatibility_mode="MATRIX")
    assert preview(CREATE, left)["verdict"] == "DENY"
    assert client.put(f"{matrix}/{first}/{third}", json={"allowed": True}).status_code == 422
    assert client.put(f"{matrix}/{first}/{second}", json={"allowed": True}).status_code == 204
    assert client.put(f"{matrix}/{second}/{first}", json={"allowed": True}).status_code == 204
    assert len(client.get(matrix).json()) == 1

    check = preview(CREATE, left)
    assert check["verdict"] == preview(CREATE, right)["verdict"] == "ALLOW"
    update(second, name="Renamed")
    assert preview(CREATE, left) == check
    current = snapshot()
    assert client.delete("/v1/workspace/dataset").status_code == 204
    corrupt = copy.deepcopy(current)
    stored, = corrupt["settings"]["PortTypeCompatibility"]
    stored["port_type_a_id"], stored["port_type_b_id"] = stored["port_type_b_id"], stored["port_type_a_id"]
    assert client.post("/v1/workspace/package", json=corrupt).status_code == 422
    assert client.post("/v1/workspace/package", json=current).status_code == 204
    assert snapshot() == current
    assert preview(CREATE, left) == check

    # Once the policy changes, an ALLOW preview cannot be reused as UNKNOWN acceptance.
    update(first, compatibility_mode="UNDEFINED")
    update(second, compatibility_mode="UNDEFINED")
    assert preview(CREATE, left)["verdict"] == "UNKNOWN"
    before = snapshot()
    rejected = client.post(CREATE, json={**left, "compatibility": {"token": check["token"], "accept_unknown": True}})
    assert rejected.json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_STALE"
    assert snapshot() == before

    update(first, compatibility_mode="MATRIX")
    update(second, compatibility_mode="MATRIX")
    assert client.put(f"{matrix}/{second}/{first}", json={"allowed": False}).status_code == 204
    assert preview(CREATE, left)["verdict"] == preview(CREATE, right)["verdict"] == "DENY"


def member_pair(a, index_a, b, index_b):
    return {
        "source": {**point_endpoint(a), "member_index": index_a},
        "target": {**point_endpoint(b), "member_index": index_b},
    }


def test_member_wiring_preview_exact_pair_projection_and_disconnect():
    duplex = catalog_item("port-types", name="Duplex", medium="FIBER",
                          members=["Blue", "Orange"], compatibility_mode="SAME_TYPE")["id"]
    source_id, (a, rear) = typed_points("Panel", duplex, duplex, cardinality=2, internal_links=[{
        "from_slot_key": "p1", "to_slot_key": "p2",
        "member_mappings": [{"from_member_index": 2, "to_member_index": 1}],
    }])
    target_id, (b,) = typed_points("Switch", duplex, cardinality=2)
    first = member_pair(a, 2, b, 1)
    second = member_pair(a, 1, b, 2)
    for invalid in (0, 3, None):
        assert client.post(f"{CREATE}?preview=true", json=member_pair(a, invalid, b, 1)).status_code == 422
    assert client.post(f"{CREATE}?preview=true", json=member_pair(a, 1, rear, 2)).status_code == 422
    initial = snapshot()["canonical"]
    check = preview(CREATE, first)
    assert check["verdict"] == "ALLOW"
    assert client.post(CREATE, json=first).status_code == 409
    assert client.post(CREATE, json=confirmed_payload(check, second)).json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_STALE"
    stale = client.post(CREATE, json=confirmed_payload(check, {**first, "cable_label": "Changed"}))
    assert stale.json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_STALE"

    created = []
    for payload in (first, second):
        reply = client.post(CREATE, json=confirmed_payload(preview(CREATE, payload), payload))
        assert reply.status_code == 201, reply.text
        created.append(reply.json())
    assert [(item["source"]["member_index"], item["target"]["member_index"]) for item in created] == [(2, 1), (1, 2)]
    assert client.post(CREATE, json=confirmed_payload(check, first)).json()["error"]["details"]["reason"] == "CONNECTION_POINT_MEMBER_OCCUPIED"
    assert client.get(f"/v1/cables/{created[0]['cable_ref']['entity_id']}/reconnect").status_code == 422

    preview_rows = client.get("/v1/cables/bulk-delete-preview", params={
        "source_object_id": target_id, "target_object_id": source_id,
    }).json()["cables"]
    assert {(tuple(row["source_member_designations"]), tuple(row["target_member_designations"]))
            for row in preview_rows} == {(('Blue',), ('Orange',)), (('Orange',), ('Blue',))}

    def project():
        response = client.post("/v1/topology/projection", json={
            "layer": "L1", "detail_level": "PHYSICAL_OBJECT",
            "scope": {"include_location_subtrees": [], "include_entities": []},
        })
        assert response.status_code == 200, response.text
        return response.json()

    for projection in (project(), project()):
        marker = next(point for node in projection["nodes"] for point in node["attributes"]["connection_points"]
                      if point["connection_point_id"] == a)
        assert marker["members"] == [
            {"index": 1, "designation": "Blue", "occupied": True},
            {"index": 2, "designation": "Orange", "occupied": True},
        ]
        endpoint_pairs = [pair for edge in projection["edges"] for pair in edge["attributes"]["endpoint_pairs"]]
        assert {pair["cable_ref"]["entity_id"] for pair in endpoint_pairs} == {
            item["cable_ref"]["entity_id"] for item in created
        }

    connection_id = created[0]["connection_ref"]["entity_id"]
    assert client.delete(f"{CREATE}/{connection_id}").status_code == 204
    detail = client.get(f"/v1/topology/physical-objects/{source_id}").json()
    ending = next(point for point in detail["connection_points"] if point["connection_point_ref"]["entity_id"] == a)
    assert [member["occupied"] for member in ending["members"]] == [True, False]
    assert ending["external_physical_attachments"][0]["connection_ref"] == created[1]["connection_ref"]
    assert ending["internal_physical_counterparts"][0]["connection_point_ref"]["entity_id"] == rear
    final = snapshot()["canonical"]
    for entity in ("ConnectionPoint", "NetworkInterface", "InterfacePhysicalBinding"):
        assert final[entity] == initial[entity]
    assert len(final["Cable"]) == 1
    assert len(final["Connection"]) == len(initial["Connection"]) + 1
    assert len(final["ConnectionMember"]) == len(initial["ConnectionMember"]) + 1


def test_members_serialize_competing_writes_with_independent_remaining_capacity():
    duplex = catalog_item("port-types", name="Duplex", medium="FIBER", members=["A", "B"])["id"]
    simplex = port("Simplex", "FIBER")
    _, (a,) = typed_points("A", duplex, cardinality=2)
    _, (b, c, d) = typed_points("B", simplex, simplex, simplex)
    attempts = [member_pair(a, 1, b, 1), member_pair(a, 1, c, 1), member_pair(a, 2, d, 1)]
    check = preview(CREATE, attempts[0])
    assert check["verdict"] == "UNKNOWN"
    rejected = client.post(CREATE, json={**attempts[0], "compatibility": {"token": check["token"], "accept_unknown": False}})
    assert rejected.json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_CONFIRMATION_REQUIRED"
    requests = [confirmed_payload(preview(CREATE, body), body) for body in attempts]
    barrier = Barrier(len(requests))

    def write(body):
        barrier.wait(timeout=5)
        return client.post(CREATE, json=body)

    with ThreadPoolExecutor(max_workers=len(requests)) as pool:
        results = list(pool.map(write, requests))
    assert sorted(response.status_code for response in results[:2]) == [201, 422]
    assert results[2].status_code == 201, results[2].text
    assert len(snapshot()["canonical"]["Cable"]) == 2


def test_workspace_v17_preserves_wide_members_and_rejects_conflicts_before_import():
    wide = catalog_item("port-types", name="ODF", medium="FIBER",
                        members=[f"F{index:02}" for index in range(1, 25)])["id"]
    copper = port("RJ45", "COPPER")
    simplex = port("Simplex", "FIBER")
    _, (a,) = typed_points("ODF", wide, cardinality=24)
    _, (b, c, d) = typed_points("Peer", simplex, simplex, copper)
    denied = member_pair(a, 24, d, 1)
    assert preview(CREATE, denied)["verdict"] == "DENY"
    assert client.post(CREATE, json=denied).json()["error"]["code"] == "PHYSICAL_COMPATIBILITY_DENIED"
    for index, target in ((24, b), (23, c)):
        payload = member_pair(a, index, target, 1)
        response = client.post(CREATE, json=confirmed_payload(preview(CREATE, payload), payload))
        assert response.status_code == 201, response.text

    package = snapshot()
    assert package["format_version"] == 17
    assert client.delete("/v1/workspace/dataset").status_code == 204
    empty = snapshot()
    for invalid_index, reason in ((25, "outside"), (24, "EXTERNAL_MEMBER_OCCUPANCY")):
        malformed = deepcopy(package)
        member = next(row for row in malformed["canonical"]["ConnectionMember"] if row["point_a_member"] == 23)
        member["point_a_member"] = invalid_index
        response = client.post("/v1/workspace/package", json=malformed)
        assert response.status_code == 422 and reason in response.text
        assert snapshot() == empty
    assert client.post("/v1/workspace/package", json=package).status_code == 204
    assert snapshot() == package
