import os

import httpx
import pytest

from app.database import SessionLocal
from app.models import L2EgressRule
from app.repository import CanonicalRepository, ConnectionMemberInput


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def stack(*labels):
    return [{"kind": kind, "value": value} for kind, value in labels]


def trace(source_id, source_stack, target_id, target_stack):
    return httpx.post(
        f"{BASE_URL}/v1/traces/l2/reachability",
        json={
            "from": {
                "interface_id": str(source_id),
                "encapsulation_stack": source_stack,
            },
            "to": {
                "interface_id": str(target_id),
                "encapsulation_stack": target_stack,
            },
        },
        timeout=5,
    )


def configured_path(source_stack, target_stack):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        context = repository.add_l2_forwarding_context()
        source_binding = repository.add_l2_binding(source.id, context.id)
        target_binding = repository.add_l2_binding(target.id, context.id)
        ingress = repository.add_l2_ingress_rule(source_binding.id, source_stack)
        egress = repository.add_l2_egress_rule(target_binding.id, target_stack)
        return {
            "source": source.id,
            "target": target.id,
            "context": context.id,
            "source_binding": source_binding.id,
            "target_binding": target_binding.id,
            "ingress": ingress.id,
            "egress": egress.id,
        }


@pytest.mark.parametrize(
    ("source_stack", "target_stack"),
    [
        ([], []),
        (stack(("dot1q", 100)), stack(("dot1q", 100))),
        (stack(("dot1q", 100)), stack(("dot1q", 200))),
    ],
    ids=["access-like", "tagged-trunk-like", "vlan-translation"],
)
def test_configured_local_l2_path_is_reachable(source_stack, target_stack):
    facts = configured_path(source_stack, target_stack)

    response = trace(facts["source"], source_stack, facts["target"], target_stack)

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "REACHABLE"
    assert artifact["gaps"] == []
    assert [edge["transition_kind"] for edge in artifact["edges"]] == [
        "INGRESS_DECODE",
        "LOCAL_FORWARD",
        "EGRESS_ENCODE",
    ]
    expected_refs = {
        ("NetworkInterface", str(facts["source"])),
        ("NetworkInterface", str(facts["target"])),
        ("L2ForwardingContext", str(facts["context"])),
        ("L2Binding", str(facts["source_binding"])),
        ("L2Binding", str(facts["target_binding"])),
        ("L2IngressRule", str(facts["ingress"])),
        ("L2EgressRule", str(facts["egress"])),
    }
    assert {
        (ref["entity_type"], ref["entity_id"]) for ref in artifact["evidence_refs"]
    } == expected_refs


def test_same_numeric_vlan_in_different_contexts_does_not_create_reachability():
    tagged = stack(("dot1q", 100))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        source_context = repository.add_l2_forwarding_context()
        target_context = repository.add_l2_forwarding_context()
        source_binding = repository.add_l2_binding(source.id, source_context.id)
        target_binding = repository.add_l2_binding(target.id, target_context.id)
        repository.add_l2_ingress_rule(source_binding.id, tagged)
        repository.add_l2_egress_rule(target_binding.id, tagged)
        source_id, target_id = source.id, target.id

    response = trace(source_id, tagged, target_id, tagged)

    assert response.status_code == 200
    assert response.json()["verdict"] == "UNKNOWN"
    assert response.json()["gaps"][0]["code"] == "L2_TARGET_CONTEXT_PATH_UNKNOWN"


def test_missing_ingress_rule_is_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        source_id, target_id = source.id, target.id

    response = trace(source_id, [], target_id, [])

    assert response.status_code == 200
    assert response.json()["verdict"] == "UNKNOWN"
    assert response.json()["gaps"][0]["code"] == "L2_INGRESS_RULE_UNKNOWN"


def test_missing_egress_rule_is_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        context = repository.add_l2_forwarding_context()
        source_binding = repository.add_l2_binding(source.id, context.id)
        repository.add_l2_binding(target.id, context.id)
        repository.add_l2_ingress_rule(source_binding.id, [])
        source_id, target_id = source.id, target.id

    response = trace(source_id, [], target_id, [])

    assert response.status_code == 200
    assert response.json()["verdict"] == "UNKNOWN"
    assert response.json()["gaps"][0]["code"] == "L2_EGRESS_RULE_UNKNOWN"


