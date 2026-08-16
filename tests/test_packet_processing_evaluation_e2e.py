import inspect
import os
import uuid
from dataclasses import FrozenInstanceError

import httpx
import pytest
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select

from app import packet_processing_executor
from app.database import SessionLocal
from app.errors import ValidationError
from app.models import (
    PacketProcessingPlan,
    ProcessingEntryPoint,
    ProcessingStage,
    ProcessingTransition,
)
from app.packet_processing_executor import FlowExecutionState, PacketProcessingPlanExecutor
from app.repository import CanonicalRepository, RouteNextHopInput
from app.schemas import (
    DirectEgressState,
    EvaluationView,
    NextHopResolutionArtifact,
    NextHopResolutionBranch,
    PacketProcessingEvaluationQuery,
    PacketState,
)


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def evaluate(plan_id, context_id, *, traffic_class="TRANSIT", packet=None, **extra):
    return httpx.post(
        f"{BASE_URL}/v1/traces/packet-processing/evaluation",
        json={
            "plan_id": str(plan_id),
            "traffic_class": traffic_class,
            "routing_context_id": str(context_id),
            "packet_state": (
                {"destination_ip": "203.0.113.8"} if packet is None else packet
            ),
            **extra,
        },
        timeout=5,
    )


def routing_fixture(*, table_completeness="COMPLETE"):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(
            context.id, "IPv4", table_completeness
        )
        interface = repository.add_network_interface()
        binding = repository.add_l3_binding(interface.id, context.id)
        policy = repository.add_routing_policy(
            {"op": "SELECT_TABLE", "routing_table_id": str(table.id)},
            "COMPLETE",
        )
        return context.id, table.id, binding.id, policy.id


def add_terminal(repository, plan_id, outcome):
    return repository.add_processing_stage(
        plan_id, "TERMINATE", {"outcome": outcome}
    )


def add_routing_plan(repository, policy_id, *, include_policy=True):
    plan = repository.add_packet_processing_plan("COMPLETE")
    route = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
    forward = add_terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
    local = add_terminal(repository, plan.id, "NETWORK_DELIVERY")
    negative = add_terminal(repository, plan.id, "NOT_DELIVERED")
    unknown = add_terminal(repository, plan.id, "UNKNOWN")
    if include_policy:
        policy = repository.add_processing_stage(
            plan.id, "ROUTING_POLICY", {"policy_id": str(policy_id)}
        )
        repository.add_processing_entry_point(plan.id, "TRANSIT", policy.id)
        repository.add_processing_transition(
            plan.id, policy.id, "TABLE_SELECTED", route.id
        )
        repository.add_processing_transition(
            plan.id, policy.id, "TABLE_SELECTION_UNKNOWN", unknown.id
        )
    else:
        policy = None
        repository.add_processing_entry_point(plan.id, "TRANSIT", route.id)
    for outcome, target in (
        ("FORWARD", forward),
        ("LOCAL", local),
        ("DISCARD", negative),
        ("NO_ROUTE", negative),
        ("UNKNOWN", unknown),
        ("CONFLICTING", unknown),
    ):
        repository.add_processing_transition(plan.id, route.id, outcome, target.id)
    return plan, policy, route, {
        "FORWARD": forward,
        "LOCAL": local,
        "DISCARD": negative,
        "NO_ROUTE": negative,
        "UNKNOWN": unknown,
        "CONFLICTING": unknown,
    }


def direct_terminal_plan(outcome, entries=("TRANSIT",), completeness="COMPLETE"):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        plan = repository.add_packet_processing_plan(completeness)
        terminal = add_terminal(repository, plan.id, outcome)
        for traffic_class in entries:
            repository.add_processing_entry_point(
                plan.id, traffic_class, terminal.id
            )
        return context.id, plan.id, terminal.id


def stage_execution(artifact, kind):
    return next(
        execution
        for execution in artifact["branches"][0]["stage_executions"]
        if execution["stage_kind"] == kind
    )


