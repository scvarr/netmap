import os

import httpx
import pytest

from app.database import SessionLocal
from app.packet_flow_resolver import ConfiguredPacketFlowResolver
from app.repository import CanonicalRepository, RouteNextHopInput
from app.schemas import EvaluationView, PacketFlowEvaluationQuery, PacketState
from tests.test_packet_processing_adjacency_e2e import build_handoff_fixture


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def evaluate(context_id, traffic_class="TRANSIT", packet=None, **runtime):
    return httpx.post(
        f"{BASE_URL}/v1/traces/packet-flow/evaluation",
        json={
            "routing_context_id": str(context_id),
            "traffic_class": traffic_class,
            "packet_state": packet or {"destination_ip": "203.0.113.9"},
            **{
                key: (str(value) if key != "max_processing_points" else value)
                for key, value in runtime.items()
            },
        },
        timeout=20,
    )


def terminal(repository, plan_id, outcome):
    return repository.add_processing_stage(
        plan_id, "TERMINATE", {"outcome": outcome}
    )


def local_plan(repository, *, outcome="NETWORK_DELIVERY", traffic_class="LOCAL_INPUT"):
    plan = repository.add_packet_processing_plan("COMPLETE")
    if outcome == "NETWORK_DELIVERY":
        local = repository.add_processing_stage(plan.id, "LOCAL_DELIVERY", {})
        delivered = terminal(repository, plan.id, "NETWORK_DELIVERY")
        unknown = terminal(repository, plan.id, "UNKNOWN")
        repository.add_processing_entry_point(plan.id, traffic_class, local.id)
        repository.add_processing_transition(
            plan.id, local.id, "DELIVERED", delivered.id
        )
        repository.add_processing_transition(
            plan.id, local.id, "UNKNOWN", unknown.id
        )
    else:
        target = terminal(repository, plan.id, outcome)
        repository.add_processing_entry_point(plan.id, traffic_class, target.id)
    return plan


def attach(repository, context_id, traffic_class, plan, scope=None, completeness="COMPLETE"):
    attachment_set = repository.add_packet_processing_plan_attachment_set(
        context_id, traffic_class, completeness
    )
    repository.add_packet_processing_plan_attachment(
        attachment_set.id, plan.id, scope or {}
    )
    return attachment_set


def attach_handoff_fixture(repository, fixture, host_outcome="NETWORK_DELIVERY"):
    attach(
        repository,
        fixture["source_context"].id,
        "TRANSIT",
        fixture["plan"],
    )
    host = local_plan(repository, outcome=host_outcome)
    attach(
        repository,
        fixture["receiving_context"].id,
        "LOCAL_INPUT",
        host,
        {"ingress_l3_binding_ids": [str(fixture["target_binding"].id)]},
    )
    return host


def test_query_is_exact_only_and_bounded():
    with SessionLocal.begin() as session:
        context = CanonicalRepository(session).add_routing_context()
        context_id = context.id

    assert evaluate(context_id, analysis_mode="POSSIBLE").status_code == 422
    assert evaluate(context_id, max_processing_points=0).status_code == 422
    assert evaluate(context_id, max_processing_points=257).status_code == 422


def test_one_processing_point_local_delivery_maps_to_delivered():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        plan = local_plan(repository)
        attach(repository, context.id, "LOCAL_INPUT", plan)
        context_id = context.id

    artifact = evaluate(context_id, "LOCAL_INPUT").json()

    assert artifact["result"] == "DELIVERED"
    assert artifact["branches"][0]["termination_reason"] == "NETWORK_DELIVERY"
    assert len(artifact["branches"][0]["local_steps"]) == 1
    step = artifact["branches"][0]["local_steps"][0]
    assert step["plan_selection"]["result"] == "PLAN_SELECTED"
    assert step["packet_processing_evaluation"]["result"] == "NETWORK_DELIVERY"
    assert step["selected_execution_branch_id"] == "packet-processing-branch-1"


