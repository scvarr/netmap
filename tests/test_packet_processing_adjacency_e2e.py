import os
from ipaddress import ip_network

import httpx

from app.database import SessionLocal
from app.repository import CanonicalRepository, RouteNextHopInput


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def evaluate(plan_id, context_id, destination="203.0.113.9"):
    return httpx.post(
        f"{BASE_URL}/v1/traces/packet-processing/evaluation",
        json={
            "plan_id": str(plan_id),
            "traffic_class": "TRANSIT",
            "routing_context_id": str(context_id),
            "packet_state": {"destination_ip": destination},
        },
        timeout=10,
    )


def add_terminal(repository, plan_id, outcome):
    return repository.add_processing_stage(
        plan_id, "TERMINATE", {"outcome": outcome}
    )


def add_route_transitions(repository, plan_id, route, adjacency, terminals):
    for outcome, target in (
        ("FORWARD", adjacency),
        ("LOCAL", terminals["delivery"]),
        ("DISCARD", terminals["negative"]),
        ("NO_ROUTE", terminals["negative"]),
        ("UNKNOWN", terminals["unknown"]),
        ("CONFLICTING", terminals["unknown"]),
    ):
        repository.add_processing_transition(
            plan_id, route.id, outcome, target.id
        )


def add_adjacency_transitions(repository, plan_id, adjacency, terminals):
    for outcome, target in (
        ("NEXT_PROCESSING_POINT", terminals["continue"]),
        ("TARGET_ATTACHMENT_REACHED", terminals["delivery"]),
        ("L2_UNREACHABLE", terminals["negative"]),
        ("UNKNOWN", terminals["unknown"]),
    ):
        repository.add_processing_transition(
            plan_id, adjacency.id, outcome, target.id
        )