@pytest.mark.parametrize(
    "outcome",
    [
        "CONTINUE_TO_NEXT_HOP",
        "NETWORK_DELIVERY",
        "NOT_DELIVERED",
        "UNKNOWN",
    ],
)
def test_direct_terminate_execution_preserves_exact_outcome(outcome):
    context_id, plan_id, terminal_id = direct_terminal_plan(outcome)

    artifact = evaluate(plan_id, context_id).json()

    assert artifact["result"] == outcome
    assert artifact["branches"][0]["terminal_outcome"] == outcome
    execution = artifact["branches"][0]["stage_executions"][0]
    assert execution["stage_id"] == str(terminal_id)
    assert execution["stage_kind"] == "TERMINATE"
    assert execution["transition_id"] is None
    assert execution["routing_policy_evaluation"] is None
    assert execution["next_hop_resolution"] is None


def test_entry_is_selected_only_by_requested_traffic_class():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        plan = repository.add_packet_processing_plan("COMPLETE")
        transit = add_terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
        local = add_terminal(repository, plan.id, "NETWORK_DELIVERY")
        repository.add_processing_entry_point(plan.id, "TRANSIT", transit.id)
        repository.add_processing_entry_point(plan.id, "LOCAL_INPUT", local.id)
        context_id, plan_id = context.id, plan.id

    artifact = evaluate(
        plan_id, context_id, traffic_class="LOCAL_INPUT"
    ).json()

    assert artifact["result"] == "NETWORK_DELIVERY"
    assert artifact["branches"][0]["initial_state"]["current_stage_id"] == str(
        local.id
    )


def test_missing_requested_entry_is_validation_error_without_fallback():
    context_id, plan_id, _ = direct_terminal_plan("UNKNOWN")

    response = evaluate(plan_id, context_id, traffic_class="LOCAL_OUTPUT")

    assert response.status_code == 422
    assert response.json()["error"]["details"]["reason"] == (
        "PROCESSING_ENTRY_UNAVAILABLE"
    )


@pytest.mark.parametrize("completeness", ["PARTIAL", "UNKNOWN"])
def test_incomplete_plan_returns_unknown_without_execution(completeness):
    context_id, plan_id, _ = direct_terminal_plan(
        "CONTINUE_TO_NEXT_HOP", completeness=completeness
    )

    artifact = evaluate(plan_id, context_id).json()

    assert artifact["result"] == "UNKNOWN"
    assert artifact["branches"] == []
    assert {gap["code"] for gap in artifact["gaps"]} == {
        "PROCESSING_PLAN_INCOMPLETE"
    }


@pytest.mark.parametrize("kind", ["SECURITY", "NAT"])
def test_complete_security_or_nat_plan_is_rejected_by_executor(kind):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        plan = repository.add_packet_processing_plan("COMPLETE")
        if kind == "SECURITY":
            policy = repository.add_security_policy("PERMIT", "COMPLETE")
            attachment = repository.add_security_policy_attachment(policy.id, 10, {})
            payload = {"attachment_id": str(attachment.id)}
            outcomes = ("PASS", "BLOCKED", "UNKNOWN")
        else:
            policy = repository.add_nat_policy({"op": "IDENTITY"}, "COMPLETE")
            attachment = repository.add_nat_policy_attachment(policy.id, 10, {})
            payload = {"attachment_id": str(attachment.id)}
            outcomes = (
                "IDENTITY",
                "TRANSFORMED_EXACT",
                "TRANSFORMED_CONSTRAINED",
                "UNKNOWN",
            )
        stage = repository.add_processing_stage(plan.id, kind, payload)
        terminal = add_terminal(repository, plan.id, "UNKNOWN")
        repository.add_processing_entry_point(plan.id, "TRANSIT", stage.id)
        for outcome in outcomes:
            repository.add_processing_transition(
                plan.id, stage.id, outcome, terminal.id
            )
        context_id, plan_id, stage_id = context.id, plan.id, stage.id

    response = evaluate(plan_id, context_id)

    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert details["reason"] == "PACKET_PROCESSING_STAGE_UNSUPPORTED_BY_EXECUTOR"
    assert details["processing_stage_id"] == str(stage_id)
    assert details["stage_kind"] == kind