def test_ambiguous_exact_ingress_mapping_is_unknown():
    tagged = stack(("dot1q", 100))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        for _ in range(2):
            context = repository.add_l2_forwarding_context()
            source_binding = repository.add_l2_binding(source.id, context.id)
            target_binding = repository.add_l2_binding(target.id, context.id)
            repository.add_l2_ingress_rule(source_binding.id, tagged)
            repository.add_l2_egress_rule(target_binding.id, tagged)
        source_id, target_id = source.id, target.id

    response = trace(source_id, tagged, target_id, tagged)

    assert response.status_code == 200
    assert response.json()["verdict"] == "UNKNOWN"
    assert response.json()["gaps"][0]["code"] == "L2_INGRESS_AMBIGUOUS"


def test_requested_egress_stack_mismatch_is_unknown():
    facts = configured_path([], stack(("dot1q", 100)))

    response = trace(facts["source"], [], facts["target"], stack(("dot1q", 200)))

    assert response.status_code == 200
    assert response.json()["verdict"] == "UNKNOWN"
    assert response.json()["gaps"][0]["code"] == "L2_TARGET_CONTEXT_PATH_UNKNOWN"


def test_corrupted_canonical_encapsulation_stack_is_model_error():
    facts = configured_path([], [])
    with SessionLocal.begin() as session:
        rule = session.get(L2EgressRule, facts["egress"])
        assert rule is not None
        rule.emit_stack = [{"kind": "dot1q"}]

    response = trace(facts["source"], [], facts["target"], [])

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def configured_one_hop(
    *,
    wire_stack=None,
    target_stack=None,
    passive=False,
    realization=False,
    branches=1,
    remote_match=True,
    remote_ambiguous=False,
    target_in_remote_context=True,
    source_egress=True,
    physical=True,
):
    wire_stack = wire_stack if wire_stack is not None else stack(("dot1q", 100))
    target_stack = target_stack if target_stack is not None else []
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        source_uplink = repository.add_network_interface()
        remote_uplink = repository.add_network_interface()
        target = repository.add_network_interface()
        source_context = repository.add_l2_forwarding_context()
        remote_context = repository.add_l2_forwarding_context()
        target_context = (
            remote_context
            if target_in_remote_context
            else repository.add_l2_forwarding_context()
        )
        source_binding = repository.add_l2_binding(source.id, source_context.id)
        source_uplink_binding = repository.add_l2_binding(
            source_uplink.id, source_context.id
        )
        remote_uplink_binding = repository.add_l2_binding(
            remote_uplink.id, remote_context.id
        )
        target_binding = repository.add_l2_binding(target.id, target_context.id)
        repository.add_l2_ingress_rule(source_binding.id, [])
        source_egress_rule = (
            repository.add_l2_egress_rule(source_uplink_binding.id, wire_stack)
            if source_egress
            else None
        )
        repository.add_l2_ingress_rule(
            remote_uplink_binding.id,
            wire_stack if remote_match else stack(("dot1q", 999)),
        )
        if remote_ambiguous:
            ambiguous_context = repository.add_l2_forwarding_context()
            ambiguous_binding = repository.add_l2_binding(
                remote_uplink.id, ambiguous_context.id
            )
            repository.add_l2_ingress_rule(ambiguous_binding.id, wire_stack)
        repository.add_l2_egress_rule(target_binding.id, target_stack)

        realization_ids = []
        physical_binding_ids = []
        connection_ids = []
        member_ids = []
        for _ in range(branches):
            source_physical = (
                repository.add_network_interface() if realization else source_uplink
            )
            remote_physical = (
                repository.add_network_interface() if realization else remote_uplink
            )
            if realization:
                realization_ids.extend(
                    [
                        repository.add_network_interface_realization(
                            source_uplink.id, source_physical.id
                        ).id,
                        repository.add_network_interface_realization(
                            remote_uplink.id, remote_physical.id
                        ).id,
                    ]
                )
            if not physical:
                continue
            left_object = repository.add_physical_object()
            right_object = repository.add_physical_object()
            left = repository.add_connection_point(left_object.id, 1)
            right = repository.add_connection_point(right_object.id, 1)
            physical_binding_ids.extend(
                [
                    repository.add_interface_physical_binding(
                        source_physical.id, left.id, 1
                    ).id,
                    repository.add_interface_physical_binding(
                        remote_physical.id, right.id, 1
                    ).id,
                ]
            )
            points = [left]
            if passive:
                for _ in range(2):
                    passive_object = repository.add_physical_object()
                    points.append(repository.add_connection_point(passive_object.id, 1))
            points.append(right)
            for point_a, point_b in zip(points, points[1:]):
                connection, members = repository.add_connection(
                    point_a.id,
                    point_b.id,
                    cardinality=1,
                    members=[
                        ConnectionMemberInput(
                            index=1, point_a_member=1, point_b_member=1
                        )
                    ],
                )
                connection_ids.append(connection.id)
                member_ids.append(members[0].id)
        return {
            "source": source.id,
            "target": target.id,
            "source_context": source_context.id,
            "remote_context": remote_context.id,
            "source_binding": source_binding.id,
            "source_uplink_binding": source_uplink_binding.id,
            "remote_uplink_binding": remote_uplink_binding.id,
            "target_binding": target_binding.id,
            "source_egress_rule": source_egress_rule.id if source_egress_rule else None,
            "realizations": realization_ids,
            "physical_bindings": physical_binding_ids,
            "connections": connection_ids,
            "members": member_ids,
        }


