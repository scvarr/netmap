import uuid

import pytest
from sqlalchemy import select

from app.database import SessionLocal
from app.models import Cable, Connection, ConnectionMember, ConnectionPoint, SavedMap
from app.repository import CanonicalRepository, ConnectionMemberInput
from tests.l1_builders import connect_trace_points, create_endpoint_cable, post_confirmed_physical
from tests.test_hardware_configuration import client
from tests.test_passive_module_continuity import points, setup
from tests.test_physical_compatibility_e2e import port, typed_points


def pair(left, a, right, b):
    return {
        "from": {"point_id": str(left), "member_index": a},
        "to": {"point_id": str(right), "member_index": b},
    }


def exact(expected):
    response = client.post("/v1/traces/l1", json=expected)
    assert response.status_code == 200, response.text
    return response.json()


def group(*expected):
    response = client.post("/v1/traces/l1/group", json={"expected_pairs": expected})
    assert response.status_code == 200, response.text
    result = response.json()
    assert [item["query"] for item in result["results"]] == list(expected)
    return result


def assert_ending(result, reason, address):
    termination, = result["terminations"]
    assert termination["reason"] == reason
    node = next(node for node in result["nodes"] if node["id"] == termination["node_id"])
    assert node["payload"] == address


def test_rear_24_subset_permutation_and_resolved_evidence_after_reload():
    _, _, oid, document = setup([(24, 2), (3, 19)], capacity=24, count=2)
    first, second = [points(bay["installation"]) for bay in document["bays"]]
    rear, front = first["rear"], first["front"]
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        terminal = repository.add_connection_point(repository.add_physical_object().id, 2)
        terminal_id = terminal.id
        interface = repository.add_network_interface()
        for index, (front_index, destination_index) in enumerate([(2, 1), (19, 2)], 1):
            repository.add_interface_physical_binding(interface.id, terminal_id, index)
            connect_trace_points(repository, session.get(ConnectionPoint, uuid.UUID(front)), terminal,
                                 members=[ConnectionMemberInput(1, front_index, destination_index)])

    mapped = [pair(rear, 24, terminal_id, 1), pair(rear, 3, terminal_id, 2)]
    spare = pair(rear, 4, terminal_id, 2)
    foreign = pair(rear, 24, second["front"], 2)
    wrong = pair(rear, 24, terminal_id, 2)
    assert group(mapped[1])["completeness"] == "COMPLETE"
    complete = group(*mapped)
    assert complete["completeness"] == "COMPLETE"
    assert group(mapped[0], spare)["completeness"] == "PARTIAL"
    assert group(wrong)["completeness"] == "UNCONFIRMED"
    assert group(foreign)["completeness"] == "UNCONFIRMED"
    assert_ending(exact(wrong), "OTHER_ENDING", mapped[0]["to"])
    assert_ending(exact(spare), "NO_CONNECTION", spare["from"])
    assert exact(pair(rear, 24, front, 2))["verdict"] == "REACHABLE"
    assert exact(pair(rear, 24, front, 19))["verdict"] == "UNKNOWN"

    # A different DB session resolves every reference and checks both ordered hops.
    with SessionLocal() as session:
        assert session.scalar(select(SavedMap.id)) is None
        for artifact, expected in zip(complete["results"], mapped):
            assert artifact == exact(expected)
            internal, external = artifact["edges"]
            for hop in (internal, external):
                by_type = {}
                for ref in hop["evidence_refs"]:
                    entity = {"Cable": Cable, "Connection": Connection, "ConnectionMember": ConnectionMember,
                              "ConnectionPoint": ConnectionPoint}[ref["entity_type"]]
                    row = session.get(entity, uuid.UUID(ref["entity_id"]))
                    assert row is not None
                    by_type.setdefault(entity, []).append(row)
                connection, = by_type[Connection]
                member, = by_type[ConnectionMember]
                assert member.connection_id == connection.id
                assert {p.id for p in by_type[ConnectionPoint]} == {connection.point_a_id, connection.point_b_id}
                source_node, target_node = [
                    next(node["payload"] for node in artifact["nodes"] if node["id"] == hop[key])
                    for key in ("from_node_id", "to_node_id")
                ]
                assert {(str(connection.point_a_id), member.point_a_member),
                        (str(connection.point_b_id), member.point_b_member)} == {
                    (node["point_id"], node["member_index"]) for node in (source_node, target_node)
                }
                if hop is external:
                    cable, = by_type[Cable]
                    assert cable.connection_id == connection.id
                else:
                    assert Cable not in by_type

    object_trace = client.post("/v1/traces/physical-objects/l1", json={
        "from_physical_object_id": oid,
        "to_physical_object_id": str(terminal.physical_object_id),
    })
    assert object_trace.status_code == 200
    assert object_trace.json()["verdict"] == "REACHABLE"