def test_policy_selected_table_is_stored_and_transition_is_explicit():
    context_id, table_id, _binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        plan, policy_stage, _route, terminals = add_routing_plan(
            CanonicalRepository(session), policy_id
        )
        plan_id = plan.id

    artifact = evaluate(plan_id, context_id).json()
    execution = stage_execution(artifact, "ROUTING_POLICY")

    assert execution["stage_outcome"] == "TABLE_SELECTED"
    assert execution["selected_routing_table_id_before"] is None
    assert execution["selected_routing_table_id_after"] == str(table_id)
    assert execution["routing_policy_evaluation"]["result"] == "TABLE_SELECTED"
    assert execution["next_stage_id"] != str(terminals["UNKNOWN"].id)


def test_policy_unknown_follows_unknown_transition_without_guessing_table():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table_a = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        table_b = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        policy = repository.add_routing_policy(
            {"op": "SELECT_TABLE", "routing_table_id": str(table_a.id)},
            "COMPLETE",
        )
        repository.add_routing_policy_rule(
            policy.id,
            10,
            {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]},
            {"op": "SELECT_TABLE", "routing_table_id": str(table_b.id)},
        )
        plan, _policy_stage, _route, terminals = add_routing_plan(
            repository, policy.id
        )
        context_id, plan_id, unknown_id = context.id, plan.id, terminals["UNKNOWN"].id

    artifact = evaluate(plan_id, context_id).json()
    execution = stage_execution(artifact, "ROUTING_POLICY")

    assert artifact["result"] == "UNKNOWN"
    assert len(artifact["branches"]) == 1
    assert execution["stage_outcome"] == "TABLE_SELECTION_UNKNOWN"
    assert execution["selected_routing_table_id_after"] is None
    assert execution["next_stage_id"] == str(unknown_id)
    assert not any(
        item["stage_kind"] == "ROUTE_DECISION"
        for item in artifact["branches"][0]["stage_executions"]
    )


def test_routing_policy_stage_obeys_graph_and_does_not_route_automatically():
    context_id, table_id, binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_route(
            table_id,
            "203.0.113.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=binding_id)],
        )
        plan = repository.add_packet_processing_plan("COMPLETE")
        policy = repository.add_processing_stage(
            plan.id, "ROUTING_POLICY", {"policy_id": str(policy_id)}
        )
        delivered = add_terminal(repository, plan.id, "NETWORK_DELIVERY")
        unknown = add_terminal(repository, plan.id, "UNKNOWN")
        repository.add_processing_entry_point(plan.id, "TRANSIT", policy.id)
        repository.add_processing_transition(
            plan.id, policy.id, "TABLE_SELECTED", delivered.id
        )
        repository.add_processing_transition(
            plan.id, policy.id, "TABLE_SELECTION_UNKNOWN", unknown.id
        )
        plan_id = plan.id

    artifact = evaluate(plan_id, context_id).json()

    assert artifact["result"] == "NETWORK_DELIVERY"
    assert [
        execution["stage_kind"]
        for execution in artifact["branches"][0]["stage_executions"]
    ] == ["ROUTING_POLICY", "TERMINATE"]
    assert "Route" not in {ref["entity_type"] for ref in artifact["evidence_refs"]}


