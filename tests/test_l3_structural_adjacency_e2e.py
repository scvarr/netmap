import os

import httpx

from app.database import SessionLocal
from app.repository import CanonicalRepository, ConnectionMemberInput


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def stack(*labels):
    return [{"kind": kind, "value": value} for kind, value in labels]


def structural_adjacency(egress_l3_binding_id, neighbor_target_ip="192.0.2.1"):
    return httpx.post(
        f"{BASE_URL}/v1/traces/l3/structural-adjacency",
        json={
            "egress_l3_binding_id": str(egress_l3_binding_id),
            "neighbor_target_ip": neighbor_target_ip,
        },
        timeout=5,
    )


def l3_identities(target_count=1, address="192.0.2.1"):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        routing_context = repository.add_routing_context()
        source_interface = repository.add_network_interface()
        source_l3 = repository.add_l3_binding(
            source_interface.id, routing_context.id
        )
        targets = []
        for _ in range(target_count):
            target_interface = repository.add_network_interface()
            target_l3 = repository.add_l3_binding(
                target_interface.id, routing_context.id
            )
            interface_address = repository.add_interface_address(
                target_l3.id, address, 24
            )
            targets.append(
                (target_interface.id, target_l3.id, interface_address.id)
            )
        return source_interface.id, source_l3.id, targets


def transition_kinds(candidate_result):
    return [
        edge["transition_kind"]
        for edge in candidate_result["l2_traversal"]["edges"]
    ]


def test_local_internal_source_to_internal_target_is_reachable_without_rules():
    source_interface_id, source_l3_id, targets = l3_identities()
    target_interface_id = targets[0][0]
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_l2_forwarding_context()
        repository.add_l2_binding(source_interface_id, context.id)
        repository.add_l2_binding(target_interface_id, context.id)

    artifact = structural_adjacency(source_l3_id).json()

    assert artifact["result"] == "REACHABLE"
    candidate = artifact["candidate_results"][0]
    assert candidate["result"] == "REACHABLE"
    assert transition_kinds(candidate) == ["INTERNAL_ATTACH", "INTERNAL_ATTACH"]
    assert candidate["l2_traversal"]["gaps"] == []
    assert all(
        "encapsulation_stack" not in node["payload"]
        for node in candidate["l2_traversal"]["nodes"]
        if node["id"].startswith("l2-internal:")
    )
    assert "L2EgressRule" not in {
        ref["entity_type"] for ref in candidate["evidence_refs"]
    }


def test_svi_source_crosses_tagged_physical_hop_to_remote_internal_target():
    source_interface_id, source_l3_id, targets = l3_identities()
    target_interface_id = targets[0][0]
    tagged = stack(("dot1q", 100))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source_context = repository.add_l2_forwarding_context()
        remote_context = repository.add_l2_forwarding_context()
        source_uplink = repository.add_network_interface()
        remote_uplink = repository.add_network_interface()
        source_internal = repository.add_l2_binding(
            source_interface_id, source_context.id
        )
        source_external = repository.add_l2_binding(
            source_uplink.id, source_context.id
        )
        remote_external = repository.add_l2_binding(
            remote_uplink.id, remote_context.id
        )
        target_internal = repository.add_l2_binding(
            target_interface_id, remote_context.id
        )
        repository.add_l2_egress_rule(source_external.id, tagged)
        repository.add_l2_ingress_rule(remote_external.id, tagged)
        source_object = repository.add_physical_object()
        remote_object = repository.add_physical_object()
        source_point = repository.add_connection_point(source_object.id, 1)
        remote_point = repository.add_connection_point(remote_object.id, 1)
        repository.add_connection(
            source_point.id,
            remote_point.id,
            1,
            [ConnectionMemberInput(1, 1, 1)],
        )
        repository.add_interface_physical_binding(
            source_uplink.id, source_point.id, 1
        )
        repository.add_interface_physical_binding(
            remote_uplink.id, remote_point.id, 1
        )
        fact_ids = {
            source_internal.id,
            source_external.id,
            remote_external.id,
            target_internal.id,
        }

    artifact = structural_adjacency(source_l3_id).json()

    assert artifact["result"] == "REACHABLE"
    candidate = artifact["candidate_results"][0]
    kinds = transition_kinds(candidate)
    assert kinds == [
        "INTERNAL_ATTACH",
        "LOCAL_FORWARD",
        "EGRESS_ENCODE",
        "PHYSICAL_TRANSPORT",
        "INGRESS_DECODE",
        "INTERNAL_ATTACH",
    ]
    boundary_stacks = [
        node["payload"]["encapsulation_stack"]
        for node in candidate["l2_traversal"]["nodes"]
        if node["id"].startswith("l2-boundary:")
    ]
    assert boundary_stacks and all(item == tagged for item in boundary_stacks)
    evidence_ids = {ref["entity_id"] for ref in candidate["evidence_refs"]}
    assert {str(item) for item in fact_ids}.issubset(evidence_ids)