def test_configured_l2_reachability_across_one_physical_hop():
    facts = configured_one_hop()

    response = trace(facts["source"], [], facts["target"], [])

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["branches"]) == 1
    kinds = [
        next(edge for edge in artifact["edges"] if edge["id"] == edge_id)[
            "transition_kind"
        ]
        for edge_id in artifact["branches"][0]["edge_ids"]
    ]
    assert kinds == [
        "INGRESS_DECODE",
        "LOCAL_FORWARD",
        "EGRESS_ENCODE",
        "PHYSICAL_TRANSPORT",
        "INGRESS_DECODE",
        "LOCAL_FORWARD",
        "EGRESS_ENCODE",
    ]
    branch_types = {
        ref["entity_type"] for ref in artifact["branches"][0]["evidence_refs"]
    }
    assert {
        "NetworkInterface",
        "L2ForwardingContext",
        "L2Binding",
        "L2IngressRule",
        "L2EgressRule",
        "InterfacePhysicalBinding",
        "Connection",
        "ConnectionMember",
    } <= branch_types
    assert "NetworkInterfaceRealization" not in branch_types


def test_passive_l1_preserves_ordered_stack_and_target_can_translate():
    wire = stack(("dot1ad", 500), ("dot1q", 100))
    target_stack = stack(("dot1q", 200))
    facts = configured_one_hop(
        wire_stack=wire, target_stack=target_stack, passive=True
    )

    artifact = trace(facts["source"], [], facts["target"], target_stack).json()

    assert artifact["verdict"] == "REACHABLE"
    physical_edge = next(
        edge for edge in artifact["edges"] if edge["transition_kind"] == "PHYSICAL_TRANSPORT"
    )
    nodes = {node["id"]: node for node in artifact["nodes"]}
    assert nodes[physical_edge["from_node_id"]]["payload"]["encapsulation_stack"] == wire
    assert nodes[physical_edge["to_node_id"]]["payload"]["encapsulation_stack"] == wire
    assert len(
        [
            ref
            for ref in physical_edge["evidence_refs"]
            if ref["entity_type"] == "Connection"
        ]
    ) == 3


@pytest.mark.parametrize(
    ("options", "gap"),
    [
        ({"remote_match": False}, "L2_INGRESS_RULE_UNKNOWN"),
        ({"remote_ambiguous": True}, "L2_INGRESS_AMBIGUOUS"),
        ({"source_egress": False}, "L2_EGRESS_RULE_UNKNOWN"),
        ({"physical": False}, "L2_PHYSICAL_TRANSPORT_UNKNOWN"),
        (
            {"target_in_remote_context": False},
            "L2_TARGET_CONTEXT_PATH_UNKNOWN",
        ),
    ],
)
def test_one_hop_incomplete_branches_are_unknown(options, gap):
    facts = configured_one_hop(**options)

    artifact = trace(facts["source"], [], facts["target"], []).json()

    assert artifact["verdict"] == "UNKNOWN"
    assert gap in {item["code"] for item in artifact["gaps"]}