@pytest.mark.parametrize("packet", [{"destination_ip": "203.0.113.8"}, {}])
def test_route_stage_missing_precondition_follows_unknown_transition(packet):
    context_id, _table_id, _binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        plan, _policy, route, terminals = add_routing_plan(
            CanonicalRepository(session), policy_id, include_policy=False
        )
        plan_id, route_id, unknown_id = plan.id, route.id, terminals["UNKNOWN"].id

    artifact = evaluate(plan_id, context_id, packet=packet).json()
    execution = stage_execution(artifact, "ROUTE_DECISION")

    assert artifact["result"] == "UNKNOWN"
    assert execution["stage_outcome"] == "UNKNOWN"
    assert execution["next_stage_id"] == str(unknown_id)
    assert execution["next_hop_resolution"] is None
    assert {gap["code"] for gap in execution["gaps"]} == {
        "STAGE_PRECONDITION_UNKNOWN"
    }
    assert execution["stage_id"] == str(route_id)


@pytest.mark.parametrize(
    ("disposition", "normalized", "terminal"),
    [
        ("LOCAL", "LOCAL", "NETWORK_DELIVERY"),
        ("DISCARD", "DISCARD", "NOT_DELIVERED"),
    ],
)
def test_local_and_discard_route_outcomes(disposition, normalized, terminal):
    context_id, table_id, _binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_route(table_id, "203.0.113.0/24", disposition)
        plan, _policy, _route, _terminals = add_routing_plan(repository, policy_id)
        plan_id = plan.id

    artifact = evaluate(plan_id, context_id).json()
    execution = stage_execution(artifact, "ROUTE_DECISION")

    assert artifact["result"] == terminal
    assert execution["stage_outcome"] == normalized
    assert execution["direct_egress"] is None
    if disposition == "LOCAL":
        assert execution["traffic_class_before"] == "TRANSIT"
        assert execution["traffic_class_after"] == "LOCAL_INPUT"


def test_local_transition_does_not_jump_to_local_input_entry():
    context_id, table_id, _binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_route(table_id, "203.0.113.0/24", "LOCAL")
        plan, _policy, _route, terminals = add_routing_plan(repository, policy_id)
        alternate = add_terminal(repository, plan.id, "NOT_DELIVERED")
        repository.add_processing_entry_point(plan.id, "LOCAL_INPUT", alternate.id)
        plan_id, explicit_local = plan.id, terminals["LOCAL"].id

    artifact = evaluate(plan_id, context_id).json()
    executions = artifact["branches"][0]["stage_executions"]

    assert artifact["result"] == "NETWORK_DELIVERY"
    assert executions[-1]["stage_id"] == str(explicit_local)


def test_complete_table_without_route_follows_no_route_transition():
    context_id, _table_id, _binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        plan, _policy, _route, _terminals = add_routing_plan(
            CanonicalRepository(session), policy_id
        )
        plan_id = plan.id

    artifact = evaluate(plan_id, context_id).json()
    execution = stage_execution(artifact, "ROUTE_DECISION")

    assert artifact["result"] == "NOT_DELIVERED"
    assert execution["stage_outcome"] == "NO_ROUTE"


@pytest.mark.parametrize("completeness", ["PARTIAL", "UNKNOWN"])
def test_incomplete_selected_table_follows_route_unknown(completeness):
    context_id, _table_id, _binding_id, policy_id = routing_fixture(
        table_completeness=completeness
    )
    with SessionLocal.begin() as session:
        plan, _policy, _route, _terminals = add_routing_plan(
            CanonicalRepository(session), policy_id
        )
        plan_id = plan.id

    artifact = evaluate(plan_id, context_id).json()

    assert artifact["result"] == "UNKNOWN"
    assert stage_execution(artifact, "ROUTE_DECISION")["stage_outcome"] == "UNKNOWN"


def test_conflicting_route_follows_conflicting_transition():
    context_id, table_id, _binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_route(table_id, "203.0.113.0/24", "LOCAL")
        repository.add_route(table_id, "203.0.113.0/24", "DISCARD")
        plan, _policy, _route, _terminals = add_routing_plan(repository, policy_id)
        plan_id = plan.id

    artifact = evaluate(plan_id, context_id).json()

    assert artifact["result"] == "UNKNOWN"
    assert stage_execution(artifact, "ROUTE_DECISION")["stage_outcome"] == (
        "CONFLICTING"
    )


