import os
import uuid

import httpx
import pytest
from sqlalchemy import text

from app.database import SessionLocal
from app.errors import ModelError
from app.repository import CanonicalRepository, RouteNextHopInput
from app.schemas import EvaluationView, PacketState, SecurityEvaluationContext
from app.security_attachment_resolver import ConfiguredSecurityAttachmentResolver


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def evaluate(plan_id, context_id, *, packet=None, **context):
    return httpx.post(
        f"{BASE_URL}/v1/traces/packet-processing/evaluation",
        json={
            "plan_id": str(plan_id),
            "traffic_class": "TRANSIT",
            "routing_context_id": str(context_id),
            "packet_state": packet or {"destination_ip": "203.0.113.8"},
            **context,
        },
        timeout=5,
    )


def add_attachment(
    repository,
    action="PERMIT",
    *,
    scope=None,
    predicate=None,
    default_action="PERMIT",
    completeness="COMPLETE",
    stage_order=10,
):
    policy = repository.add_security_policy(default_action, completeness)
    rule = repository.add_security_rule(
        policy.id, 10, predicate or {"op": "TRUE"}, action
    )
    attachment = repository.add_security_policy_attachment(
        policy.id, stage_order, scope or {}
    )
    return policy, rule, attachment


def add_terminal(repository, plan_id, outcome):
    return repository.add_processing_stage(
        plan_id, "TERMINATE", {"outcome": outcome}
    )


def add_security_plan(repository, attachment_id, *, targets=None):
    targets = targets or {
        "PASS": "CONTINUE_TO_NEXT_HOP",
        "BLOCKED": "NOT_DELIVERED",
        "UNKNOWN": "UNKNOWN",
    }
    plan = repository.add_packet_processing_plan("COMPLETE")
    stage = repository.add_processing_stage(
        plan.id, "SECURITY", {"attachment_id": str(attachment_id)}
    )
    terminals = {
        outcome: add_terminal(repository, plan.id, terminal)
        for outcome, terminal in targets.items()
    }
    repository.add_processing_entry_point(plan.id, "TRANSIT", stage.id)
    for outcome, terminal in terminals.items():
        repository.add_processing_transition(
            plan.id, stage.id, outcome, terminal.id
        )
    return plan, stage, terminals


def security_execution(artifact, branch_index=0):
    return next(
        item
        for item in artifact["branches"][branch_index]["stage_executions"]
        if item["stage_kind"] == "SECURITY"
    )


def direct_exact_resolve(repository, attachment_id, context):
    return ConfiguredSecurityAttachmentResolver(repository).resolve(
        attachment_id, context, EvaluationView()
    )


def test_exact_attachment_getter_validates_only_requested_record():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _policy_a, _rule_a, attachment_a = add_attachment(repository)
        _policy_b, _rule_b, attachment_b = add_attachment(repository)
        missing = uuid.uuid4()
        session.execute(
            text(
                "UPDATE security_policy_attachments "
                "SET scope=jsonb_build_object('routing_context_ids', "
                "jsonb_build_array(CAST(:missing AS text))) WHERE id=:id"
            ),
            {"missing": missing, "id": attachment_b.id},
        )

        record = repository.get_security_policy_attachment(attachment_a.id)
        artifact = direct_exact_resolve(
            repository,
            attachment_a.id,
            SecurityEvaluationContext(packet_state=PacketState(), traffic_class="TRANSIT"),
        )

    assert record.attachment_id == attachment_a.id
    assert artifact.result == "PASS"
    assert attachment_b.id not in {
        ref.entity_id for ref in artifact.evidence_refs
    }


def test_requested_attachment_malformed_scope_is_model_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _policy, _rule, attachment = add_attachment(repository)
        session.execute(
            text(
                "UPDATE security_policy_attachments "
                "SET scope=jsonb_build_object('traffic_classes', 'TRANSIT') "
                "WHERE id=:id"
            ),
            {"id": attachment.id},
        )
        with pytest.raises(ModelError):
            repository.get_security_policy_attachment(attachment.id)


def test_requested_attachment_dangling_policy_is_model_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _policy, _rule, attachment = add_attachment(repository)
        session.execute(text("SET session_replication_role = replica"))
        session.execute(
            text(
                "UPDATE security_policy_attachments SET policy_id=:missing "
                "WHERE id=:id"
            ),
            {"missing": uuid.uuid4(), "id": attachment.id},
        )
        session.execute(text("SET session_replication_role = origin"))
        with pytest.raises(ModelError):
            repository.get_security_policy_attachment(attachment.id)