def test_realization_down_transport_up_is_reachable_with_evidence():
    facts = configured_one_hop(realization=True)

    artifact = trace(facts["source"], [], facts["target"], []).json()

    assert artifact["verdict"] == "REACHABLE"
    branch = artifact["branches"][0]
    edges = {edge["id"]: edge for edge in artifact["edges"]}
    assert [edges[edge_id]["transition_kind"] for edge_id in branch["edge_ids"]].count(
        "REALIZATION_DOWN"
    ) == 1
    assert [edges[edge_id]["transition_kind"] for edge_id in branch["edge_ids"]].count(
        "REALIZATION_UP"
    ) == 1
    assert {
        ref["entity_id"]
        for ref in branch["evidence_refs"]
        if ref["entity_type"] == "NetworkInterfaceRealization"
    } == {str(value) for value in facts["realizations"]}


def test_branching_realization_and_physical_candidates_preserves_all_proofs():
    facts = configured_one_hop(realization=True, branches=2)

    artifact = trace(facts["source"], [], facts["target"], []).json()

    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["branches"]) == 2
    used_connections = {
        ref["entity_id"]
        for branch in artifact["branches"]
        for ref in branch["evidence_refs"]
        if ref["entity_type"] == "Connection"
    }
    assert used_connections == {str(value) for value in facts["connections"]}


def add_physical_link(repository, left_interface, right_interface, *, passive=0):
    left_object = repository.add_physical_object()
    right_object = repository.add_physical_object()
    left = repository.add_connection_point(left_object.id, 1)
    right = repository.add_connection_point(right_object.id, 1)
    repository.add_interface_physical_binding(left_interface.id, left.id, 1)
    repository.add_interface_physical_binding(right_interface.id, right.id, 1)
    points = [left]
    for _ in range(passive):
        passive_object = repository.add_physical_object()
        points.append(repository.add_connection_point(passive_object.id, 1))
    points.append(right)
    connections = []
    for point_a, point_b in zip(points, points[1:]):
        connection, _ = repository.add_connection(
            point_a.id,
            point_b.id,
            cardinality=1,
            members=[
                ConnectionMemberInput(index=1, point_a_member=1, point_b_member=1)
            ],
        )
        connections.append(connection.id)
    return connections


def configured_two_hop(*, first_stack=None, second_stack=None, passive_hop=0):
    first_stack = first_stack if first_stack is not None else stack(("dot1q", 100))
    second_stack = second_stack if second_stack is not None else first_stack
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        sw1_uplink = repository.add_network_interface()
        sw2_ingress = repository.add_network_interface()
        sw2_egress = repository.add_network_interface()
        sw3_ingress = repository.add_network_interface()
        target = repository.add_network_interface()
        context_a = repository.add_l2_forwarding_context()
        context_b = repository.add_l2_forwarding_context()
        context_c = repository.add_l2_forwarding_context()

        source_binding = repository.add_l2_binding(source.id, context_a.id)
        sw1_binding = repository.add_l2_binding(sw1_uplink.id, context_a.id)
        sw2_ingress_binding = repository.add_l2_binding(
            sw2_ingress.id, context_b.id
        )
        sw2_egress_binding = repository.add_l2_binding(sw2_egress.id, context_b.id)
        sw3_binding = repository.add_l2_binding(sw3_ingress.id, context_c.id)
        target_binding = repository.add_l2_binding(target.id, context_c.id)
        repository.add_l2_ingress_rule(source_binding.id, [])
        repository.add_l2_egress_rule(sw1_binding.id, first_stack)
        repository.add_l2_ingress_rule(sw2_ingress_binding.id, first_stack)
        repository.add_l2_egress_rule(sw2_egress_binding.id, second_stack)
        repository.add_l2_ingress_rule(sw3_binding.id, second_stack)
        repository.add_l2_egress_rule(target_binding.id, [])
        first_connections = add_physical_link(
            repository,
            sw1_uplink,
            sw2_ingress,
            passive=passive_hop if passive_hop == 1 else 0,
        )
        second_connections = add_physical_link(
            repository,
            sw2_egress,
            sw3_ingress,
            passive=2 if passive_hop == 2 else 0,
        )
        return {
            "source": source.id,
            "target": target.id,
            "first_stack": first_stack,
            "second_stack": second_stack,
            "connections": first_connections + second_connections,
        }