def test_recursive_gateway_resolution_uses_same_selected_table_and_preserves_egress():
    context_id, table_id, binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_route(
            table_id,
            "203.0.113.0/24",
            "FORWARD",
            [RouteNextHopInput(gateway_address="192.0.2.1")],
        )
        repository.add_route(
            table_id,
            "192.0.2.1/32",
            "FORWARD",
            [RouteNextHopInput(gateway_address="192.0.2.2")],
        )
        repository.add_route(
            table_id,
            "192.0.2.2/32",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=binding_id)],
        )
        plan, _policy, _route, _terminals = add_routing_plan(repository, policy_id)
        plan_id = plan.id

    artifact = evaluate(plan_id, context_id).json()
    execution = stage_execution(artifact, "ROUTE_DECISION")
    nested_branch = execution["next_hop_resolution"]["branches"][0]

    assert artifact["result"] == "CONTINUE_TO_NEXT_HOP"
    assert execution["stage_outcome"] == "FORWARD"
    assert execution["direct_egress"] == {
        "egress_l3_binding_id": str(binding_id),
        "neighbor_target_ip": "192.0.2.2",
        "original_destination": "203.0.113.8",
    }
    assert {step["state"]["routing_table_id"] for step in nested_branch["lookup_steps"]} == {
        str(table_id)
    }
    assert [step["state"]["lookup_address"] for step in nested_branch["lookup_steps"]] == [
        "203.0.113.8",
        "192.0.2.1",
        "192.0.2.2",
    ]
    assert sum(
        item["stage_kind"] == "ROUTING_POLICY"
        for item in artifact["branches"][0]["stage_executions"]
    ) == 1


def test_recursive_loop_normalizes_to_unknown_and_preserves_reason():
    context_id, table_id, _binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        for prefix, gateway in (
            ("203.0.113.0/24", "192.0.2.1"),
            ("192.0.2.1/32", "192.0.2.2"),
            ("192.0.2.2/32", "192.0.2.1"),
        ):
            repository.add_route(
                table_id,
                prefix,
                "FORWARD",
                [RouteNextHopInput(gateway_address=gateway)],
            )
        plan, _policy, _route, _terminals = add_routing_plan(repository, policy_id)
        plan_id = plan.id

    artifact = evaluate(plan_id, context_id).json()
    execution = stage_execution(artifact, "ROUTE_DECISION")

    assert artifact["result"] == "UNKNOWN"
    assert execution["stage_outcome"] == "UNKNOWN"
    assert execution["next_hop_resolution"]["branches"][0]["outcome"] == (
        "LOOP_DETECTED"
    )
    assert {gap["code"] for gap in execution["gaps"]} == {
        "NEXT_HOP_RESOLUTION_LOOP"
    }


def test_multiple_resolved_next_hops_create_distinct_execution_branches():
    context_id, table_id, binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        second_binding = repository.add_l3_binding(interface.id, context_id)
        repository.add_route(
            table_id,
            "203.0.113.0/24",
            "FORWARD",
            [
                RouteNextHopInput(egress_l3_binding_id=binding_id),
                RouteNextHopInput(
                    gateway_address="192.0.2.9",
                    egress_l3_binding_id=second_binding.id,
                ),
            ],
        )
        plan, _policy, _route, _terminals = add_routing_plan(repository, policy_id)
        plan_id = plan.id

    artifact = evaluate(plan_id, context_id).json()

    assert artifact["result"] == "CONTINUE_TO_NEXT_HOP"
    assert len(artifact["branches"]) == 2
    assert {
        stage_execution({"branches": [branch]}, "ROUTE_DECISION")["direct_egress"][
            "egress_l3_binding_id"
        ]
        for branch in artifact["branches"]
    } == {str(binding_id), str(second_binding.id)}
    assert {
        stage_execution({"branches": [branch]}, "ROUTE_DECISION")[
            "selected_next_hop_branch_index"
        ]
        for branch in artifact["branches"]
    } == {0, 1}


