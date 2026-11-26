import uuid

import pytest
from sqlalchemy import delete

from app.database import SessionLocal
from app.models import Cable, ConnectionMember
from app.repository import CanonicalRepository, ConnectionMemberInput
from perf.l1_trace import INTERFACE, OBJECT, profile
from tests.test_cable_reconnect_e2e import preview as reconnect_preview
from tests.test_hardware_configuration import board_base_payload, client, create_base, create_object
from tests.test_module_reconciliation import package
from tests.test_nested_module_installations import created, install, physical_transceiver
from tests.test_parent_hardware_interfaces import create_installation, hardware
from tests.test_passive_module_continuity import create_module, module_definition, points
from tests.test_transceiver_binding import point_end, replace, replacement_input, replacement_preview


def point(address, member=1):
    return {"point_id": address, "member_index": member}


def exact(a, b):
    return {"from": a, "to": b}


def trace(query):
    response = client.post("/v1/traces/l1", json=query)
    assert response.status_code == 200, response.text
    return response.json()


def line(repo, left, right, mode, *, direct=False):
    connection, _ = repo.add_connection(
        uuid.UUID(left["point_id"]), uuid.UUID(right["point_id"]), 1,
        [ConnectionMemberInput(1, left["member_index"], right["member_index"])],
    )
    if direct:
        return connection.id
    cable = Cable(connection_id=connection.id, fiber_type=mode)
    repo.session.add(cable)
    repo.session.flush()
    return str(cable.id)


def panel(capacity, mappings, modes, medium="FIBER"):
    definition = module_definition(mappings, capacity=capacity)
    port_type = created(client.post("/v1/port-types", json={
        "name": f"Panel {medium} {capacity}", "medium": medium, "color": "#336699",
        "members": [f"Channel {i}" for i in range(capacity)], "compatibility_mode": "SAME_TYPE",
    }))
    for terminal in definition["endpoints"]:
        terminal["port_type_id"] = port_type["id"]
    for mapping, mode in zip(definition["internal_links"][0]["member_mappings"], modes, strict=True):
        if mode is not None:
            mapping["fiber_type"] = mode
    module = create_module(definition)
    host, base = create_base(board_base_payload())
    owner = create_object(host)["physical_object_ref"]["entity_id"]
    config = created(install(owner, module, base["bays"][0]["bay_key"]))
    ends = points(config["bays"][0]["installation"])
    return ends["rear"], ends["front"], module["revision_id"]


@pytest.mark.parametrize("near,far,wire,expected,kind", [
    ("SM", "SM", ("SM", "SM", "SM"), "CONSISTENT", None),
    ("MM", "MM", ("MM", "MM", "MM"), "CONSISTENT", None),
    ("SM", "SM", ("SM", "MM", "SM"), "CONFLICT", "LOCAL"),
    ("SM", "MM", ("SM", "NO_FIBER", "MM"), "CONFLICT", "LOCAL"),
    ("SM", "MM", (None, None, None), "CONFLICT", "END_TO_END"),
    ("SM", "SM", (None, None, None), "UNKNOWN", None),
    ("SM", "SM", ("SM", "NO_FIBER", "SM"), "CONSISTENT", None),
    ("COPPER", "COPPER", (None, None, None), "NOT_APPLICABLE", None),
    ("SM", "MM", ("DIRECT", None, None), "CONFLICT", "END_TO_END"),
])
def test_exact_trace_characteristics(hardware, near, far, wire, expected, kind):
    copper = near == "COPPER"
    medium = "COPPER" if copper else "FIBER"
    definition = physical_transceiver(hardware[-1], medium=medium)
    optics = {mode: created(client.post("/v1/library/module-templates", json={
        **definition, "name": mode, "transceiver": {} if copper else {"fiber_type": mode},
    })) for mode in {near, far}}
    ends = []
    for mode in (near, far):
        owner, _, _ = create_installation(hardware)
        cfg = created(install(owner, optics[mode], "direct"))
        ends.append(point(cfg["bays"][1]["installation"]["endpoints"][0]["connection_point_id"]))

    rear, front, revision = panel(2, [(1, 2)], [wire[1]], medium)
    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)
        line(repo, ends[0], point(rear), wire[0] if wire[0] != "DIRECT" else None, direct=wire[0] == "DIRECT")
        line(repo, point(front, 2), ends[1], wire[2])

    before = package()
    for a, b, members in ((ends[0], ends[1], [point(rear), point(front, 2)]),
                          (ends[1], ends[0], [point(front, 2), point(rear)])):
        result = trace(exact(a, b))
        assert result["verdict"] == "REACHABLE"
        diagnostic, = result["optical_diagnostics"]
        assert diagnostic["status"] == expected
        facts = diagnostic["facts"]
        assert facts[0]["points"] == [a]
        assert facts[-1]["points"] == [b]
        assert facts[2]["points"] == members
        assert facts[2]["provenance"]["revision_id"] == revision
        assert facts[2]["trace_edge_id"] == result["edges"][1]["id"]
        assert facts[2]["value"] == ("COPPER" if copper else wire[1])
        if wire[0] == "DIRECT":
            direct, = [f for f in facts if f["source"] == "DIRECT_CONNECTION"]
            assert direct["unknown_reason"] == "DIRECT_CONSTRUCTION_UNKNOWN"
        if kind is not None:
            assert {item["kind"] for item in diagnostic["conflicts"]} == {kind}
            for conflict in diagnostic["conflicts"]:
                assert {facts[conflict[field]]["value"] for field in ("left_fact", "right_fact")} == {"SM", "MM"}
                assert bool(conflict["unknown_facts"]) == (kind == "END_TO_END")
        else:
            assert diagnostic["conflicts"] == []
    assert package() == before