def branch_transition_kinds(artifact, branch):
    edges = {edge["id"]: edge for edge in artifact["edges"]}
    return [edges[edge_id]["transition_kind"] for edge_id in branch["edge_ids"]]


def test_three_switch_path_crosses_two_physical_hops():
    facts = configured_two_hop()

    artifact = trace(facts["source"], [], facts["target"], []).json()

    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["branches"]) == 1
    kinds = branch_transition_kinds(artifact, artifact["branches"][0])
    assert kinds.count("PHYSICAL_TRANSPORT") == 2
    assert kinds.count("INGRESS_DECODE") == 3
    assert kinds.count("LOCAL_FORWARD") == 3
    assert kinds.count("EGRESS_ENCODE") == 3


def test_multi_hop_translation_changes_stack_only_at_egress_encode():
    tagged_100 = stack(("dot1q", 100))
    tagged_200 = stack(("dot1q", 200))
    facts = configured_two_hop(
        first_stack=tagged_100, second_stack=tagged_200, passive_hop=2
    )

    artifact = trace(facts["source"], [], facts["target"], []).json()

    assert artifact["verdict"] == "REACHABLE"
    nodes = {node["id"]: node for node in artifact["nodes"]}
    physical_edges = [
        edge for edge in artifact["edges"] if edge["transition_kind"] == "PHYSICAL_TRANSPORT"
    ]
    transported = [
        nodes[edge["from_node_id"]]["payload"]["encapsulation_stack"]
        for edge in physical_edges
    ]
    assert tagged_100 in transported
    assert tagged_200 in transported
    for edge in physical_edges:
        assert (
            nodes[edge["from_node_id"]]["payload"]["encapsulation_stack"]
            == nodes[edge["to_node_id"]]["payload"]["encapsulation_stack"]
        )
    assert sum(
        1
        for edge in physical_edges
        for ref in edge["evidence_refs"]
        if ref["entity_type"] == "Connection"
    ) == len(facts["connections"])


def configured_l2_loop(*, with_target):
    tagged = stack(("dot1q", 100))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        a1 = repository.add_network_interface()
        a2 = repository.add_network_interface()
        b1 = repository.add_network_interface()
        b2 = repository.add_network_interface()
        context_a = repository.add_l2_forwarding_context()
        context_b = repository.add_l2_forwarding_context()
        source_binding = repository.add_l2_binding(source.id, context_a.id)
        repository.add_l2_ingress_rule(source_binding.id, [])
        for interface, context in (
            (a1, context_a),
            (a2, context_a),
            (b1, context_b),
            (b2, context_b),
        ):
            binding = repository.add_l2_binding(interface.id, context.id)
            repository.add_l2_ingress_rule(binding.id, tagged)
            repository.add_l2_egress_rule(binding.id, tagged)
        if with_target:
            target_binding = repository.add_l2_binding(target.id, context_b.id)
            repository.add_l2_egress_rule(target_binding.id, [])
        else:
            unused_context = repository.add_l2_forwarding_context()
            target_binding = repository.add_l2_binding(target.id, unused_context.id)
            repository.add_l2_egress_rule(target_binding.id, [])
        add_physical_link(repository, a1, b1)
        add_physical_link(repository, a2, b2)
        return {"source": source.id, "target": target.id}


def test_l2_loop_with_reachable_target_terminates_as_reachable():
    facts = configured_l2_loop(with_target=True)

    artifact = trace(facts["source"], [], facts["target"], []).json()

    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["branches"]) == 2


def test_l2_loop_without_target_terminates_as_unknown():
    facts = configured_l2_loop(with_target=False)

    artifact = trace(facts["source"], [], facts["target"], []).json()

    assert artifact["verdict"] == "UNKNOWN"
    assert artifact["branches"] == []
    assert artifact["gaps"]


