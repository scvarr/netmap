import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import BuiltInEndpointMapping, ObjectConfiguration
from app.module_geometry import initial_geometry
from app.physical_connections import ConnectionPointEndpoint, PhysicalConnectionCatalog
from app.schemas import CableSpecification, PhysicalCompatibilityConfirmation
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


def connector(name, profile, termination):
    return catalog_item("connector-types", name=name, mating_profile=profile, termination=termination)["id"]


def port(name, medium, connector_id=None):
    return catalog_item("port-types", name=name, medium=medium, members=["1"], connector_type_id=connector_id)["id"]


def cable_spec(medium, a=None, b=None):
    cable = catalog_item("cable-types", name="Test cable", medium=medium,
                         construction="SINGLE_MODE" if medium == "FIBER" else "TWISTED_PAIR")
    return {"cable_type_id": cable["id"], "connector_a_type_id": a, "connector_b_type_id": b}


def pair(a, b):
    return {"source": point_endpoint(a), "target": point_endpoint(b)}


def preview(url, payload):
    path = f"{url}/compatibility-preview" if url.endswith("/reconnect") else f"{url}?preview=true"
    response = client.post(path, json=payload)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(("medium", "port_medium", "plug_profile", "port_profile", "plug_gender", "reason", "verdict"), [
    ("COPPER", "COPPER", "RJ45", "RJ45", "PLUG", "COMPATIBLE", "ALLOW"),
    ("COPPER", "FIBER", None, None, None, "MEDIUM_MISMATCH", "DENY"),
    ("FIBER", "FIBER", "LC", "SC", "PLUG", "PROFILE_MISMATCH", "DENY"),
    ("COPPER", "COPPER", "RJ45", "RJ45", "SOCKET", "TERMINATION_MISMATCH", "DENY"),
    ("FIBER", "FIBER", "LC", "LC", "PLUG", "FIBER_MODE_UNDOCUMENTED", "UNKNOWN"),
    ("FIBER", "FIBER", None, None, None, "CABLE_CONNECTOR_UNSPECIFIED", "UNKNOWN"),
])
def test_known_mating_and_documentation_limits(medium, port_medium, plug_profile, port_profile, plug_gender, reason, verdict):
    plug = connector("Cable connector", plug_profile, plug_gender) if plug_profile else None
    socket = connector("Port socket", port_profile, "SOCKET") if port_profile else None
    type_id = port("Documented port", port_medium, socket)
    _, (a,) = typed_points("A", type_id)
    if verdict == "DENY":
        _, b = create_object_with_point(client, "Passive ODF")
    else:
        _, (b,) = typed_points("B", type_id)
    payload = {**pair(a, b), **cable_spec(medium, plug, plug)}
    before = snapshot()
    check = preview(CREATE, payload)
    assert check["verdict"] == verdict and reason in check["ends"][0]["reasons"]
    assert [(end["pair"], end["side"]) for end in check["ends"]] == [(1, "A"), (1, "B")]
    assert snapshot() == before
    if verdict == "DENY":
        assert check["token"] is None and check["ends"][1]["verdict"] == "UNKNOWN"
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
    assert [end["pair"] for end in check["ends"]] == [1, 1, 2, 2]
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
    plug = connector("Cable RJ45", "RJ45", "PLUG")
    socket = connector("Port RJ45", "RJ45", "SOCKET")
    type_id = port("Module RJ45", "COPPER", socket)
    _, (peer,) = typed_points("Peer", type_id)
    base = client.post("/v1/library/base-templates", json={
        "name": "Chassis", "body": {"kind": "RECTANGLE", "width": 100, "height": 40},
        "panels": [{"panel_key": "panel", "panel_number": 1, "display_name": "Panel",
                    "x": 0, "y": 0, "width": 100, "height": 40}],
        "slots": [], "internal_links": [],
        "bays": [{"bay_key": "bay", "display_name": "Bay", "compatibility": "TEST",
                  "panel_key": "panel", "x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8}],
    })
    assert base.status_code == 201, base.text
    obj = client.post("/v1/topology/physical-objects", json={
        "display_name": "Chassis", "base_template_id": base.json()["blueprint_ref"]["entity_id"],
    })
    assert obj.status_code == 201, obj.text
    owner = obj.json()["physical_object_ref"]["entity_id"]
    module = client.post("/v1/library/module-templates", json={
        "name": "Module", "compatibility": "TEST", "geometry": initial_geometry(["p"]),
        "endpoints": [{"key": "p", "display_name": "Port", "port_type_id": type_id, "kind": "NETWORK_PORT"}],
    })
    assert module.status_code == 201, module.text
    installation = client.post(f"/v1/topology/physical-objects/{owner}/module-installations", json={
        "module_template_id": module.json()["template_id"], "bay_key": "bay", "orientation": "HORIZONTAL",
    })
    assert installation.status_code == 201, installation.text
    (endpoint,) = installation.json()["bays"][0]["installation"]["endpoints"]
    payload = {**pair(endpoint["connection_point_id"], peer), **cable_spec("COPPER", plug, plug)}
    assert preview(CREATE, payload)["verdict"] == "ALLOW"


def test_reconnect_checks_the_matching_end_and_rechecks_changed_data_under_locks():
    plug = connector("Cable RJ45", "RJ45", "PLUG")
    socket = connector("Port RJ45", "RJ45", "SOCKET")
    type_id = port("RJ45 port", "COPPER", socket)
    _, (a,) = typed_points("Source", type_id)
    _, b = create_object_with_point(client, "Passive ODF")
    owner, (destination,) = typed_points("Destination", type_id)
    payload = {**pair(a, b), **cable_spec("COPPER", a=plug), "cable_label": "CAB01/1/48"}
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
    assert check["ends"][0]["verdict"] == "ALLOW"
    assert check["ends"][1]["reasons"] == ["CABLE_CONNECTOR_UNSPECIFIED"]
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
    assert "PORT_TYPE_UNRESOLVED" in fresh["ends"][1]["reasons"]
    response = client.post(url, json=confirmed_payload(fresh, move))
    assert response.status_code == 204, response.text
    after = snapshot()
    assert before["canonical"]["Cable"] == after["canonical"]["Cable"]
    assert before["canonical"]["ConnectionMember"] == after["canonical"]["ConnectionMember"]
    assert before["settings"]["CableLabelHistory"] == after["settings"]["CableLabelHistory"]
    assert client.get(url).json()["expected"] == {**expected, "point_b_id": destination}