def test_mixed_resolved_unknown_next_hops_remain_separate_and_aggregate_unknown():
    context_id, table_id, binding_id, policy_id = routing_fixture()
    with SessionLocal() as session:
        repository = CanonicalRepository(session)
        plan, _policy, _route, _terminals = add_routing_plan(repository, policy_id)
        session.commit()
        executor = PacketProcessingPlanExecutor(repository)

        class MixedNextHop:
            def resolve(self, query, view):
                return NextHopResolutionArtifact(
                    query=query,
                    evaluation_view=view,
                    result="RESOLVED",
                    branches=[
                        NextHopResolutionBranch(
                            outcome="RESOLVED",
                            lookup_steps=[],
                            direct_egress=DirectEgressState(
                                egress_l3_binding_id=binding_id,
                                neighbor_target_ip="203.0.113.8",
                                original_destination="203.0.113.8",
                            ),
                            evidence_refs=[],
                        ),
                        NextHopResolutionBranch(
                            outcome="UNKNOWN", lookup_steps=[], evidence_refs=[]
                        ),
                    ],
                    evidence_refs=[],
                    warnings=[],
                )

        executor.next_hop = MixedNextHop()
        artifact = executor.resolve(
            PacketProcessingEvaluationQuery(
                plan_id=plan.id,
                traffic_class="TRANSIT",
                routing_context_id=context_id,
                packet_state=PacketState(destination_ip="203.0.113.8"),
            ),
            EvaluationView(),
        )

    assert artifact.result == "UNKNOWN"
    assert len(artifact.branches) == 2
    route_outcomes = {
        next(
            execution.stage_outcome
            for execution in branch.stage_executions
            if execution.stage_kind == "ROUTE_DECISION"
        )
        for branch in artifact.branches
    }
    assert route_outcomes == {"FORWARD", "UNKNOWN"}
    assert {branch.terminal_outcome for branch in artifact.branches} == {
        "CONTINUE_TO_NEXT_HOP",
        "UNKNOWN",
    }


def test_packet_is_immutable_and_unchanged_across_routing_stages():
    context_id, table_id, binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_route(
            table_id,
            "203.0.113.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=binding_id)],
        )
        plan, _policy, _route, _terminals = add_routing_plan(repository, policy_id)
        plan_id = plan.id
    packet = {
        "source_ip": "10.0.0.1",
        "destination_ip": "203.0.113.8",
        "ip_protocol": 6,
        "destination_port": 443,
    }

    artifact = evaluate(plan_id, context_id, packet=packet).json()

    for execution in artifact["branches"][0]["stage_executions"]:
        assert execution["packet_before"] == execution["packet_after"]
    assert artifact["original_packet_state"] == {
        **packet,
        "source_port": None,
        "icmp_type": None,
        "icmp_code": None,
    }
    assert artifact["branches"][0]["final_state"]["current_packet_state"] == (
        artifact["original_packet_state"]
    )


def test_nested_resolvers_receive_the_same_evaluation_view_instance():
    context_id, table_id, binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_route(
            table_id,
            "203.0.113.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=binding_id)],
        )
        plan, _policy, _route, _terminals = add_routing_plan(repository, policy_id)
        plan_id = plan.id
    with SessionLocal() as session:
        executor = PacketProcessingPlanExecutor(CanonicalRepository(session))
        seen = []
        policy_core = executor.routing_policy
        next_hop_core = executor.next_hop

        class Recorder:
            def __init__(self, delegate):
                self.delegate = delegate

            def resolve(self, query, view):
                seen.append(view)
                return self.delegate.resolve(query, view)

        executor.routing_policy = Recorder(policy_core)
        executor.next_hop = Recorder(next_hop_core)
        view = EvaluationView()
        executor.resolve(
            PacketProcessingEvaluationQuery(
                plan_id=plan_id,
                traffic_class="TRANSIT",
                routing_context_id=context_id,
                packet_state=PacketState(destination_ip="203.0.113.8"),
            ),
            view,
        )

    assert len(seen) == 2
    assert all(item is view for item in seen)


