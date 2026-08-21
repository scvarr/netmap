from app.database import SessionLocal
from app.packet_constraints import (
    MAX_PACKET_CONSTRAINT_EXPANSION,
    expand_packet_constraint,
)
from app.repository import CanonicalRepository
from app.schemas import NATPacketConstraint, PacketState
from tests.test_packet_processing_nat_e2e import (
    add_nat_attachment,
    add_terminal,
    evaluate,
    execution,
    replace_destination,
)
from tests.test_reference_network_acceptance_e2e import (
    build_reference_network,
    packet_flow,
    stage,
)


def _fw_steps(artifact):
    return [branch["local_steps"][2] for branch in artifact["branches"]]


def _add_nat_then_routing_policy_plan(
    repository,
    context,
    attachment,
    policy,
    *,
    constrained_to_policy=True,
    unknown_to_policy=False,
):
    plan = repository.add_packet_processing_plan("COMPLETE")
    nat = repository.add_processing_stage(
        plan.id, "NAT", {"attachment_id": str(attachment.id)}
    )
    routing_policy = repository.add_processing_stage(
        plan.id, "ROUTING_POLICY", {"policy_id": str(policy.id)}
    )
    terminal = add_terminal(repository, plan.id, "UNKNOWN")
    repository.add_processing_entry_point(plan.id, "TRANSIT", nat.id)
    for outcome in (
        "IDENTITY",
        "TRANSFORMED_EXACT",
        "TRANSFORMED_CONSTRAINED",
        "UNKNOWN",
    ):
        use_policy = (
            outcome == "TRANSFORMED_CONSTRAINED" and constrained_to_policy
        ) or (outcome == "UNKNOWN" and unknown_to_policy)
        repository.add_processing_transition(
            plan.id,
            nat.id,
            outcome,
            routing_policy.id if use_policy else terminal.id,
        )
    repository.add_processing_transition(
        plan.id, routing_policy.id, "TABLE_SELECTED", terminal.id
    )
    repository.add_processing_transition(
        plan.id, routing_policy.id, "TABLE_SELECTION_UNKNOWN", terminal.id
    )
    return plan


def test_two_address_constraint_runs_routing_policy_for_every_exact_candidate():
    fixture = build_reference_network("S9_ALL_DELIVERED")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert len(artifact["branches"]) == 2
    destinations = set()
    for fw_step in _fw_steps(artifact):
        nat = stage(fw_step, "NAT")
        routing_policy = stage(fw_step, "ROUTING_POLICY")
        assert nat["stage_outcome"] == "TRANSFORMED_CONSTRAINED"
        assert nat["packet_after"] is None
        assert nat["packet_after_constraint"] is not None
        assert routing_policy["stage_outcome"] == "TABLE_SELECTED"
        assert routing_policy["routing_policy_evaluation"] is not None
        destinations.add(routing_policy["packet_before"]["destination_ip"])
        assert "PACKET_CONSTRAINT_UNSUPPORTED" not in {
            gap["code"] for gap in routing_policy["gaps"]
        }
    assert destinations == {"10.20.30.40", "10.20.30.41"}


def test_different_exact_candidates_preserve_different_packet_flow_results():
    fixture = build_reference_network("S9")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert artifact["result"] == "UNKNOWN"
    assert {branch["verdict"] for branch in artifact["branches"]} == {
        "DELIVERED",
        "NOT_DELIVERED",
    }
    assert {
        stage(step, "ROUTING_POLICY")["packet_before"]["destination_ip"]
        for step in _fw_steps(artifact)
    } == {"10.20.30.40", "10.20.30.41"}


def test_identical_exact_candidate_results_aggregate_to_delivered():
    fixture = build_reference_network("S9_ALL_DELIVERED")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert artifact["result"] == "DELIVERED"
    assert len(artifact["branches"]) == 2
    assert {branch["verdict"] for branch in artifact["branches"]} == {"DELIVERED"}
    assert {
        branch["final_context"]["packet_state"]["destination_ip"]
        for branch in artifact["branches"]
    } == {"10.20.30.40", "10.20.30.41"}


def test_small_cartesian_product_is_complete_deduplicated_and_preserves_base():
    constraint = NATPacketConstraint(
        packet_base=PacketState(
            source_ip="192.0.2.10",
            destination_ip="203.0.113.10",
            ip_protocol=6,
            source_port=50000,
            destination_port=443,
        ),
        destination_ip_ranges=[
            {"start": "10.20.30.40", "end": "10.20.30.41"},
            {"start": "10.20.30.41", "end": "10.20.30.41"},
        ],
        destination_port_ranges=[
            {"start": 8443, "end": 8444},
            {"start": 8444, "end": 8444},
        ],
    )

    expansion = expand_packet_constraint(constraint)

    assert expansion.limit_exceeded is False
    assert expansion.total_cardinality == 4
    assert {
        (str(packet.destination_ip), packet.destination_port)
        for packet in expansion.packets
    } == {
        ("10.20.30.40", 8443),
        ("10.20.30.40", 8444),
        ("10.20.30.41", 8443),
        ("10.20.30.41", 8444),
    }
    assert all(
        packet.source_ip == constraint.packet_base.source_ip
        and packet.source_port == 50000
        and packet.ip_protocol == 6
        and packet.icmp_type is None
        and packet.icmp_code is None
        for packet in expansion.packets
    )