def test_incomplete_trace_conflicts_stop_at_active_boundary(hardware):
    definition = physical_transceiver(hardware[-1])
    mm = created(client.post("/v1/library/module-templates", json={
        **definition, "transceiver": {"fiber_type": "MM"},
    }))
    owner, _, _ = create_installation(hardware)
    cfg = created(install(owner, mm, "direct"))
    target = point(cfg["bays"][1]["installation"]["endpoints"][0]["connection_point_id"])
    rear, front, _ = panel(2, [(1, 2)], ["SM"])
    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)
        source = point(str(repo.add_connection_point(repo.add_physical_object().id, 1).id))
        cable_id = line(repo, source, point(rear), "MM")
    query = exact(source, target)
    result = trace(query)
    assert result["verdict"] == "UNKNOWN"
    proof, = result["optical_diagnostics"]
    assert proof["status"] == "CONFLICT" and proof["conflicts"][0]["kind"] == "LOCAL"
    assert proof["termination"]["reason"] == "MISSING_EXTERNAL_CONNECTION"
    assert all(target not in fact["points"] for fact in proof["facts"])

    assert client.put(f"/v1/cables/{cable_id}/fiber-type", json={"fiber_type": "SM"}).status_code == 204
    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)
        active = repo.add_network_interface()
        repo.add_interface_physical_binding(active.id, uuid.UUID(front), 2)
        line(repo, point(front, 2), target, "MM")
    before = package()
    proof, = trace(query)["optical_diagnostics"]
    assert proof["status"] == "UNKNOWN"
    assert proof["termination"]["reason"] == "OTHER_ENDING"
    assert [fact["value"] for fact in proof["facts"]] == ["SM", "SM", None]
    assert all(target not in fact["points"] for fact in proof["facts"])
    assert package() == before


def test_group_and_composed_traces_keep_channel_diagnostics_independent():
    rear, front, _ = panel(3, [(1, 3), (2, 1), (3, 2)], ["SM", "MM", None])
    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)
        a, b = [repo.add_physical_object() for _ in range(2)]
        a_id, b_id = str(a.id), str(b.id)
        left, right = [str(repo.add_connection_point(owner.id, 3).id) for owner in (a, b)]
        first, second = [repo.add_network_interface() for _ in range(2)]
        interface_ids = (str(first.id), str(second.id))
        expected = []
        for i, j in ((1, 3), (2, 1), (3, 2)):
            line(repo, point(left, i), point(rear, i), "SM")
            line(repo, point(front, j), point(right, j), "SM")
            expected.append(exact(point(left, i), point(right, j)))
            repo.add_interface_physical_binding(first.id, uuid.UUID(left), i)
            repo.add_interface_physical_binding(second.id, uuid.UUID(right), j)

    before = package()
    grouped = client.post("/v1/traces/l1/group", json={"expected_pairs": expected}).json()
    statuses = ["UNKNOWN", "CONFLICT", "UNKNOWN"]
    assert [row["optical_diagnostics"][0]["status"] for row in grouped["results"]] == statuses
    assert grouped["completeness"] == "COMPLETE"
    for route, query in (
        (OBJECT, {"from_physical_object_id": a_id, "to_physical_object_id": b_id}),
        (INTERFACE, dict(zip(("from_interface_id", "to_interface_id"), interface_ids, strict=True))),
    ):
        with profile() as (counts, _):
            response = client.post(route, json=query)
        assert response.status_code == 200, response.text
        assert counts["walks"] == 3
        assert len(response.json()["branches"]) == 3
        for branch in response.json()["branches"]:
            diagnostic = branch["optical_diagnostic"]
            assert diagnostic["status"] == statuses[diagnostic["facts"][0]["points"][0]["member_index"] - 1]
            assert {f["trace_edge_id"] for f in diagnostic["facts"] if f["trace_edge_id"]} <= set(branch["edge_ids"])
    assert package() == before


def test_damaged_canonical_model_preserves_l1_error_localization():
    rear, front, _ = panel(2, [(1, 2)], ["SM"])
    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)
        target = point(str(repo.add_connection_point(repo.add_physical_object().id, 1).id))
        damaged = line(repo, point(front, 2), target, None, direct=True)
        session.execute(delete(ConnectionMember).where(ConnectionMember.connection_id == damaged))
    query = exact(point(rear), target)
    standalone = client.post("/v1/traces/l1", json=query)
    assert standalone.status_code == 409 and standalone.json()["error"]["code"] == "MODEL_ERROR"
    response = client.post("/v1/traces/l1/group", json={"expected_pairs": [query]})
    result, = response.json()["results"]
    assert result["terminations"][0]["reason"] == "INVALID_CANONICAL_DATA"
    diagnostic, = result["optical_diagnostics"]
    assert diagnostic["termination"] == result["terminations"][0]
    assert diagnostic["facts"][0]["value"] == "SM"


