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