@pytest.mark.parametrize(
    ("terminal_outcome", "expected", "reason"),
    [
        ("NOT_DELIVERED", "NOT_DELIVERED", "NOT_DELIVERED"),
        ("UNKNOWN", "UNKNOWN", "LOCAL_EXECUTION_UNKNOWN"),
    ],
)
def test_local_terminal_mapping(terminal_outcome, expected, reason):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        plan = local_plan(
            repository, outcome=terminal_outcome, traffic_class="TRANSIT"
        )
        attach(repository, context.id, "TRANSIT", plan)
        context_id = context.id

    branch = evaluate(context_id).json()["branches"][0]
    assert branch["verdict"] == expected
    assert branch["termination_reason"] == reason


def test_selection_unknown_conflicting_and_no_plan_do_not_execute():
    ids = {}
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        missing = repository.add_routing_context()
        empty = repository.add_routing_context()
        conflict = repository.add_routing_context()
        repository.add_packet_processing_plan_attachment_set(
            empty.id, "TRANSIT", "COMPLETE"
        )
        conflict_set = repository.add_packet_processing_plan_attachment_set(
            conflict.id, "TRANSIT", "COMPLETE"
        )
        for _ in range(2):
            plan = local_plan(repository, outcome="UNKNOWN", traffic_class="TRANSIT")
            repository.add_packet_processing_plan_attachment(
                conflict_set.id, plan.id, {}
            )
        ids = {"missing": missing.id, "empty": empty.id, "conflict": conflict.id}

    expected = {
        "missing": ("PLAN_SELECTION_UNKNOWN", "PLAN_SELECTION_UNRESOLVED"),
        "empty": (
            "NO_PROCESSING_PLAN_APPLICABLE",
            "NO_PROCESSING_PLAN_APPLICABLE",
        ),
        "conflict": ("PLAN_SELECTION_CONFLICTING", "PLAN_SELECTION_UNRESOLVED"),
    }
    for name, context_id in ids.items():
        artifact = evaluate(context_id).json()
        branch = artifact["branches"][0]
        step = branch["local_steps"][0]
        assert artifact["result"] == "UNKNOWN"
        assert branch["termination_reason"] == expected[name][0]
        assert branch["gaps"][0]["code"] == expected[name][1]
        assert step["packet_processing_evaluation"] is None


def test_selected_partial_plan_preserves_empty_local_artifact():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        plan = repository.add_packet_processing_plan("PARTIAL")
        end = terminal(repository, plan.id, "UNKNOWN")
        repository.add_processing_entry_point(plan.id, "TRANSIT", end.id)
        attach(repository, context.id, "TRANSIT", plan)
        context_id = context.id

    artifact = evaluate(context_id).json()
    step = artifact["branches"][0]["local_steps"][0]

    assert artifact["result"] == "UNKNOWN"
    assert step["packet_processing_evaluation"]["branches"] == []
    assert step["packet_processing_evaluation"]["gaps"][0]["code"] == (
        "PROCESSING_PLAN_INCOMPLETE"
    )


def test_router_to_host_selects_new_local_input_plan_and_delivers():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        fixture = build_handoff_fixture(repository)
        host = attach_handoff_fixture(repository, fixture)
        source_id = fixture["source_context"].id

    artifact = evaluate(source_id).json()
    branch = artifact["branches"][0]
    first, second = branch["local_steps"]

    assert artifact["result"] == "DELIVERED"
    assert len(branch["local_steps"]) == 2
    assert first["packet_processing_evaluation"]["result"] == (
        "CONTINUE_TO_NEXT_HOP"
    )
    assert first["handoff"]["outcome"] == "TARGET_ATTACHMENT_REACHED"
    assert first["context_after"]["traffic_class"] == "LOCAL_INPUT"
    assert second["context_before"] == first["context_after"]
    assert second["selected_plan_id"] == str(host.id)
    assert second["packet_processing_evaluation"]["result"] == "NETWORK_DELIVERY"