def build_handoff_fixture(
    repository,
    *,
    gateway=None,
    nat_destination=None,
    reroute_gateway=None,
    duplicate_target="NONE",
    two_l2_paths=False,
):
    source_context = repository.add_routing_context()
    table = repository.add_routing_table(
        source_context.id, "IPv4", "COMPLETE"
    )
    policy = repository.add_routing_policy(
        {"op": "SELECT_TABLE", "routing_table_id": str(table.id)},
        "COMPLETE",
    )
    source_interface = repository.add_network_interface()
    source_egress = repository.add_l3_binding(
        source_interface.id, source_context.id
    )

    receiving_context = repository.add_routing_context()
    target_interface = repository.add_network_interface()
    target_binding = repository.add_l3_binding(
        target_interface.id, receiving_context.id
    )
    target_ip = reroute_gateway or gateway or nat_destination or "203.0.113.9"
    target_address = repository.add_interface_address(
        target_binding.id, target_ip, 24
    )
    l2_context = repository.add_l2_forwarding_context()
    repository.add_l2_binding(source_interface.id, l2_context.id)
    repository.add_l2_binding(target_interface.id, l2_context.id)
    if two_l2_paths:
        alternate = repository.add_l2_forwarding_context()
        repository.add_l2_binding(source_interface.id, alternate.id)
        repository.add_l2_binding(target_interface.id, alternate.id)

    duplicate = None
    if duplicate_target != "NONE":
        duplicate_context = repository.add_routing_context()
        duplicate_interface = repository.add_network_interface()
        duplicate_binding = repository.add_l3_binding(
            duplicate_interface.id, duplicate_context.id
        )
        duplicate_address = repository.add_interface_address(
            duplicate_binding.id, target_ip, 24
        )
        if duplicate_target == "REACHABLE":
            repository.add_l2_binding(duplicate_interface.id, l2_context.id)
        duplicate = {
            "context": duplicate_context,
            "interface": duplicate_interface,
            "binding": duplicate_binding,
            "address": duplicate_address,
        }

    repository.add_route(
        table.id,
        "203.0.113.0/24",
        "FORWARD",
        [
            RouteNextHopInput(
                gateway_address=gateway,
                egress_l3_binding_id=source_egress.id,
            )
        ],
    )
    if reroute_gateway is not None:
        repository.add_route(
            table.id,
            str(ip_network(f"{nat_destination}/24", strict=False)),
            "FORWARD",
            [
                RouteNextHopInput(
                    gateway_address=reroute_gateway,
                    egress_l3_binding_id=source_egress.id,
                )
            ],
        )

    plan = repository.add_packet_processing_plan("COMPLETE")
    policy_stage = repository.add_processing_stage(
        plan.id, "ROUTING_POLICY", {"policy_id": str(policy.id)}
    )
    route = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
    reroute = (
        repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        if reroute_gateway is not None
        else None
    )
    nat = None
    if nat_destination is not None:
        nat_policy = repository.add_nat_policy({"op": "IDENTITY"}, "COMPLETE")
        repository.add_nat_rule(
            nat_policy.id,
            10,
            {"op": "TRUE"},
            {
                "op": "TRANSFORM",
                "destination_ip": {
                    "op": "REPLACE_EXACT",
                    "value": nat_destination,
                },
            },
        )
        nat_attachment = repository.add_nat_policy_attachment(
            nat_policy.id, 10, {}
        )
        nat = repository.add_processing_stage(
            plan.id, "NAT", {"attachment_id": str(nat_attachment.id)}
        )
    adjacency = repository.add_processing_stage(plan.id, "ADJACENCY_L2", {})
    terminals = {
        "continue": add_terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP"),
        "delivery": add_terminal(repository, plan.id, "NETWORK_DELIVERY"),
        "negative": add_terminal(repository, plan.id, "NOT_DELIVERED"),
        "unknown": add_terminal(repository, plan.id, "UNKNOWN"),
    }
    repository.add_processing_entry_point(
        plan.id, "TRANSIT", policy_stage.id
    )
    repository.add_processing_transition(
        plan.id, policy_stage.id, "TABLE_SELECTED", route.id
    )
    repository.add_processing_transition(
        plan.id,
        policy_stage.id,
        "TABLE_SELECTION_UNKNOWN",
        terminals["unknown"].id,
    )
    add_route_transitions(
        repository, plan.id, route, nat or adjacency, terminals
    )
    if nat is not None:
        post_nat = reroute or adjacency
        for outcome, target in (
            ("IDENTITY", post_nat),
            ("TRANSFORMED_EXACT", post_nat),
            ("TRANSFORMED_CONSTRAINED", terminals["unknown"]),
            ("UNKNOWN", terminals["unknown"]),
        ):
            repository.add_processing_transition(
                plan.id, nat.id, outcome, target.id
            )
    if reroute is not None:
        add_route_transitions(
            repository, plan.id, reroute, adjacency, terminals
        )
    add_adjacency_transitions(
        repository, plan.id, adjacency, terminals
    )
    return {
        "plan": plan,
        "source_context": source_context,
        "table": table,
        "source_interface": source_interface,
        "source_egress": source_egress,
        "receiving_context": receiving_context,
        "target_interface": target_interface,
        "target_binding": target_binding,
        "target_address": target_address,
        "nat": nat,
        "reroute": reroute,
        "duplicate": duplicate,
    }


def stage_execution(branch, kind):
    return next(
        execution
        for execution in branch["stage_executions"]
        if execution["stage_kind"] == kind
    )


def test_direct_adjacency_handoff_reaches_target_and_resets_local_routing_state():
    with SessionLocal.begin() as session:
        fixture = build_handoff_fixture(CanonicalRepository(session))
        ids = {key: str(value.id) for key, value in fixture.items() if hasattr(value, "id")}

    artifact = evaluate(
        ids["plan"], ids["source_context"]
    ).json()

    assert artifact["result"] == "NETWORK_DELIVERY"
    assert len(artifact["branches"]) == 1
    branch = artifact["branches"][0]
    adjacency = stage_execution(branch, "ADJACENCY_L2")
    final = branch["final_state"]
    assert adjacency["stage_outcome"] == "TARGET_ATTACHMENT_REACHED"
    assert adjacency["adjacency_target_ip"] == "203.0.113.9"
    assert adjacency["selected_adjacency_candidate"] == {
        "interface_address_id": ids["target_address"],
        "target_l3_binding_id": ids["target_binding"],
        "target_network_interface_id": ids["target_interface"],
        "ip_address": "203.0.113.9",
    }
    assert adjacency["selected_l2_branch_id"] is not None
    assert adjacency["handoff"] == {
        "outcome": "TARGET_ATTACHMENT_REACHED",
        "receiving_network_interface_id": ids["target_interface"],
        "receiving_l3_binding_id": ids["target_binding"],
        "receiving_routing_context_id": ids["receiving_context"],
    }
    assert final["routing_context_id"] == ids["receiving_context"]
    assert final["ingress_network_interface_id"] == ids["target_interface"]
    assert final["ingress_l3_binding_id"] == ids["target_binding"]
    assert final["traffic_class"] == "LOCAL_INPUT"
    assert final["selected_routing_table_id"] is None
    assert final["current_route_resolution_branch"] is None
    assert final["direct_egress"] is None
    assert final["current_packet_state"]["destination_ip"] == "203.0.113.9"