def test_remote_ingress_binding_can_deliver_internally_through_same_binding():
    source_interface_id, source_l3_id, targets = l3_identities()
    target_interface_id = targets[0][0]
    tagged = stack(("dot1q", 100))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source_context = repository.add_l2_forwarding_context()
        remote_context = repository.add_l2_forwarding_context()
        source_uplink = repository.add_network_interface()
        repository.add_l2_binding(source_interface_id, source_context.id)
        source_external = repository.add_l2_binding(
            source_uplink.id, source_context.id
        )
        target_binding = repository.add_l2_binding(
            target_interface_id, remote_context.id
        )
        repository.add_l2_egress_rule(source_external.id, tagged)
        repository.add_l2_ingress_rule(target_binding.id, tagged)
        objects = [repository.add_physical_object() for _ in range(2)]
        points = [
            repository.add_connection_point(physical_object.id, 1)
            for physical_object in objects
        ]
        repository.add_connection(
            points[0].id,
            points[1].id,
            1,
            [ConnectionMemberInput(1, 1, 1)],
        )
        repository.add_interface_physical_binding(source_uplink.id, points[0].id, 1)
        repository.add_interface_physical_binding(target_interface_id, points[1].id, 1)

    candidate = structural_adjacency(source_l3_id).json()["candidate_results"][0]

    assert candidate["result"] == "REACHABLE"
    assert transition_kinds(candidate)[-2:] == ["INGRESS_DECODE", "INTERNAL_ATTACH"]
    assert "L2EgressRule" not in {
        ref["entity_type"]
        for edge in candidate["l2_traversal"]["edges"][-1:]
        for ref in edge["evidence_refs"]
    }


def test_source_without_l2_binding_is_typed_unknown():
    _source_interface_id, source_l3_id, _targets = l3_identities()

    artifact = structural_adjacency(source_l3_id).json()

    assert artifact["result"] == "UNKNOWN"
    candidate = artifact["candidate_results"][0]
    assert candidate["result"] == "UNKNOWN"
    assert candidate["l2_traversal"]["gaps"][0]["code"] == (
        "L2_INTERNAL_ATTACHMENT_UNKNOWN"
    )


def test_identity_candidate_with_incomplete_l2_path_is_unknown():
    source_interface_id, source_l3_id, _targets = l3_identities()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_l2_forwarding_context()
        repository.add_l2_binding(source_interface_id, context.id)

    artifact = structural_adjacency(source_l3_id).json()

    assert artifact["result"] == "UNKNOWN"
    assert artifact["candidate_results"][0]["result"] == "UNKNOWN"


def test_duplicate_identity_keeps_reachable_and_unknown_candidate_results():
    source_interface_id, source_l3_id, targets = l3_identities(target_count=2)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_l2_forwarding_context()
        repository.add_l2_binding(source_interface_id, context.id)
        repository.add_l2_binding(targets[0][0], context.id)

    artifact = structural_adjacency(source_l3_id).json()

    assert artifact["result"] == "REACHABLE"
    assert len(artifact["candidate_results"]) == 2
    assert {item["result"] for item in artifact["candidate_results"]} == {
        "REACHABLE",
        "UNKNOWN",
    }