def test_dnat_current_packet_crosses_handoff_not_original_packet():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        fixture = build_handoff_fixture(
            repository, nat_destination="198.51.100.9"
        )
        attach_handoff_fixture(repository, fixture)
        source_id = fixture["source_context"].id

    artifact = evaluate(source_id, packet={"destination_ip": "203.0.113.9"}).json()
    first, second = artifact["branches"][0]["local_steps"]

    assert artifact["original_packet_state"]["destination_ip"] == "203.0.113.9"
    assert first["context_before"]["packet_state"]["destination_ip"] == (
        "203.0.113.9"
    )
    assert first["context_after"]["packet_state"]["destination_ip"] == (
        "198.51.100.9"
    )
    assert second["context_before"]["packet_state"]["destination_ip"] == (
        "198.51.100.9"
    )


@pytest.mark.parametrize("initial_state", ["ESTABLISHED", "NEW", "UNKNOWN"])
def test_connection_state_is_initial_local_input_only(initial_state):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        fixture = build_handoff_fixture(repository)
        attach_handoff_fixture(repository, fixture)
        source_id = fixture["source_context"].id

    artifact = evaluate(source_id, connection_state=initial_state).json()
    first, second = artifact["branches"][0]["local_steps"]

    assert first["context_before"]["connection_state"] == initial_state
    assert first["packet_processing_evaluation"]["query"]["connection_state"] == (
        initial_state
    )
    assert second["context_before"]["connection_state"] is None
    assert second["packet_processing_evaluation"]["query"]["connection_state"] is None


def test_second_processing_point_drop_terminates_end_to_end_negative():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        fixture = build_handoff_fixture(repository)
        attach_handoff_fixture(repository, fixture, "NOT_DELIVERED")
        source_id = fixture["source_context"].id

    artifact = evaluate(source_id).json()
    assert artifact["result"] == "NOT_DELIVERED"
    assert len(artifact["branches"][0]["local_steps"]) == 2


def test_second_processing_point_without_attachment_is_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        fixture = build_handoff_fixture(repository)
        attach(
            repository,
            fixture["source_context"].id,
            "TRANSIT",
            fixture["plan"],
        )
        source_id = fixture["source_context"].id

    artifact = evaluate(source_id).json()
    branch = artifact["branches"][0]
    assert artifact["result"] == "UNKNOWN"
    assert len(branch["local_steps"]) == 2
    assert branch["termination_reason"] == "PLAN_SELECTION_UNKNOWN"


def test_multiple_l2_paths_are_not_merged_before_next_execution():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        fixture = build_handoff_fixture(repository, two_l2_paths=True)
        attach_handoff_fixture(repository, fixture)
        source_id = fixture["source_context"].id

    artifact = evaluate(source_id).json()

    assert artifact["result"] == "DELIVERED"
    assert len(artifact["branches"]) == 2
    selected_l2 = {
        branch["local_steps"][0]["packet_processing_evaluation"]["branches"][
            int(
                branch["local_steps"][0]["selected_execution_branch_id"].rsplit(
                    "-", 1
                )[1]
            )
            - 1
        ]["stage_executions"][-2]["selected_l2_branch_id"]
        for branch in artifact["branches"]
    }
    assert len(selected_l2) == 2


def test_all_branched_paths_negative_aggregate_not_delivered():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        fixture = build_handoff_fixture(repository, two_l2_paths=True)
        attach_handoff_fixture(repository, fixture, "NOT_DELIVERED")
        source_id = fixture["source_context"].id

    artifact = evaluate(source_id).json()

    assert artifact["result"] == "NOT_DELIVERED"
    assert len(artifact["branches"]) == 2
    assert {branch["verdict"] for branch in artifact["branches"]} == {
        "NOT_DELIVERED"
    }