def test_over_limit_constraint_is_unknown_without_partial_materialization():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        policy = repository.add_routing_policy(
            {"op": "SELECT_TABLE", "routing_table_id": str(table.id)},
            "COMPLETE",
        )
        pool = repository.add_nat_pool(
            address_ranges=[
                {
                    "start": "10.20.30.1",
                    "end": f"10.20.30.{MAX_PACKET_CONSTRAINT_EXPANSION + 1}",
                }
            ]
        )
        _nat_policy, _rule, attachment = add_nat_attachment(
            repository,
            {
                "op": "TRANSFORM",
                "destination_ip": {
                    "op": "SELECT_FROM",
                    "pool_id": str(pool.id),
                },
            },
        )
        plan = _add_nat_then_routing_policy_plan(
            repository, context, attachment, policy
        )
        plan_id, context_id = plan.id, context.id

    artifact = evaluate(plan_id, context_id).json()

    assert artifact["result"] == "UNKNOWN"
    assert len(artifact["branches"]) == 1
    nat = execution(artifact, "NAT")
    routing_policy = execution(artifact, "ROUTING_POLICY")
    assert nat["stage_outcome"] == "TRANSFORMED_CONSTRAINED"
    assert routing_policy["stage_outcome"] == "TABLE_SELECTION_UNKNOWN"
    assert routing_policy["routing_policy_evaluation"] is None
    assert {gap["code"] for gap in routing_policy["gaps"]} == {
        "PACKET_CONSTRAINT_EXPANSION_LIMIT"
    }


def test_unknown_packet_state_keeps_existing_conservative_behavior():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        policy = repository.add_routing_policy(
            {"op": "SELECT_TABLE", "routing_table_id": str(table.id)},
            "COMPLETE",
        )
        scoped_interface = repository.add_network_interface()
        scoped_binding = repository.add_l3_binding(
            scoped_interface.id, context.id
        )
        _nat_policy, _rule, attachment = add_nat_attachment(
            repository,
            replace_destination("198.51.100.8"),
            scope={"egress_l3_binding_ids": [str(scoped_binding.id)]},
        )
        plan = _add_nat_then_routing_policy_plan(
            repository,
            context,
            attachment,
            policy,
            constrained_to_policy=False,
            unknown_to_policy=True,
        )
        plan_id, context_id = plan.id, context.id

    artifact = evaluate(plan_id, context_id).json()

    assert len(artifact["branches"]) == 1
    routing_policy = execution(artifact, "ROUTING_POLICY")
    assert routing_policy["stage_outcome"] == "TABLE_SELECTION_UNKNOWN"
    assert routing_policy["routing_policy_evaluation"] is None
    assert "PACKET_STATE_UNKNOWN" in {
        gap["code"] for gap in routing_policy["gaps"]
    }
    assert "PACKET_CONSTRAINT_EXPANSION_LIMIT" not in {
        gap["code"] for gap in routing_policy["gaps"]
    }


def test_exact_reference_dnat_remains_delivered_without_constraint_expansion():
    fixture = build_reference_network("S0")

    artifact = packet_flow(fixture["contexts"]["CLIENT"].id).json()

    assert artifact["result"] == "DELIVERED"
    assert len(artifact["branches"]) == 1
    fw_step = artifact["branches"][0]["local_steps"][2]
    nat = stage(fw_step, "NAT")
    routing_policy = stage(fw_step, "ROUTING_POLICY")
    assert nat["stage_outcome"] == "TRANSFORMED_EXACT"
    assert nat["packet_after_constraint"] is None
    assert routing_policy["packet_before"]["destination_ip"] == "10.20.30.40"


def test_small_ipv6_range_expands_to_every_exact_address():
    constraint = NATPacketConstraint(
        packet_base=PacketState(
            source_ip="2001:db8:1::10",
            destination_ip="2001:db8:2::10",
            ip_protocol=17,
            source_port=53000,
            destination_port=53,
        ),
        destination_ip_ranges=[
            {"start": "2001:db8::1", "end": "2001:db8::2"}
        ],
    )

    expansion = expand_packet_constraint(constraint)

    assert expansion.limit_exceeded is False
    assert expansion.total_cardinality == 2
    assert {str(packet.destination_ip) for packet in expansion.packets} == {
        "2001:db8::1",
        "2001:db8::2",
    }
    assert all(
        packet.source_ip == constraint.packet_base.source_ip
        and packet.source_port == 53000
        and packet.destination_port == 53
        and packet.ip_protocol == 17
        for packet in expansion.packets
    )