def test_gateway_adjacency_handoff_reaches_next_processing_point():
    with SessionLocal.begin() as session:
        fixture = build_handoff_fixture(
            CanonicalRepository(session), gateway="192.0.2.1"
        )
        ids = {key: str(value.id) for key, value in fixture.items() if hasattr(value, "id")}

    artifact = evaluate(ids["plan"], ids["source_context"]).json()

    assert artifact["result"] == "CONTINUE_TO_NEXT_HOP"
    branch = artifact["branches"][0]
    adjacency = stage_execution(branch, "ADJACENCY_L2")
    final = branch["final_state"]
    assert adjacency["stage_outcome"] == "NEXT_PROCESSING_POINT"
    assert adjacency["adjacency_target_ip"] == "192.0.2.1"
    assert adjacency["handoff"]["receiving_routing_context_id"] == ids[
        "receiving_context"
    ]
    assert final["traffic_class"] == "TRANSIT"
    assert final["routing_context_id"] == ids["receiving_context"]
    assert final["selected_routing_table_id"] is None
    assert final["current_route_resolution_branch"] is None
    assert final["direct_egress"] is None


def test_dnat_changes_direct_adjacency_target_without_hidden_reroute():
    with SessionLocal.begin() as session:
        fixture = build_handoff_fixture(
            CanonicalRepository(session), nat_destination="198.51.100.9"
        )
        plan_id = fixture["plan"].id
        context_id = fixture["source_context"].id

    artifact = evaluate(plan_id, context_id).json()
    branch = artifact["branches"][0]
    adjacency = stage_execution(branch, "ADJACENCY_L2")

    assert artifact["result"] == "NETWORK_DELIVERY"
    assert adjacency["adjacency_target_ip"] == "198.51.100.9"
    assert adjacency["packet_before"]["destination_ip"] == "198.51.100.9"
    assert len(
        [
            execution
            for execution in branch["stage_executions"]
            if execution["stage_kind"] == "ROUTE_DECISION"
        ]
    ) == 1


def test_dnat_does_not_replace_gateway_adjacency_target():
    with SessionLocal.begin() as session:
        fixture = build_handoff_fixture(
            CanonicalRepository(session),
            gateway="192.0.2.1",
            nat_destination="198.51.100.9",
        )
        plan_id = fixture["plan"].id
        context_id = fixture["source_context"].id

    artifact = evaluate(plan_id, context_id).json()
    branch = artifact["branches"][0]
    adjacency = stage_execution(branch, "ADJACENCY_L2")

    assert artifact["result"] == "CONTINUE_TO_NEXT_HOP"
    assert adjacency["packet_before"]["destination_ip"] == "198.51.100.9"
    assert adjacency["adjacency_target_ip"] == "192.0.2.1"


def test_explicit_post_nat_route_replaces_forwarding_decision_for_adjacency():
    with SessionLocal.begin() as session:
        fixture = build_handoff_fixture(
            CanonicalRepository(session),
            nat_destination="198.51.100.9",
            reroute_gateway="192.0.2.1",
        )
        plan_id = fixture["plan"].id
        context_id = fixture["source_context"].id

    artifact = evaluate(plan_id, context_id).json()
    branch = artifact["branches"][0]
    adjacency = stage_execution(branch, "ADJACENCY_L2")

    assert artifact["result"] == "CONTINUE_TO_NEXT_HOP"
    assert adjacency["adjacency_target_ip"] == "192.0.2.1"
    assert len(
        [
            execution
            for execution in branch["stage_executions"]
            if execution["stage_kind"] == "ROUTE_DECISION"
        ]
    ) == 2


