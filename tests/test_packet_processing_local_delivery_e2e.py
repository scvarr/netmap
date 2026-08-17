import inspect
import os

import httpx
import pytest

from app import packet_processing_executor
from app.database import SessionLocal
from app.repository import CanonicalRepository
from tests.test_packet_processing_adjacency_e2e import build_handoff_fixture


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def evaluate(plan_id, context_id, traffic_class="LOCAL_INPUT", packet=None, **runtime):
    return httpx.post(
        f"{BASE_URL}/v1/traces/packet-processing/evaluation",
        json={
            "plan_id": str(plan_id),
            "traffic_class": traffic_class,
            "routing_context_id": str(context_id),
            "packet_state": packet or {"destination_ip": "203.0.113.9"},
            **{key: str(value) for key, value in runtime.items()},
        },
        timeout=10,
    )


def add_terminal(repository, plan_id, outcome):
    return repository.add_processing_stage(
        plan_id, "TERMINATE", {"outcome": outcome}
    )


def add_local_delivery_plan(repository, traffic_classes=("LOCAL_INPUT",)):
    plan = repository.add_packet_processing_plan("COMPLETE")
    local = repository.add_processing_stage(plan.id, "LOCAL_DELIVERY", {})
    delivered = add_terminal(repository, plan.id, "NETWORK_DELIVERY")
    unknown = add_terminal(repository, plan.id, "UNKNOWN")
    for traffic_class in traffic_classes:
        repository.add_processing_entry_point(plan.id, traffic_class, local.id)
    repository.add_processing_transition(
        plan.id, local.id, "DELIVERED", delivered.id
    )
    repository.add_processing_transition(plan.id, local.id, "UNKNOWN", unknown.id)
    return plan, local


def stage_execution(artifact, kind):
    return next(
        execution
        for execution in artifact["branches"][0]["stage_executions"]
        if execution["stage_kind"] == kind
    )


def test_local_input_exact_packet_is_delivered_without_state_mutation():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        interface = repository.add_network_interface()
        binding = repository.add_l3_binding(interface.id, context.id)
        plan, _local = add_local_delivery_plan(repository)
        ids = plan.id, context.id, interface.id, binding.id

    artifact = evaluate(
        ids[0],
        ids[1],
        ingress_network_interface_id=ids[2],
        ingress_l3_binding_id=ids[3],
    ).json()
    execution = stage_execution(artifact, "LOCAL_DELIVERY")
    before = artifact["branches"][0]["initial_state"]
    after = artifact["branches"][0]["final_state"]

    assert artifact["result"] == "NETWORK_DELIVERY"
    assert execution["stage_outcome"] == "DELIVERED"
    assert execution["local_delivery"] == {
        "result": "DELIVERED",
        "routing_context_id": str(ids[1]),
        "traffic_class": "LOCAL_INPUT",
        "ingress_network_interface_id": str(ids[2]),
        "ingress_l3_binding_id": str(ids[3]),
        "reason": "LOCAL_INPUT_CONTEXT",
    }
    for field in (
        "current_packet_state",
        "current_packet_constraint",
        "current_packet_unknown",
        "routing_context_id",
        "traffic_class",
        "ingress_network_interface_id",
        "ingress_l3_binding_id",
        "connection_state",
        "selected_routing_table_id",
        "current_route_resolution_branch",
        "direct_egress",
    ):
        assert after[field] == before[field]


@pytest.mark.parametrize("traffic_class", ["TRANSIT", "LOCAL_OUTPUT"])
def test_wrong_traffic_class_follows_unknown_with_precondition_gap(traffic_class):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        plan, _local = add_local_delivery_plan(
            repository, ("TRANSIT", "LOCAL_OUTPUT")
        )
        plan_id, context_id = plan.id, context.id

    artifact = evaluate(plan_id, context_id, traffic_class).json()
    execution = stage_execution(artifact, "LOCAL_DELIVERY")

    assert artifact["result"] == "UNKNOWN"
    assert execution["stage_outcome"] == "UNKNOWN"
    assert execution["local_delivery"]["reason"] == "STAGE_PRECONDITION_UNKNOWN"
    assert {gap["code"] for gap in execution["gaps"]} == {
        "STAGE_PRECONDITION_UNKNOWN"
    }


def add_nat_local_plan(repository, transform, *, scope=None):
    policy = repository.add_nat_policy({"op": "IDENTITY"}, "COMPLETE")
    repository.add_nat_rule(policy.id, 10, {"op": "TRUE"}, transform)
    attachment = repository.add_nat_policy_attachment(
        policy.id, 10, scope or {}
    )
    plan = repository.add_packet_processing_plan("COMPLETE")
    nat = repository.add_processing_stage(
        plan.id, "NAT", {"attachment_id": str(attachment.id)}
    )
    local = repository.add_processing_stage(plan.id, "LOCAL_DELIVERY", {})
    delivered = add_terminal(repository, plan.id, "NETWORK_DELIVERY")
    unknown = add_terminal(repository, plan.id, "UNKNOWN")
    repository.add_processing_entry_point(plan.id, "LOCAL_INPUT", nat.id)
    for outcome in (
        "IDENTITY",
        "TRANSFORMED_EXACT",
        "TRANSFORMED_CONSTRAINED",
        "UNKNOWN",
    ):
        repository.add_processing_transition(plan.id, nat.id, outcome, local.id)
    repository.add_processing_transition(
        plan.id, local.id, "DELIVERED", delivered.id
    )
    repository.add_processing_transition(plan.id, local.id, "UNKNOWN", unknown.id)
    return plan


