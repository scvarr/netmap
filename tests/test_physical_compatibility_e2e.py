import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import BuiltInEndpointMapping, ObjectConfiguration
from app.module_geometry import initial_geometry
from app.physical_connections import ConnectionPointEndpoint, PhysicalConnectionCatalog
from app.schemas import CableSpecification, PhysicalCompatibilityConfirmation
from tests.module_port_type_fixtures import ensure_module_bay_type_id
from tests.l1_builders import confirmed_payload, create_object_with_point, point_endpoint
from tests.test_typed_cables_e2e import CREATE, catalog_item
from tests.test_workspace_portability import client, isolated_workspace, snapshot


pytestmark = pytest.mark.no_database


def typed_points(name, *types):
    template = client.post("/v1/library/base-templates", json={
        "name": name, "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "panels": [{"panel_key": "panel", "panel_number": 1, "display_name": "Panel",
                    "x": 0, "y": 0, "width": 100, "height": 40}],
        "slots": [
            {"key": f"p{index}", "display_name": f"P{index}", "kind": "CONNECTION_POINT",
             "port_type_id": type_id, "panel_key": "panel",
             "rendered_position": {"x": index / (len(types) + 1), "y": 0.5}}
            for index, type_id in enumerate(types, 1)
        ],
        "internal_links": [],
    })
    assert template.status_code == 201, template.text
    obj = client.post("/v1/topology/physical-objects", json={
        "display_name": name, "base_template_id": template.json()["blueprint_ref"]["entity_id"],
    })
    assert obj.status_code == 201, obj.text
    return obj.json()["physical_object_ref"]["entity_id"], [
        slot["connection_point_ref"]["entity_id"] for slot in obj.json()["slots"]
    ]


def port(name, medium, mode="UNDEFINED", fiber_mode=None):
    return catalog_item("port-types", name=name, medium=medium, members=["1"],
                        compatibility_mode=mode, fiber_mode=fiber_mode)["id"]


def cable_spec(medium, fiber_mode=None):
    cable = catalog_item("cable-types", name="Line", medium=medium, construction="Documented line",
                         fiber_mode=fiber_mode)
    return {"cable_type_id": cable["id"]}


def pair(a, b):
    return {"source": point_endpoint(a), "target": point_endpoint(b)}


def preview(url, payload):
    path = f"{url}/compatibility-preview" if url.endswith("/reconnect") else f"{url}?preview=true"
    response = client.post(path, json=payload)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(("medium", "port_medium", "mode", "line_fiber", "port_fiber", "reason", "verdict"), [
    ("COPPER", "COPPER", "SAME_TYPE", None, None, "COMPATIBLE", "ALLOW"),
    ("COPPER", "COPPER", "UNDEFINED", None, None, "PORT_COMPATIBILITY_UNDEFINED", "UNKNOWN"),
    ("COPPER", "FIBER", "UNDEFINED", None, None, "MEDIUM_MISMATCH", "DENY"),
    ("FIBER", "FIBER", "SAME_TYPE", "MM", "SM", "FIBER_MODE_MISMATCH", "DENY"),
    ("FIBER", "FIBER", "SAME_TYPE", "SM", "SM", "COMPATIBLE", "ALLOW"),
    ("FIBER", "FIBER", "SAME_TYPE", "SM", None, "FIBER_MODE_UNDOCUMENTED", "UNKNOWN"),
])
def test_pair_compatibility(medium, port_medium, mode, line_fiber, port_fiber, reason, verdict):
    type_id = port("Documented port", port_medium, mode, port_fiber)
    _, (a,) = typed_points("A", type_id)
    _, (b,) = typed_points("B", type_id)
    payload = {**pair(a, b), **cable_spec(medium, line_fiber)}
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
    spec = cable_spec("COPPER")
    url = f"{CREATE}/bulk"
    valid = {"pairs": [pair(a, c), pair(b, d)], **spec}
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
    spec = cable_spec("COPPER")
    url = f"{CREATE}/bulk"
    payload = {"pairs": [pair(a, c), pair(b, d)], **spec}
    confirmed = confirmed_payload(preview(url, payload), payload)
    single = {**pair(b, d), **spec}
    single_token = confirmed_payload(preview(CREATE, single), single)["compatibility"]
    with ThreadPoolExecutor(max_workers=1) as worker:
        with SessionLocal.begin() as session:
            PhysicalConnectionCatalog(session).create_endpoint_link(
                ConnectionPointEndpoint(uuid.UUID(b)), ConnectionPointEndpoint(uuid.UUID(d)),
                cable_spec=CableSpecification.model_validate(spec),
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
    payload = {**pair(endpoint["connection_point_id"], peer), **cable_spec("COPPER")}
    assert preview(CREATE, payload)["verdict"] == "ALLOW"


def test_reconnect_checks_the_matching_end_and_rechecks_changed_data_under_locks():
    type_id = port("RJ45 port", "COPPER", "SAME_TYPE")
    _, (a,) = typed_points("Source", type_id)
    _, b = create_object_with_point(client, "Passive ODF")
    owner, (destination,) = typed_points("Destination", type_id)
    payload = {**pair(a, b), **cable_spec("COPPER"), "cable_label": "CAB01/1/48"}
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
    spec = cable_spec("COPPER")
    matrix = "/v1/port-type-compatibilities"
    left = {**pair(a, b), **spec}
    right = {**pair(b, a), **spec}

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