def test_adjacency_without_forwarding_decision_follows_unknown_transition():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        plan = repository.add_packet_processing_plan("COMPLETE")
        adjacency = repository.add_processing_stage(plan.id, "ADJACENCY_L2", {})
        terminals = {
            "continue": add_terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP"),
            "delivery": add_terminal(repository, plan.id, "NETWORK_DELIVERY"),
            "negative": add_terminal(repository, plan.id, "NOT_DELIVERED"),
            "unknown": add_terminal(repository, plan.id, "UNKNOWN"),
        }
        repository.add_processing_entry_point(plan.id, "TRANSIT", adjacency.id)
        add_adjacency_transitions(repository, plan.id, adjacency, terminals)
        plan_id, context_id = plan.id, context.id

    artifact = evaluate(plan_id, context_id).json()
    execution = stage_execution(artifact["branches"][0], "ADJACENCY_L2")

    assert artifact["result"] == "UNKNOWN"
    assert execution["stage_outcome"] == "UNKNOWN"
    assert execution["structural_adjacency_evaluation"] is None
    assert {gap["code"] for gap in execution["gaps"]} == {
        "STAGE_PRECONDITION_UNKNOWN"
    }


def test_no_identity_candidate_is_unknown_not_l2_unreachable():
    with SessionLocal.begin() as session:
        fixture = build_handoff_fixture(CanonicalRepository(session))
        session.delete(fixture["target_address"])
        plan_id = fixture["plan"].id
        context_id = fixture["source_context"].id

    artifact = evaluate(plan_id, context_id).json()
    adjacency = stage_execution(artifact["branches"][0], "ADJACENCY_L2")

    assert artifact["result"] == "UNKNOWN"
    assert adjacency["stage_outcome"] == "UNKNOWN"
    assert adjacency["structural_adjacency_evaluation"]["identity_resolution"][
        "result"
    ] == "UNKNOWN"
    assert "L2_UNREACHABLE" not in {
        stage_execution(branch, "ADJACENCY_L2")["stage_outcome"]
        for branch in artifact["branches"]
    }


def test_duplicate_reachable_identity_candidates_create_distinct_handoffs():
    with SessionLocal.begin() as session:
        fixture = build_handoff_fixture(
            CanonicalRepository(session), duplicate_target="REACHABLE"
        )
        plan_id = fixture["plan"].id
        context_id = fixture["source_context"].id
        target_ids = {
            str(fixture["target_binding"].id),
            str(fixture["duplicate"]["binding"].id),
        }

    artifact = evaluate(plan_id, context_id).json()

    successful = [
        branch
        for branch in artifact["branches"]
        if stage_execution(branch, "ADJACENCY_L2")["stage_outcome"]
        == "TARGET_ATTACHMENT_REACHED"
    ]

    assert len(successful) == 2
    assert {
        stage_execution(branch, "ADJACENCY_L2")["handoff"][
            "receiving_l3_binding_id"
        ]
        for branch in successful
    } == target_ids


def test_reachable_and_unknown_identity_candidates_are_both_preserved():
    with SessionLocal.begin() as session:
        fixture = build_handoff_fixture(
            CanonicalRepository(session), duplicate_target="UNKNOWN"
        )
        plan_id = fixture["plan"].id
        context_id = fixture["source_context"].id

    artifact = evaluate(plan_id, context_id).json()

    assert artifact["result"] == "UNKNOWN"
    assert len(artifact["branches"]) == 2
    assert {
        stage_execution(branch, "ADJACENCY_L2")["stage_outcome"]
        for branch in artifact["branches"]
    } == {"TARGET_ATTACHMENT_REACHED", "UNKNOWN"}


def test_multiple_l2_paths_create_distinct_packet_processing_branches():
    with SessionLocal.begin() as session:
        fixture = build_handoff_fixture(
            CanonicalRepository(session), two_l2_paths=True
        )
        plan_id = fixture["plan"].id
        context_id = fixture["source_context"].id

    artifact = evaluate(plan_id, context_id).json()

    assert artifact["result"] == "NETWORK_DELIVERY"
    assert len(artifact["branches"]) == 2
    assert len(
        {
            stage_execution(branch, "ADJACENCY_L2")["selected_l2_branch_id"]
            for branch in artifact["branches"]
        }
    ) == 2