def test_branch_evidence_contains_only_traversed_transitions():
    context_id, table_id, binding_id, policy_id = routing_fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        repository.add_route(
            table_id,
            "203.0.113.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=binding_id)],
        )
        plan, _policy, route, terminals = add_routing_plan(repository, policy_id)
        all_transitions = {
            transition.transition_id: (transition.from_stage_id, transition.outcome)
            for transition in repository.get_packet_processing_plan(plan.id).transitions
        }
        plan_id = plan.id

    artifact = evaluate(plan_id, context_id).json()
    branch_refs = {
        ref["entity_id"]
        for ref in artifact["branches"][0]["evidence_refs"]
        if ref["entity_type"] == "ProcessingTransition"
    }
    expected = {
        str(transition_id)
        for transition_id, (source_id, outcome) in all_transitions.items()
        if outcome in {"TABLE_SELECTED", "FORWARD"}
    }

    assert branch_refs == expected
    assert str(terminals["UNKNOWN"].id) not in {
        execution["stage_id"]
        for execution in artifact["branches"][0]["stage_executions"]
    }
    assert stage_execution(artifact, "ROUTE_DECISION")["stage_id"] == str(route.id)


def test_query_ingress_context_reuses_existing_consistency_validation():
    context_id, _table_id, binding_id, _policy_id = routing_fixture()
    context_for_plan, plan_id, _ = direct_terminal_plan("UNKNOWN")
    with SessionLocal.begin() as session:
        other_interface = CanonicalRepository(session).add_network_interface()

    response = evaluate(
        plan_id,
        context_id,
        ingress_network_interface_id=str(other_interface.id),
        ingress_l3_binding_id=str(binding_id),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert context_for_plan != context_id


def test_execution_is_read_only_and_runtime_state_is_not_persisted():
    context_id, plan_id, _ = direct_terminal_plan("CONTINUE_TO_NEXT_HOP")
    with SessionLocal() as session:
        before = {
            model.__tablename__: session.scalar(select(func.count()).select_from(model))
            for model in (
                PacketProcessingPlan,
                ProcessingStage,
                ProcessingTransition,
                ProcessingEntryPoint,
            )
        }

    assert evaluate(plan_id, context_id).status_code == 200

    with SessionLocal() as session:
        after = {
            model.__tablename__: session.scalar(select(func.count()).select_from(model))
            for model in (
                PacketProcessingPlan,
                ProcessingStage,
                ProcessingTransition,
                ProcessingEntryPoint,
            )
        }
    source = inspect.getsource(packet_processing_executor).lower()
    assert before == after
    for forbidden in (
        "sessionlocal",
        "create_engine",
        "public.",
        "workspace_id",
        "local_mark",
        "l2resolver",
        "l1resolver",
        "securityresolver",
        "natresolver",
    ):
        assert forbidden not in source


def test_internal_flow_execution_state_is_frozen():
    state = FlowExecutionState(
        original_packet_state=PacketState(destination_ip="203.0.113.8"),
        current_packet_state=PacketState(destination_ip="203.0.113.8"),
        routing_context_id=uuid.uuid4(),
        traffic_class="TRANSIT",
        ingress_network_interface_id=None,
        ingress_l3_binding_id=None,
        selected_routing_table_id=None,
        current_route_resolution_branch=None,
        direct_egress=None,
        current_stage_id=uuid.uuid4(),
    )
    with pytest.raises(PydanticValidationError):
        PacketState(destination_ip="203.0.113.8").destination_ip = "192.0.2.1"
    with pytest.raises(FrozenInstanceError):
        state.traffic_class = "LOCAL_INPUT"