def configured_two_paths(*, incomplete_alternate=False):
    tagged = stack(("dot1q", 100))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        source_context = repository.add_l2_forwarding_context()
        target_context = repository.add_l2_forwarding_context()
        source_binding = repository.add_l2_binding(source.id, source_context.id)
        target_binding = repository.add_l2_binding(target.id, target_context.id)
        repository.add_l2_ingress_rule(source_binding.id, [])
        repository.add_l2_egress_rule(target_binding.id, [])
        target_ingress_bindings = []
        for branch_index in range(2):
            source_uplink = repository.add_network_interface()
            middle_in = repository.add_network_interface()
            middle_out = repository.add_network_interface()
            final_in = repository.add_network_interface()
            middle_context = repository.add_l2_forwarding_context()
            source_uplink_binding = repository.add_l2_binding(
                source_uplink.id, source_context.id
            )
            if incomplete_alternate and branch_index == 1:
                continue
            repository.add_l2_egress_rule(source_uplink_binding.id, tagged)
            middle_in_binding = repository.add_l2_binding(
                middle_in.id, middle_context.id
            )
            middle_out_binding = repository.add_l2_binding(
                middle_out.id, middle_context.id
            )
            final_binding = repository.add_l2_binding(final_in.id, target_context.id)
            target_ingress_bindings.append(final_binding.id)
            repository.add_l2_ingress_rule(middle_in_binding.id, tagged)
            repository.add_l2_egress_rule(middle_out_binding.id, tagged)
            repository.add_l2_ingress_rule(final_binding.id, tagged)
            add_physical_link(repository, source_uplink, middle_in)
            add_physical_link(repository, middle_out, final_in)
        return {
            "source": source.id,
            "target": target.id,
            "target_context": target_context.id,
            "target_ingress_bindings": target_ingress_bindings,
        }


def test_two_independent_multi_hop_paths_are_both_preserved():
    facts = configured_two_paths()

    artifact = trace(facts["source"], [], facts["target"], []).json()

    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["branches"]) == 2
    assert all(
        branch_transition_kinds(artifact, branch).count("PHYSICAL_TRANSPORT") == 2
        for branch in artifact["branches"]
    )
    context_ingress_ids = {
        node["payload"]["ingress_binding_id"]
        for node in artifact["nodes"]
        if "ingress_binding_id" in node["payload"]
        and node["payload"].get("forwarding_context_id")
        == str(facts["target_context"])
    }
    assert context_ingress_ids == {
        str(value) for value in facts["target_ingress_bindings"]
    }


def test_reachable_branch_and_incomplete_branch_keep_reachable_and_gap():
    facts = configured_two_paths(incomplete_alternate=True)

    artifact = trace(facts["source"], [], facts["target"], []).json()

    assert artifact["verdict"] == "REACHABLE"
    assert len(artifact["branches"]) == 1
    assert "L2_EGRESS_RULE_UNKNOWN" in {gap["code"] for gap in artifact["gaps"]}


def test_boundary_visited_identity_includes_ordered_encapsulation_stack():
    tagged_100 = stack(("dot1q", 100))
    tagged_200 = stack(("dot1q", 200))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        source_context = repository.add_l2_forwarding_context()
        context_100 = repository.add_l2_forwarding_context()
        context_200 = repository.add_l2_forwarding_context()
        source_binding = repository.add_l2_binding(source.id, source_context.id)
        target_binding = repository.add_l2_binding(target.id, context_200.id)
        repository.add_l2_ingress_rule(source_binding.id, [])
        repository.add_l2_egress_rule(target_binding.id, [])
        shared_remote = repository.add_network_interface()
        for emitted, remote_context in (
            (tagged_100, context_100),
            (tagged_200, context_200),
        ):
            source_uplink = repository.add_network_interface()
            source_uplink_binding = repository.add_l2_binding(
                source_uplink.id, source_context.id
            )
            repository.add_l2_egress_rule(source_uplink_binding.id, emitted)
            remote_binding = repository.add_l2_binding(
                shared_remote.id, remote_context.id
            )
            repository.add_l2_ingress_rule(remote_binding.id, emitted)
            add_physical_link(repository, source_uplink, shared_remote)
        source_id, target_id, remote_id = source.id, target.id, shared_remote.id

    artifact = trace(source_id, [], target_id, []).json()

    assert artifact["verdict"] == "REACHABLE"
    remote_ingress_stacks = {
        tuple((label["kind"], label["value"]) for label in node["payload"]["encapsulation_stack"])
        for node in artifact["nodes"]
        if node["payload"].get("interface_id") == str(remote_id)
        and node["payload"].get("direction") == "INGRESS"
    }
    assert remote_ingress_stacks == {
        (("dot1q", 100),),
        (("dot1q", 200),),
    }