@pytest.mark.parametrize("permutation", [(1, 2), (2, 1)])
def test_duplex_members_on_shared_interface(permutation):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        left, right = [repository.add_connection_point(repository.add_physical_object().id, 2)
                       for _ in range(2)]
        interfaces = [repository.add_network_interface() for _ in range(2)]
        for point, interface in zip((left, right), interfaces):
            for index in (1, 2):
                repository.add_interface_physical_binding(interface.id, point.id, index)
        for source, target in enumerate(permutation, 1):
            connect_trace_points(repository, left, right, members=[ConnectionMemberInput(1, source, target)])
    expected = [pair(left.id, i, right.id, j) for i, j in enumerate(permutation, 1)]
    assert group(*expected)["completeness"] == "COMPLETE"
    assert group(pair(left.id, 1, right.id, permutation[1]))["completeness"] == "UNCONFIRMED"
    assert exact(pair(left.id, 1, left.id, 2))["verdict"] == "UNKNOWN"


def cable_ref(artifact):
    return next(ref["entity_id"] for ref in artifact["evidence_refs"] if ref["entity_type"] == "Cable")


def test_copper_cable_reconnect_preserves_line_evidence_at_the_new_address():
    copper = port("RJ45", "COPPER", "SAME_TYPE")
    _, (left,) = typed_points("Left", copper)
    _, (right,) = typed_points("Right", copper)
    _, (destination,) = typed_points("Destination", copper)
    cable = create_endpoint_cable(client, left, right)
    cable_id = cable["cable_ref"]["entity_id"]
    before = exact(pair(left, 1, right, 1))
    assert before["verdict"] == "REACHABLE"
    assert len(before["edges"]) == 1
    assert cable_ref(before) == cable_id

    url = f"/v1/cables/{cable_id}/reconnect"
    preview = client.get(url)
    assert preview.status_code == 200, preview.text
    expected = preview.json()["expected"]
    side = "A" if expected["point_a_id"] == left else "B"
    response = post_confirmed_physical(client, url, json={
        "expected": expected, "side": side, "new_point_id": destination,
    })
    assert response.status_code == 204, response.text
    old = exact(pair(left, 1, right, 1))
    new = exact(pair(destination, 1, right, 1))
    assert old["verdict"] == "UNKNOWN"
    assert old["edges"] == []
    assert new["verdict"] == "REACHABLE"
    line_refs = {"Connection", "ConnectionMember", "Cable"}
    assert [ref for ref in before["evidence_refs"] if ref["entity_type"] in line_refs] == [
        ref for ref in new["evidence_refs"] if ref["entity_type"] in line_refs
    ]
    assert {ref["entity_id"] for ref in new["evidence_refs"] if ref["entity_type"] == "ConnectionPoint"} == {
        destination, right,
    }


def test_break_then_disconnect_and_reconnect_refreshes_evidence():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        left_object, panel, right_object = [repository.add_physical_object() for _ in range(3)]
        left = repository.add_connection_point(left_object.id, 1)
        rear = repository.add_connection_point(panel.id, 1)
        front = repository.add_connection_point(panel.id, 1)
        right = repository.add_connection_point(right_object.id, 1)
        connect_trace_points(repository, left, rear)
    expected = pair(left.id, 1, right.id, 1)
    missing_internal = exact(expected)
    assert len(missing_internal["edges"]) == 1
    assert_ending(missing_internal, "MISSING_INTERNAL_CONTINUITY", pair(left.id, 1, rear.id, 1)["to"])
    with SessionLocal.begin() as session:
        connect_trace_points(CanonicalRepository(session), rear, front)
    missing_external = exact(expected)
    assert len(missing_external["edges"]) == 2
    assert_ending(missing_external, "MISSING_EXTERNAL_CABLE", pair(left.id, 1, front.id, 1)["to"])

    create_endpoint_cable(client, str(front.id), str(right.id))
    first = exact(pair(front.id, 1, right.id, 1))
    removed_id = cable_ref(first)
    assert exact(expected)["verdict"] == "REACHABLE"
    response = client.delete(f"/v1/cables/{removed_id}")
    assert response.status_code == 204, response.text
    assert exact(expected) == missing_external
    create_endpoint_cable(client, str(front.id), str(right.id))
    second = exact(pair(front.id, 1, right.id, 1))
    assert second["verdict"] == "REACHABLE"
    assert cable_ref(second) != removed_id
    for entity in ("Cable", "Connection", "ConnectionMember"):
        assert not ({ref["entity_id"] for ref in first["evidence_refs"] if ref["entity_type"] == entity}
                    & {ref["entity_id"] for ref in second["evidence_refs"] if ref["entity_type"] == entity})