@pytest.mark.parametrize(
    "second_outcome",
    [
        "NETWORK_DELIVERY",
        "NOT_DELIVERED",
        None,
    ],
)
def test_duplicate_handoffs_preserve_branch_outcomes_and_evidence(
    second_outcome,
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        fixture = build_handoff_fixture(
            repository, duplicate_target="REACHABLE"
        )
        attach(
            repository,
            fixture["source_context"].id,
            "TRANSIT",
            fixture["plan"],
        )
        first_host = local_plan(repository)
        attach(
            repository,
            fixture["receiving_context"].id,
            "LOCAL_INPUT",
            first_host,
        )
        if second_outcome is not None:
            second_host = local_plan(repository, outcome=second_outcome)
            attach(
                repository,
                fixture["duplicate"]["context"].id,
                "LOCAL_INPUT",
                second_host,
            )
        source_id = fixture["source_context"].id
        target_binding_ids = {
            str(fixture["target_binding"].id),
            str(fixture["duplicate"]["binding"].id),
        }

    artifact = evaluate(source_id).json()

    assert artifact["result"] == "UNKNOWN"
    assert len(artifact["branches"]) >= 2
    if second_outcome == "NOT_DELIVERED":
        assert {branch["verdict"] for branch in artifact["branches"]} >= {
            "DELIVERED",
            "NOT_DELIVERED",
        }
    elif second_outcome is None:
        assert {branch["verdict"] for branch in artifact["branches"]} >= {
            "DELIVERED",
            "UNKNOWN",
        }
    successful = [
        branch
        for branch in artifact["branches"]
        if branch["local_steps"][0]["handoff"] is not None
    ]
    assert {
        branch["local_steps"][0]["handoff"]["receiving_l3_binding_id"]
        for branch in successful
    } == target_binding_ids
    for branch in successful:
        reached = branch["local_steps"][0]["handoff"][
            "receiving_l3_binding_id"
        ]
        l3_refs = {
            ref["entity_id"]
            for ref in branch["evidence_refs"]
            if ref["entity_type"] == "L3Binding"
        }
        assert reached in l3_refs
        assert not (target_binding_ids - {reached}) & l3_refs


def test_continue_without_handoff_is_orchestration_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        plan = local_plan(
            repository, outcome="CONTINUE_TO_NEXT_HOP", traffic_class="TRANSIT"
        )
        attach(repository, context.id, "TRANSIT", plan)
        context_id = context.id

    artifact = evaluate(context_id).json()
    branch = artifact["branches"][0]
    assert artifact["result"] == "UNKNOWN"
    assert branch["termination_reason"] == "PROCESSING_HANDOFF_UNKNOWN"
    assert branch["gaps"][0]["code"] == "PROCESSING_HANDOFF_UNKNOWN"


def add_gateway_loop(repository):
    context_a = repository.add_routing_context()
    context_b = repository.add_routing_context()
    interface_a = repository.add_network_interface()
    interface_b = repository.add_network_interface()
    binding_a = repository.add_l3_binding(interface_a.id, context_a.id)
    binding_b = repository.add_l3_binding(interface_b.id, context_b.id)
    repository.add_interface_address(binding_a.id, "192.0.2.1", 24)
    repository.add_interface_address(binding_b.id, "192.0.2.2", 24)
    l2_context = repository.add_l2_forwarding_context()
    repository.add_l2_binding(interface_a.id, l2_context.id)
    repository.add_l2_binding(interface_b.id, l2_context.id)

    def add_router(context, binding, gateway):
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        policy = repository.add_routing_policy(
            {"op": "SELECT_TABLE", "routing_table_id": str(table.id)},
            "COMPLETE",
        )
        repository.add_route(
            table.id,
            "203.0.113.0/24",
            "FORWARD",
            [
                RouteNextHopInput(
                    gateway_address=gateway,
                    egress_l3_binding_id=binding.id,
                )
            ],
        )
        plan = repository.add_packet_processing_plan("COMPLETE")
        policy_stage = repository.add_processing_stage(
            plan.id, "ROUTING_POLICY", {"policy_id": str(policy.id)}
        )
        route = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        adjacency = repository.add_processing_stage(plan.id, "ADJACENCY_L2", {})
        proceed = terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
        negative = terminal(repository, plan.id, "NOT_DELIVERED")
        unknown = terminal(repository, plan.id, "UNKNOWN")
        delivery = terminal(repository, plan.id, "NETWORK_DELIVERY")
        repository.add_processing_entry_point(plan.id, "TRANSIT", policy_stage.id)
        repository.add_processing_transition(
            plan.id, policy_stage.id, "TABLE_SELECTED", route.id
        )
        repository.add_processing_transition(
            plan.id, policy_stage.id, "TABLE_SELECTION_UNKNOWN", unknown.id
        )
        for outcome, target in (
            ("FORWARD", adjacency),
            ("LOCAL", delivery),
            ("DISCARD", negative),
            ("NO_ROUTE", negative),
            ("UNKNOWN", unknown),
            ("CONFLICTING", unknown),
        ):
            repository.add_processing_transition(plan.id, route.id, outcome, target.id)
        for outcome, target in (
            ("NEXT_PROCESSING_POINT", proceed),
            ("TARGET_ATTACHMENT_REACHED", proceed),
            ("L2_UNREACHABLE", negative),
            ("UNKNOWN", unknown),
        ):
            repository.add_processing_transition(
                plan.id, adjacency.id, outcome, target.id
            )
        attach(repository, context.id, "TRANSIT", plan)

    add_router(context_a, binding_a, "192.0.2.2")
    add_router(context_b, binding_b, "192.0.2.1")
    return context_a, interface_a, binding_a


def add_forwarding_plan(
    repository,
    context,
    egress_binding,
    route_prefix,
    *,
    gateway=None,
    nat_destination=None,
):
    table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
    policy = repository.add_routing_policy(
        {"op": "SELECT_TABLE", "routing_table_id": str(table.id)},
        "COMPLETE",
    )
    repository.add_route(
        table.id,
        route_prefix,
        "FORWARD",
        [
            RouteNextHopInput(
                gateway_address=gateway,
                egress_l3_binding_id=egress_binding.id,
            )
        ],
    )
    plan = repository.add_packet_processing_plan("COMPLETE")
    policy_stage = repository.add_processing_stage(
        plan.id, "ROUTING_POLICY", {"policy_id": str(policy.id)}
    )
    route = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
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
    proceed = terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
    negative = terminal(repository, plan.id, "NOT_DELIVERED")
    unknown = terminal(repository, plan.id, "UNKNOWN")
    delivery = terminal(repository, plan.id, "NETWORK_DELIVERY")
    repository.add_processing_entry_point(plan.id, "TRANSIT", policy_stage.id)
    repository.add_processing_transition(
        plan.id, policy_stage.id, "TABLE_SELECTED", nat.id if nat else route.id
    )
    repository.add_processing_transition(
        plan.id, policy_stage.id, "TABLE_SELECTION_UNKNOWN", unknown.id
    )
    if nat is not None:
        for outcome, target in (
            ("IDENTITY", route),
            ("TRANSFORMED_EXACT", route),
            ("TRANSFORMED_CONSTRAINED", unknown),
            ("UNKNOWN", unknown),
        ):
            repository.add_processing_transition(plan.id, nat.id, outcome, target.id)
    for outcome, target in (
        ("FORWARD", adjacency),
        ("LOCAL", delivery),
        ("DISCARD", negative),
        ("NO_ROUTE", negative),
        ("UNKNOWN", unknown),
        ("CONFLICTING", unknown),
    ):
        repository.add_processing_transition(plan.id, route.id, outcome, target.id)
    for outcome, target in (
        ("NEXT_PROCESSING_POINT", proceed),
        ("TARGET_ATTACHMENT_REACHED", proceed),
        ("L2_UNREACHABLE", negative),
        ("UNKNOWN", unknown),
    ):
        repository.add_processing_transition(plan.id, adjacency.id, outcome, target.id)
    return plan


def test_two_routers_to_host_and_two_nat_lineage_versions():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        first = build_handoff_fixture(
            repository,
            gateway="192.0.2.2",
            nat_destination="198.51.100.9",
        )
        attach(
            repository,
            first["source_context"].id,
            "TRANSIT",
            first["plan"],
        )

        router_two_context = first["receiving_context"]
        router_two_egress_interface = repository.add_network_interface()
        router_two_egress = repository.add_l3_binding(
            router_two_egress_interface.id, router_two_context.id
        )
        host_context = repository.add_routing_context()
        host_interface = repository.add_network_interface()
        host_binding = repository.add_l3_binding(
            host_interface.id, host_context.id
        )
        repository.add_interface_address(host_binding.id, "10.0.0.9", 24)
        l2_context = repository.add_l2_forwarding_context()
        repository.add_l2_binding(router_two_egress_interface.id, l2_context.id)
        repository.add_l2_binding(host_interface.id, l2_context.id)
        router_two_plan = add_forwarding_plan(
            repository,
            router_two_context,
            router_two_egress,
            "10.0.0.0/24",
            nat_destination="10.0.0.9",
        )
        attach(
            repository,
            router_two_context.id,
            "TRANSIT",
            router_two_plan,
            {"ingress_l3_binding_ids": [str(first["target_binding"].id)]},
        )
        host_plan = local_plan(repository)
        attach(
            repository,
            host_context.id,
            "LOCAL_INPUT",
            host_plan,
            {"ingress_l3_binding_ids": [str(host_binding.id)]},
        )
        source_id = first["source_context"].id

    artifact = evaluate(source_id).json()
    branch = artifact["branches"][0]
    packets = [
        step["context_before"]["packet_state"]["destination_ip"]
        for step in branch["local_steps"]
    ]

    assert artifact["result"] == "DELIVERED"
    assert len(branch["local_steps"]) == 3
    assert packets == ["203.0.113.9", "198.51.100.9", "10.0.0.9"]
    assert artifact["original_packet_state"]["destination_ip"] == "203.0.113.9"


def test_branch_local_exact_context_loop_beats_search_limit():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, interface, binding = add_gateway_loop(repository)
        ids = context.id, interface.id, binding.id

    artifact = evaluate(
        ids[0],
        ingress_network_interface_id=ids[1],
        ingress_l3_binding_id=ids[2],
        max_processing_points=2,
    ).json()
    branch = artifact["branches"][0]

    assert artifact["result"] == "UNKNOWN"
    assert branch["termination_reason"] == "PACKET_FLOW_LOOP_DETECTED"
    assert branch["gaps"][-1]["code"] == "PACKET_FLOW_LOOP_DETECTED"
    assert len(branch["local_steps"]) == 2


def test_processing_point_limit_is_typed_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, _interface, _binding = add_gateway_loop(repository)
        context_id = context.id

    artifact = evaluate(context_id, max_processing_points=1).json()
    branch = artifact["branches"][0]

    assert artifact["result"] == "UNKNOWN"
    assert branch["termination_reason"] == "PACKET_FLOW_SEARCH_LIMIT"
    assert branch["gaps"][-1]["code"] == "PACKET_FLOW_SEARCH_LIMIT"
    assert len(branch["local_steps"]) == 1


def test_same_repository_and_evaluation_view_are_reused_across_hops():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        fixture = build_handoff_fixture(repository)
        attach_handoff_fixture(repository, fixture)
        resolver = ConfiguredPacketFlowResolver(repository)
        view = EvaluationView()
        seen_views = []
        selector_resolve = resolver.selector.resolve
        executor_resolve = resolver.executor.resolve

        def record_selector(query, current_view):
            seen_views.append(current_view)
            return selector_resolve(query, current_view)

        def record_executor(query, current_view):
            seen_views.append(current_view)
            return executor_resolve(query, current_view)

        resolver.selector.resolve = record_selector
        resolver.executor.resolve = record_executor
        artifact = resolver.resolve(
            PacketFlowEvaluationQuery(
                routing_context_id=fixture["source_context"].id,
                traffic_class="TRANSIT",
                packet_state=PacketState(destination_ip="203.0.113.9"),
            ),
            view,
        )

    assert artifact.result == "DELIVERED"
    assert len(seen_views) == 4
    assert all(item is view for item in seen_views)
    assert resolver.selector.repository is repository
    assert resolver.executor.repository is repository