@pytest.mark.parametrize(
    ("scope", "action", "expected_applicability", "expected_result", "reason"),
    [
        ({"traffic_classes": ["LOCAL_INPUT"]}, "DROP", "FALSE", "PASS", "ATTACHMENT_NOT_APPLICABLE"),
        ({}, "PERMIT", "TRUE", "PASS", "POLICY_PERMIT"),
        ({}, "DROP", "TRUE", "BLOCKED", "POLICY_DROP"),
        ({}, "REJECT", "TRUE", "BLOCKED", "POLICY_REJECT"),
    ],
)
def test_exact_attachment_applicability_and_policy_mapping(
    scope, action, expected_applicability, expected_result, reason
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _policy, _rule, attachment = add_attachment(
            repository, action, scope=scope
        )
        artifact = direct_exact_resolve(
            repository,
            attachment.id,
            SecurityEvaluationContext(packet_state=PacketState(), traffic_class="TRANSIT"),
        )

    assert artifact.applicability == expected_applicability
    assert artifact.result == expected_result
    assert artifact.reason == reason
    assert (artifact.policy_evaluation is None) == (expected_applicability == "FALSE")


@pytest.mark.parametrize(
    ("action", "expected"),
    [("PERMIT", "PASS"), ("DROP", "UNKNOWN"), ("REJECT", "UNKNOWN")],
)
def test_unknown_applicability_collapses_conservatively(action, expected):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        context = repository.add_routing_context()
        binding = repository.add_l3_binding(interface.id, context.id)
        _policy, _rule, attachment = add_attachment(
            repository,
            action,
            scope={"egress_l3_binding_ids": [str(binding.id)]},
        )
        artifact = direct_exact_resolve(
            repository,
            attachment.id,
            SecurityEvaluationContext(
                packet_state=PacketState(), traffic_class="TRANSIT"
            ),
        )

    assert artifact.applicability == "UNKNOWN"
    assert artifact.result == expected
    assert "SECURITY_ATTACHMENT_APPLICABILITY_UNKNOWN" in {
        gap.code for gap in artifact.gaps
    }


def test_true_incomplete_policy_is_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _policy, _rule, attachment = add_attachment(
            repository, "PERMIT", completeness="PARTIAL"
        )
        artifact = direct_exact_resolve(
            repository,
            attachment.id,
            SecurityEvaluationContext(packet_state=PacketState(), traffic_class="TRANSIT"),
        )

    assert artifact.result == "UNKNOWN"
    assert artifact.policy_evaluation.result == "UNKNOWN"
    assert {gap.code for gap in artifact.gaps} == {
        "SECURITY_POLICY_EVALUATION_UNKNOWN"
    }


@pytest.mark.parametrize(
    ("connection_state", "expected_policy", "expected_stage"),
    [
        ("ESTABLISHED", "PERMIT", "PASS"),
        ("NEW", "DROP", "BLOCKED"),
        (None, "UNKNOWN", "UNKNOWN"),
    ],
)
def test_connection_state_reaches_exact_policy_context(
    connection_state, expected_policy, expected_stage
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        _policy, _rule, attachment = add_attachment(
            repository,
            "PERMIT",
            predicate={
                "op": "CONNECTION_STATE_IN",
                "values": ["ESTABLISHED"],
            },
            default_action="DROP",
        )
        plan, _stage, _terminals = add_security_plan(repository, attachment.id)
        context_id, plan_id = context.id, plan.id

    extra = {} if connection_state is None else {"connection_state": connection_state}
    artifact = evaluate(plan_id, context_id, **extra).json()
    security = security_execution(artifact)

    assert security["stage_outcome"] == expected_stage
    assert security["security_attachment_evaluation"]["policy_evaluation"]["result"] == expected_policy
    assert security["security_attachment_evaluation"]["context"]["connection_state"] == connection_state
    assert artifact["branches"][0]["final_state"]["connection_state"] == connection_state


@pytest.mark.parametrize(
    ("dimension", "runtime_field"),
    [
        ("routing_context_ids", "routing_context_id"),
        ("ingress_network_interface_ids", "ingress_network_interface_id"),
        ("ingress_l3_binding_ids", "ingress_l3_binding_id"),
    ],
)
def test_ingress_and_local_context_scope_dimensions(dimension, runtime_field):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        interface = repository.add_network_interface()
        binding = repository.add_l3_binding(interface.id, context.id)
        values = {
            "routing_context_id": context.id,
            "ingress_network_interface_id": interface.id,
            "ingress_l3_binding_id": binding.id,
        }
        _policy, _rule, attachment = add_attachment(
            repository,
            "PERMIT",
            scope={dimension: [str(values[runtime_field])]},
        )
        context_model = SecurityEvaluationContext(
            packet_state=PacketState(),
            traffic_class="TRANSIT",
            routing_context_id=context.id,
            ingress_network_interface_id=interface.id,
            ingress_l3_binding_id=binding.id,
        )
        artifact = direct_exact_resolve(
            repository, attachment.id, context_model
        )

    assert artifact.applicability == "TRUE"
    assert artifact.result == "PASS"


def test_exact_plan_attachment_ignores_other_drop_and_stage_order():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        _policy_a, _rule_a, attachment_a = add_attachment(
            repository, "PERMIT", stage_order=100
        )
        _policy_b, _rule_b, attachment_b = add_attachment(
            repository, "DROP", stage_order=1
        )
        plan, _stage, _terminals = add_security_plan(repository, attachment_a.id)
        context_id, plan_id = context.id, plan.id

    artifact = evaluate(plan_id, context_id).json()
    security = security_execution(artifact)
    refs = {
        (item["entity_type"], item["entity_id"])
        for item in security["evidence_refs"]
    }

    assert artifact["result"] == "CONTINUE_TO_NEXT_HOP"
    assert security["stage_outcome"] == "PASS"
    assert ("SecurityPolicyAttachment", str(attachment_a.id)) in refs
    assert ("SecurityPolicyAttachment", str(attachment_b.id)) not in refs


@pytest.mark.parametrize(
    ("action", "stage_outcome", "terminal_outcome"),
    [
        ("PERMIT", "PASS", "NETWORK_DELIVERY"),
        ("DROP", "BLOCKED", "CONTINUE_TO_NEXT_HOP"),
        ("REJECT", "BLOCKED", "CONTINUE_TO_NEXT_HOP"),
    ],
)
def test_security_follows_explicit_graph_transition(
    action, stage_outcome, terminal_outcome
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        _policy, _rule, attachment = add_attachment(repository, action)
        plan, stage, terminals = add_security_plan(
            repository,
            attachment.id,
            targets={
                "PASS": "NETWORK_DELIVERY",
                "BLOCKED": "CONTINUE_TO_NEXT_HOP",
                "UNKNOWN": "UNKNOWN",
            },
        )
        context_id, plan_id = context.id, plan.id

    artifact = evaluate(plan_id, context_id).json()
    security = security_execution(artifact)

    assert security["stage_outcome"] == stage_outcome
    assert security["transition_id"] is not None
    assert security["next_stage_id"] == str(terminals[stage_outcome].id)
    assert artifact["result"] == terminal_outcome
    transition_refs = {
        item["entity_id"]
        for item in artifact["branches"][0]["evidence_refs"]
        if item["entity_type"] == "ProcessingTransition"
    }
    assert security["transition_id"] in transition_refs
    assert len(transition_refs) == 1


def add_routing_security_plan(repository, routing_policy_id, attachment_id):
    plan = repository.add_packet_processing_plan("COMPLETE")
    routing_policy = repository.add_processing_stage(
        plan.id, "ROUTING_POLICY", {"policy_id": str(routing_policy_id)}
    )
    route = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
    security = repository.add_processing_stage(
        plan.id, "SECURITY", {"attachment_id": str(attachment_id)}
    )
    forward = add_terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
    negative = add_terminal(repository, plan.id, "NOT_DELIVERED")
    unknown = add_terminal(repository, plan.id, "UNKNOWN")
    repository.add_processing_entry_point(plan.id, "TRANSIT", routing_policy.id)
    repository.add_processing_transition(
        plan.id, routing_policy.id, "TABLE_SELECTED", route.id
    )
    repository.add_processing_transition(
        plan.id, routing_policy.id, "TABLE_SELECTION_UNKNOWN", unknown.id
    )
    for outcome in ("FORWARD", "LOCAL"):
        repository.add_processing_transition(plan.id, route.id, outcome, security.id)
    for outcome in ("DISCARD", "NO_ROUTE"):
        repository.add_processing_transition(plan.id, route.id, outcome, negative.id)
    for outcome in ("UNKNOWN", "CONFLICTING"):
        repository.add_processing_transition(plan.id, route.id, outcome, unknown.id)
    repository.add_processing_transition(plan.id, security.id, "PASS", forward.id)
    repository.add_processing_transition(plan.id, security.id, "BLOCKED", negative.id)
    repository.add_processing_transition(plan.id, security.id, "UNKNOWN", unknown.id)
    return plan, security, {"forward": forward, "negative": negative, "unknown": unknown}


@pytest.mark.parametrize("scope_dimension", ["egress_l3_binding_ids", "egress_network_interface_ids"])
def test_security_after_route_receives_exact_egress_context(scope_dimension):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        interface = repository.add_network_interface()
        binding = repository.add_l3_binding(interface.id, context.id)
        routing_policy = repository.add_routing_policy(
            {"op": "SELECT_TABLE", "routing_table_id": str(table.id)}, "COMPLETE"
        )
        repository.add_route(
            table.id,
            "203.0.113.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=binding.id)],
        )
        expected = binding.id if scope_dimension == "egress_l3_binding_ids" else interface.id
        _policy, _rule, attachment = add_attachment(
            repository, "PERMIT", scope={scope_dimension: [str(expected)]}
        )
        plan, _security, _terminals = add_routing_security_plan(
            repository, routing_policy.id, attachment.id
        )
        context_id, plan_id = context.id, plan.id

    artifact = evaluate(plan_id, context_id).json()
    security = security_execution(artifact)
    nested_context = security["security_attachment_evaluation"]["context"]

    assert security["stage_outcome"] == "PASS"
    assert nested_context["egress_l3_binding_id"] == str(binding.id)
    assert nested_context["egress_network_interface_id"] == str(interface.id)
    assert security["direct_egress"]["egress_l3_binding_id"] == str(binding.id)
    assert artifact["branches"][0]["final_state"]["direct_egress"]["egress_l3_binding_id"] == str(binding.id)


@pytest.mark.parametrize(("action", "expected"), [("PERMIT", "PASS"), ("DROP", "UNKNOWN")])
def test_egress_scope_before_route_uses_unknown_applicability(action, expected):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        interface = repository.add_network_interface()
        binding = repository.add_l3_binding(interface.id, context.id)
        _policy, _rule, attachment = add_attachment(
            repository,
            action,
            scope={"egress_l3_binding_ids": [str(binding.id)]},
        )
        plan, _stage, _terminals = add_security_plan(repository, attachment.id)
        context_id, plan_id = context.id, plan.id

    artifact = evaluate(plan_id, context_id).json()
    security = security_execution(artifact)

    assert security["security_attachment_evaluation"]["applicability"] == "UNKNOWN"
    assert security["stage_outcome"] == expected
    assert security["security_attachment_evaluation"]["context"]["egress_l3_binding_id"] is None


def test_security_before_route_block_prevents_later_route_execution():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        routing_policy = repository.add_routing_policy(
            {"op": "SELECT_TABLE", "routing_table_id": str(table.id)}, "COMPLETE"
        )
        _policy, _rule, attachment = add_attachment(repository, "DROP")
        plan = repository.add_packet_processing_plan("COMPLETE")
        security = repository.add_processing_stage(
            plan.id, "SECURITY", {"attachment_id": str(attachment.id)}
        )
        route_policy = repository.add_processing_stage(
            plan.id, "ROUTING_POLICY", {"policy_id": str(routing_policy.id)}
        )
        route = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        blocked = add_terminal(repository, plan.id, "NOT_DELIVERED")
        unknown = add_terminal(repository, plan.id, "UNKNOWN")
        forwarded = add_terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
        repository.add_processing_entry_point(plan.id, "TRANSIT", security.id)
        repository.add_processing_transition(plan.id, security.id, "PASS", route_policy.id)
        repository.add_processing_transition(plan.id, security.id, "BLOCKED", blocked.id)
        repository.add_processing_transition(plan.id, security.id, "UNKNOWN", unknown.id)
        repository.add_processing_transition(plan.id, route_policy.id, "TABLE_SELECTED", route.id)
        repository.add_processing_transition(plan.id, route_policy.id, "TABLE_SELECTION_UNKNOWN", unknown.id)
        for outcome in ("FORWARD", "LOCAL", "DISCARD", "NO_ROUTE"):
            repository.add_processing_transition(plan.id, route.id, outcome, forwarded.id)
        for outcome in ("UNKNOWN", "CONFLICTING"):
            repository.add_processing_transition(plan.id, route.id, outcome, unknown.id)
        context_id, plan_id = context.id, plan.id

    artifact = evaluate(plan_id, context_id).json()
    kinds = [item["stage_kind"] for item in artifact["branches"][0]["stage_executions"]]

    assert artifact["result"] == "NOT_DELIVERED"
    assert kinds == ["SECURITY", "TERMINATE"]


def test_local_route_changes_traffic_class_before_security():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        routing_policy = repository.add_routing_policy(
            {"op": "SELECT_TABLE", "routing_table_id": str(table.id)}, "COMPLETE"
        )
        repository.add_route(table.id, "203.0.113.0/24", "LOCAL")
        _policy, _rule, attachment = add_attachment(
            repository, "PERMIT", scope={"traffic_classes": ["LOCAL_INPUT"]}
        )
        plan, _security, _terminals = add_routing_security_plan(
            repository, routing_policy.id, attachment.id
        )
        context_id, plan_id = context.id, plan.id

    artifact = evaluate(plan_id, context_id).json()
    security = security_execution(artifact)

    assert security["traffic_class_before"] == "LOCAL_INPUT"
    assert security["security_attachment_evaluation"]["applicability"] == "TRUE"


def test_ecmp_branches_evaluate_security_with_branch_local_egress():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        interfaces = [repository.add_network_interface() for _ in range(2)]
        bindings = [
            repository.add_l3_binding(interface.id, context.id)
            for interface in interfaces
        ]
        routing_policy = repository.add_routing_policy(
            {"op": "SELECT_TABLE", "routing_table_id": str(table.id)}, "COMPLETE"
        )
        repository.add_route(
            table.id,
            "203.0.113.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=item.id) for item in bindings],
        )
        _policy, _rule, attachment = add_attachment(
            repository,
            "DROP",
            scope={"egress_l3_binding_ids": [str(bindings[0].id)]},
        )
        plan, _security, _terminals = add_routing_security_plan(
            repository, routing_policy.id, attachment.id
        )
        context_id, plan_id = context.id, plan.id
        binding_ids = {str(item.id) for item in bindings}

    artifact = evaluate(plan_id, context_id).json()
    security_results = {
        (
            security_execution({"branches": [branch]})[
                "security_attachment_evaluation"
            ]["context"]["egress_l3_binding_id"],
            security_execution({"branches": [branch]})["stage_outcome"],
        )
        for branch in artifact["branches"]
    }

    assert len(artifact["branches"]) == 2
    assert {binding for binding, _outcome in security_results} == binding_ids
    assert {outcome for _binding, outcome in security_results} == {"PASS", "BLOCKED"}
    assert artifact["result"] == "UNKNOWN"


def test_nat_identity_stage_is_compatible_with_security_executor_regression():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        policy = repository.add_nat_policy({"op": "IDENTITY"}, "COMPLETE")
        attachment = repository.add_nat_policy_attachment(policy.id, 10, {})
        plan = repository.add_packet_processing_plan("COMPLETE")
        stage = repository.add_processing_stage(
            plan.id, "NAT", {"attachment_id": str(attachment.id)}
        )
        terminal = add_terminal(repository, plan.id, "UNKNOWN")
        repository.add_processing_entry_point(plan.id, "TRANSIT", stage.id)
        for outcome in ("IDENTITY", "TRANSFORMED_EXACT", "TRANSFORMED_CONSTRAINED", "UNKNOWN"):
            repository.add_processing_transition(plan.id, stage.id, outcome, terminal.id)
        context_id, plan_id = context.id, plan.id

    response = evaluate(plan_id, context_id)

    assert response.status_code == 200
    nat = next(
        item
        for item in response.json()["branches"][0]["stage_executions"]
        if item["stage_kind"] == "NAT"
    )
    assert nat["stage_outcome"] == "IDENTITY"