@pytest.mark.parametrize("termination", ["OTHER_ENDING", "INVALID_CANONICAL_DATA"])
def test_preserves_prefix_at_active_end_or_corrupt_continuity(termination):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        left_object, panel, right_object = [repository.add_physical_object() for _ in range(3)]
        left = repository.add_connection_point(left_object.id, 1)
        rear = repository.add_connection_point(panel.id, 1)
        front = repository.add_connection_point(panel.id, 1)
        right = repository.add_connection_point(right_object.id, 1)
        connect_trace_points(repository, left, rear)
        _, members = connect_trace_points(repository, rear, front)
        connect_trace_points(repository, front, right)
        if termination == "OTHER_ENDING":
            repository.add_interface_physical_binding(repository.add_network_interface().id, rear.id, 1)
        else:
            members[0].point_b_member = 2
    artifact = exact(pair(left.id, 1, right.id, 1))
    assert artifact["verdict"] == "UNKNOWN"
    assert len(artifact["edges"]) == 1
    assert_ending(artifact, termination, pair(left.id, 1, rear.id, 1)["to"])
    if termination == "OTHER_ENDING":
        assert exact(pair(left.id, 1, rear.id, 1))["verdict"] == "REACHABLE"
        assert exact(pair(right.id, 1, left.id, 1))["verdict"] == "UNKNOWN"


def test_group_validates_nonempty_one_to_one_exact_addresses():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        left, right = [repository.add_connection_point(repository.add_physical_object().id, 2)
                       for _ in range(2)]
    first = pair(left.id, 1, right.id, 1)
    cases = [
        [],
        [first, first],
        [first, pair(left.id, 1, right.id, 2)],
        [first, pair(left.id, 2, right.id, 1)],
        [pair(left.id, 1, left.id, 1)],
        [pair(left.id, 0, right.id, 1)],
        [pair(left.id, 3, right.id, 1)],
        [pair(uuid.uuid4(), 1, right.id, 1)],
        [pair(left.id, True, right.id, 1)],
    ]
    for expected in cases:
        response = client.post("/v1/traces/l1/group", json={"expected_pairs": expected})
        assert response.status_code == 422, (expected, response.text)


@pytest.mark.parametrize("damage", ["missing_mapping", "duplicate_external", "cross_installation"])
def test_canonical_damage_only_invalidates_the_affected_pair(damage):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        left, right, other = [
            repository.add_connection_point(repository.add_physical_object().id, 2)
            for _ in range(3)
        ]
        connect_trace_points(repository, left, right)
        if damage == "missing_mapping":
            isolated = repository.add_connection_point(repository.add_physical_object().id, 1)
            session.add(Connection(point_a_id=isolated.id, point_b_id=other.id, cardinality=1))
            failed = pair(other.id, 2, right.id, 2)
        elif damage == "duplicate_external":
            for peer in (right, other):
                connect_trace_points(repository, left, peer, members=[ConnectionMemberInput(1, 2, 2)])
            failed = pair(left.id, 2, right.id, 2)

    if damage == "cross_installation":
        _, _, _, document = setup([(1, 1)], capacity=2, count=2)
        first, second = [points(bay["installation"]) for bay in document["bays"]]
        with SessionLocal.begin() as session:
            CanonicalRepository(session).add_connection(
                uuid.UUID(first["rear"]), uuid.UUID(second["front"]), 1, [ConnectionMemberInput(1, 2, 2)]
            )
        failed = pair(first["rear"], 2, second["front"], 2)

    result = group(pair(left.id, 1, right.id, 1), failed)
    assert result["completeness"] == "PARTIAL"
    assert result["results"][0]["verdict"] == "REACHABLE"
    assert result["results"][1]["edges"] == []
    assert_ending(result["results"][1], "INVALID_CANONICAL_DATA", failed["from"])