def test_two_duplicate_identity_candidates_preserve_both_reachable_results():
    source_interface_id, source_l3_id, targets = l3_identities(target_count=2)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_l2_forwarding_context()
        repository.add_l2_binding(source_interface_id, context.id)
        for target_interface_id, _target_l3_id, _address_id in targets:
            repository.add_l2_binding(target_interface_id, context.id)

    artifact = structural_adjacency(source_l3_id).json()

    assert artifact["result"] == "REACHABLE"
    assert len(artifact["candidate_results"]) == 2
    assert all(item["result"] == "REACHABLE" for item in artifact["candidate_results"])


def test_source_multiple_l2_bindings_explores_every_relevant_context():
    source_interface_id, source_l3_id, targets = l3_identities()
    target_interface_id = targets[0][0]
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        for _ in range(2):
            context = repository.add_l2_forwarding_context()
            repository.add_l2_binding(source_interface_id, context.id)
            repository.add_l2_binding(target_interface_id, context.id)

    candidate = structural_adjacency(source_l3_id).json()["candidate_results"][0]

    assert candidate["result"] == "REACHABLE"
    assert len(candidate["l2_traversal"]["branches"]) == 2
    assert sum(
        edge["transition_kind"] == "INTERNAL_ATTACH"
        for edge in candidate["l2_traversal"]["edges"]
    ) == 4


def test_internal_path_preserves_realization_and_passive_l1_sections():
    source_interface_id, source_l3_id, targets = l3_identities()
    target_interface_id = targets[0][0]
    tagged = stack(("dot1q", 100))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source_context = repository.add_l2_forwarding_context()
        remote_context = repository.add_l2_forwarding_context()
        source_upper = repository.add_network_interface()
        source_lower = repository.add_network_interface()
        remote_lower = repository.add_network_interface()
        remote_upper = repository.add_network_interface()
        repository.add_network_interface_realization(
            source_upper.id, source_lower.id
        )
        repository.add_network_interface_realization(
            remote_upper.id, remote_lower.id
        )
        repository.add_l2_binding(source_interface_id, source_context.id)
        source_external = repository.add_l2_binding(
            source_upper.id, source_context.id
        )
        remote_external = repository.add_l2_binding(
            remote_upper.id, remote_context.id
        )
        repository.add_l2_binding(target_interface_id, remote_context.id)
        repository.add_l2_egress_rule(source_external.id, tagged)
        repository.add_l2_ingress_rule(remote_external.id, tagged)

        objects = [repository.add_physical_object() for _ in range(3)]
        points = [
            repository.add_connection_point(objects[0].id, 1),
            repository.add_connection_point(objects[1].id, 1),
            repository.add_connection_point(objects[1].id, 1),
            repository.add_connection_point(objects[2].id, 1),
        ]
        for point_a, point_b in zip(points, points[1:]):
            repository.add_connection(
                point_a.id,
                point_b.id,
                1,
                [ConnectionMemberInput(1, 1, 1)],
            )
        repository.add_interface_physical_binding(source_lower.id, points[0].id, 1)
        repository.add_interface_physical_binding(remote_lower.id, points[3].id, 1)

    candidate = structural_adjacency(source_l3_id).json()["candidate_results"][0]

    assert candidate["result"] == "REACHABLE"
    kinds = transition_kinds(candidate)
    assert "REALIZATION_DOWN" in kinds
    assert "PHYSICAL_TRANSPORT" in kinds
    assert "REALIZATION_UP" in kinds
    evidence_types = {ref["entity_type"] for ref in candidate["evidence_refs"]}
    assert {
        "NetworkInterfaceRealization",
        "InterfacePhysicalBinding",
        "Connection",
        "ConnectionMember",
    }.issubset(evidence_types)