def test_reconnect_and_transceiver_replacement_preview_are_advisory(hardware):
    definition = physical_transceiver(hardware[-1])
    sm = created(client.post("/v1/library/module-templates", json=definition))
    mm = created(client.post("/v1/library/module-templates", json={
        **definition, "name": "Multimode", "transceiver": {"fiber_type": "MM"},
    }))
    source, spare, destination = [create_installation(hardware) for _ in range(3)]
    source_config, spare_config, destination_config = [
        created(install(owner, optic, "direct")) for (owner, _, _), optic in zip(
            (source, spare, destination), (sm, sm, mm), strict=True,
        )
    ]
    installed, spare_end, target_end = [config["bays"][1]["installation"] for config in
                                        (source_config, spare_config, destination_config)]
    left, old_right, new_right = [module["endpoints"][0]["connection_point_id"] for module in
                                  (installed, spare_end, target_end)]
    url = "/v1/topology/physical-connections"
    connection = {"source": point_end(left), "target": point_end(old_right), "fiber_type": "SM"}
    preview = client.post(url, params={"preview": True}, json=connection).json()
    assert preview["verdict"] == "ALLOW"
    assert preview["pairs"][0]["optical_diagnostic"]["status"] == "CONSISTENT"
    cable = created(client.post(url, json=connection))["cable_ref"]["entity_id"]

    reconnect = f"/v1/cables/{cable}/reconnect"
    payload = {"expected": reconnect_preview(reconnect), "side": "B", "new_point_id": new_right}
    before = package()
    preview = client.post(reconnect + "/compatibility-preview", json=payload).json()
    assert preview["verdict"] == "ALLOW"
    assert [fact["value"] for fact in preview["pairs"][0]["optical_diagnostic"]["facts"]] == ["SM", "SM", "MM"]
    assert package() == before
    assert client.post(reconnect, json=payload).status_code == 204

    replacement = replacement_input(source_config, source[2], installed, mm)
    replacement["cable_assignments"] = [{"cable_id": cable, "member_index": 1}]
    before = package()
    preview = replacement_preview(source[0], installed["id"], replacement)["compatibility"]
    assert preview["verdict"] == "ALLOW"
    diagnostic = preview["pairs"][0]["optical_diagnostic"]
    assert diagnostic["status"] == "CONFLICT"
    assert diagnostic["facts"][0]["provenance"]["revision_id"] == mm["revision_id"]
    assert diagnostic["facts"][0]["proposed_endings"] == [
        {"interface_id": replacement["interface_id"], "member_index": 1, "side": "A"},
    ]
    assert package() == before
    replacement["compatibility"] = {"token": preview["token"]}
    updated = replace(source[0], installed["id"], replacement)
    assert updated.status_code == 200, updated.text
    assert client.get(f"/v1/cables/{cable}/fiber-type").json() == {"fiber_type": "SM"}

def test_optical_values_use_the_same_snapshot_as_trace(monkeypatch):
    from app import main

    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)
        left, right = [point(str(repo.add_connection_point(repo.add_physical_object().id, 1).id))
                       for _ in range(2)]
        cable_id = line(repo, left, right, "SM")
    original = main.diagnose_exact_traces
    changed = False

    def change_after_walk(session, results):
        nonlocal changed
        if not changed:
            with SessionLocal.begin() as writer:
                writer.get(Cable, uuid.UUID(cable_id)).fiber_type = "MM"
            changed = True
        original(session, results)

    monkeypatch.setattr(main, "diagnose_exact_traces", change_after_walk)
    query = exact(left, right)
    assert trace(query)["optical_diagnostics"][0]["facts"][0]["value"] == "SM"
    assert trace(query)["optical_diagnostics"][0]["facts"][0]["value"] == "MM"


def test_interface_connection_preview_names_unmaterialized_endings():
    with SessionLocal.begin() as session:
        repo = CanonicalRepository(session)
        interfaces = []
        for _ in range(2):
            interface = repo.add_network_interface().id
            repo.add_network_interface_physical_owner(interface, repo.add_physical_object().id)
            interfaces.append(str(interface))
    snapshot = package()
    response = client.post("/v1/topology/physical-links", params={"preview": True}, json={
        "source_interface_id": interfaces[0], "target_interface_id": interfaces[1], "fiber_type": "MM",
    })
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["verdict"] == "UNKNOWN"
    diagnostic = preview["pairs"][0]["optical_diagnostic"]
    assert diagnostic["status"] == "UNKNOWN"
    assert diagnostic["facts"][1]["value"] == "MM"
    assert diagnostic["facts"][1]["proposed_endings"] == [
        {"side": side, "interface_id": identifier, "member_index": 1}
        for side, identifier in zip(("A", "B"), interfaces, strict=True)
    ]
    assert package() == snapshot