@pytest.mark.parametrize(
    ("packet_kind", "expected_nat"),
    [
        ("EXACT", "TRANSFORMED_EXACT"),
        ("CONSTRAINED", "TRANSFORMED_CONSTRAINED"),
        ("UNKNOWN", "UNKNOWN"),
    ],
)
def test_local_delivery_accepts_exact_constrained_and_unknown_packet_values(
    packet_kind, expected_nat
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        if packet_kind == "EXACT":
            transform = {
                "op": "TRANSFORM",
                "destination_ip": {
                    "op": "REPLACE_EXACT",
                    "value": "198.51.100.9",
                },
            }
            scope = {}
        elif packet_kind == "CONSTRAINED":
            pool = repository.add_nat_pool(
                address_ranges=[
                    {"start": "198.51.100.10", "end": "198.51.100.20"}
                ]
            )
            transform = {
                "op": "TRANSFORM",
                "destination_ip": {
                    "op": "SELECT_FROM",
                    "pool_id": str(pool.id),
                },
            }
            scope = {}
        else:
            interface = repository.add_network_interface()
            binding = repository.add_l3_binding(interface.id, context.id)
            transform = {
                "op": "TRANSFORM",
                "destination_ip": {
                    "op": "REPLACE_EXACT",
                    "value": "198.51.100.9",
                },
            }
            scope = {"egress_l3_binding_ids": [str(binding.id)]}
        plan = add_nat_local_plan(repository, transform, scope=scope)
        plan_id, context_id = plan.id, context.id

    artifact = evaluate(plan_id, context_id).json()
    nat = stage_execution(artifact, "NAT")
    local = stage_execution(artifact, "LOCAL_DELIVERY")

    assert nat["stage_outcome"] == expected_nat
    assert local["stage_outcome"] == "DELIVERED"
    assert artifact["result"] == "NETWORK_DELIVERY"
    assert local["packet_before"] == local["packet_after"]
    assert local["packet_before_constraint"] == local["packet_after_constraint"]
    assert local["packet_before_unknown"] == local["packet_after_unknown"]
    assert not {
        "PACKET_CONSTRAINT_UNSUPPORTED",
        "PACKET_STATE_UNKNOWN",
    } & {gap["code"] for gap in local["gaps"]}


def test_local_delivery_does_not_call_network_or_policy_resolvers():
    source = inspect.getsource(
        packet_processing_executor.PacketProcessingPlanExecutor._execute_local_delivery
    )
    for forbidden in (
        "routing_policy.resolve",
        "next_hop.resolve",
        "security_attachment.resolve",
        "nat_attachment.resolve",
        "structural_adjacency.resolve",
        "get_interface_addresses",
    ):
        assert forbidden not in source


def test_route_local_changes_class_then_local_delivery_confirms_network_delivery():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        repository.add_route(table.id, "203.0.113.0/24", "LOCAL")
        policy = repository.add_routing_policy(
            {"op": "SELECT_TABLE", "routing_table_id": str(table.id)},
            "COMPLETE",
        )
        plan = repository.add_packet_processing_plan("COMPLETE")
        policy_stage = repository.add_processing_stage(
            plan.id, "ROUTING_POLICY", {"policy_id": str(policy.id)}
        )
        route = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        local = repository.add_processing_stage(plan.id, "LOCAL_DELIVERY", {})
        delivered = add_terminal(repository, plan.id, "NETWORK_DELIVERY")
        negative = add_terminal(repository, plan.id, "NOT_DELIVERED")
        unknown = add_terminal(repository, plan.id, "UNKNOWN")
        forward = add_terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
        repository.add_processing_entry_point(plan.id, "TRANSIT", policy_stage.id)
        repository.add_processing_transition(
            plan.id, policy_stage.id, "TABLE_SELECTED", route.id
        )
        repository.add_processing_transition(
            plan.id, policy_stage.id, "TABLE_SELECTION_UNKNOWN", unknown.id
        )
        for outcome, target in (
            ("FORWARD", forward),
            ("LOCAL", local),
            ("DISCARD", negative),
            ("NO_ROUTE", negative),
            ("UNKNOWN", unknown),
            ("CONFLICTING", unknown),
        ):
            repository.add_processing_transition(plan.id, route.id, outcome, target.id)
        repository.add_processing_transition(
            plan.id, local.id, "DELIVERED", delivered.id
        )
        repository.add_processing_transition(plan.id, local.id, "UNKNOWN", unknown.id)
        plan_id, context_id = plan.id, context.id

    artifact = evaluate(plan_id, context_id, "TRANSIT").json()
    route_execution = stage_execution(artifact, "ROUTE_DECISION")
    local_execution = stage_execution(artifact, "LOCAL_DELIVERY")

    assert artifact["result"] == "NETWORK_DELIVERY"
    assert route_execution["stage_outcome"] == "LOCAL"
    assert route_execution["traffic_class_after"] == "LOCAL_INPUT"
    assert local_execution["stage_outcome"] == "DELIVERED"
    assert not any(
        item["stage_kind"] == "ADJACENCY_L2"
        for item in artifact["branches"][0]["stage_executions"]
    )
    assert {ref["entity_type"] for ref in artifact["evidence_refs"]} >= {
        "Route",
        "RoutingTable",
        "ProcessingStage",
        "ProcessingTransition",
    }


@pytest.mark.parametrize(
    ("security_action", "expected_result", "local_executed"),
    [("PERMIT", "NETWORK_DELIVERY", True), ("DROP", "NOT_DELIVERED", False)],
)
def test_local_input_security_controls_access_to_local_delivery(
    security_action, expected_result, local_executed
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        policy = repository.add_security_policy(security_action, "COMPLETE")
        attachment = repository.add_security_policy_attachment(policy.id, 10, {})
        plan = repository.add_packet_processing_plan("COMPLETE")
        security = repository.add_processing_stage(
            plan.id, "SECURITY", {"attachment_id": str(attachment.id)}
        )
        local = repository.add_processing_stage(plan.id, "LOCAL_DELIVERY", {})
        delivered = add_terminal(repository, plan.id, "NETWORK_DELIVERY")
        negative = add_terminal(repository, plan.id, "NOT_DELIVERED")
        unknown = add_terminal(repository, plan.id, "UNKNOWN")
        repository.add_processing_entry_point(plan.id, "LOCAL_INPUT", security.id)
        repository.add_processing_transition(plan.id, security.id, "PASS", local.id)
        repository.add_processing_transition(
            plan.id, security.id, "BLOCKED", negative.id
        )
        repository.add_processing_transition(
            plan.id, security.id, "UNKNOWN", unknown.id
        )
        repository.add_processing_transition(
            plan.id, local.id, "DELIVERED", delivered.id
        )
        repository.add_processing_transition(plan.id, local.id, "UNKNOWN", unknown.id)
        plan_id, context_id = plan.id, context.id

    artifact = evaluate(plan_id, context_id).json()
    kinds = [item["stage_kind"] for item in artifact["branches"][0]["stage_executions"]]

    assert artifact["result"] == expected_result
    assert ("LOCAL_DELIVERY" in kinds) is local_executed


def test_handoff_selection_and_local_execution_remain_three_explicit_operations():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        fixture = build_handoff_fixture(repository)
        local_plan, _local = add_local_delivery_plan(repository)
        attachment_set = repository.add_packet_processing_plan_attachment_set(
            fixture["receiving_context"].id, "LOCAL_INPUT", "COMPLETE"
        )
        repository.add_packet_processing_plan_attachment(
            attachment_set.id,
            local_plan.id,
            {
                "ingress_l3_binding_ids": [str(fixture["target_binding"].id)]
            },
        )
        source_plan_id = fixture["plan"].id
        source_context_id = fixture["source_context"].id

    first = evaluate(source_plan_id, source_context_id, "TRANSIT").json()
    handoff_state = first["branches"][0]["final_state"]
    assert first["result"] == "CONTINUE_TO_NEXT_HOP"
    assert handoff_state["traffic_class"] == "LOCAL_INPUT"
    assert "LOCAL_DELIVERY" not in {
        item["stage_kind"] for item in first["branches"][0]["stage_executions"]
    }

    selection = httpx.post(
        f"{BASE_URL}/v1/traces/packet-processing/plan-selection",
        json={
            "routing_context_id": handoff_state["routing_context_id"],
            "traffic_class": handoff_state["traffic_class"],
            "ingress_network_interface_id": handoff_state[
                "ingress_network_interface_id"
            ],
            "ingress_l3_binding_id": handoff_state["ingress_l3_binding_id"],
        },
        timeout=10,
    ).json()
    assert selection["result"] == "PLAN_SELECTED"
    assert selection["selected_plan_id"] == str(local_plan.id)

    second = evaluate(
        selection["selected_plan_id"],
        handoff_state["routing_context_id"],
        handoff_state["traffic_class"],
        packet=handoff_state["current_packet_state"],
        ingress_network_interface_id=handoff_state[
            "ingress_network_interface_id"
        ],
        ingress_l3_binding_id=handoff_state["ingress_l3_binding_id"],
    ).json()
    assert second["result"] == "NETWORK_DELIVERY"
    assert stage_execution(second, "LOCAL_DELIVERY")["stage_outcome"] == "DELIVERED"
