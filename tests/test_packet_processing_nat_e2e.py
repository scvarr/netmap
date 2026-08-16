import os
import uuid

import httpx
import pytest
from sqlalchemy import text

from app.database import SessionLocal
from app.errors import ModelError
from app.forwarding_adjacency import derive_adjacency_target
from app.nat_attachment_resolver import ConfiguredNATAttachmentResolver
from app.repository import CanonicalRepository, RouteNextHopInput
from app.schemas import (
    DirectEgressState,
    EvaluationView,
    NATEvaluationContext,
    PacketState,
)


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def evaluate(plan_id, context_id, *, packet=None, **runtime):
    return httpx.post(
        f"{BASE_URL}/v1/traces/packet-processing/evaluation",
        json={
            "plan_id": str(plan_id),
            "traffic_class": "TRANSIT",
            "routing_context_id": str(context_id),
            "packet_state": packet or {"destination_ip": "203.0.113.8"},
            **runtime,
        },
        timeout=5,
    )


def add_terminal(repository, plan_id, outcome="UNKNOWN"):
    return repository.add_processing_stage(
        plan_id, "TERMINATE", {"outcome": outcome}
    )


def add_nat_attachment(
    repository,
    transform,
    *,
    scope=None,
    predicate=None,
    completeness="COMPLETE",
    stage_order=10,
):
    policy = repository.add_nat_policy({"op": "IDENTITY"}, completeness)
    rule = repository.add_nat_rule(
        policy.id, 10, predicate or {"op": "TRUE"}, transform
    )
    attachment = repository.add_nat_policy_attachment(
        policy.id, stage_order, scope or {}
    )
    return policy, rule, attachment


def exact_context(packet=None, **runtime):
    return NATEvaluationContext(
        packet_state=packet or PacketState(destination_ip="203.0.113.8"),
        traffic_class="TRANSIT",
        **runtime,
    )


def resolve_exact(repository, attachment_id, context=None):
    return ConfiguredNATAttachmentResolver(repository).resolve(
        attachment_id, context or exact_context(), EvaluationView()
    )


def add_nat_plan(repository, attachment_id, *, outcomes=None):
    outcomes = outcomes or {
        "IDENTITY": "CONTINUE_TO_NEXT_HOP",
        "TRANSFORMED_EXACT": "CONTINUE_TO_NEXT_HOP",
        "TRANSFORMED_CONSTRAINED": "UNKNOWN",
        "UNKNOWN": "UNKNOWN",
    }
    plan = repository.add_packet_processing_plan("COMPLETE")
    nat = repository.add_processing_stage(
        plan.id, "NAT", {"attachment_id": str(attachment_id)}
    )
    terminals = {
        outcome: add_terminal(repository, plan.id, terminal)
        for outcome, terminal in outcomes.items()
    }
    repository.add_processing_entry_point(plan.id, "TRANSIT", nat.id)
    for outcome, terminal in terminals.items():
        repository.add_processing_transition(plan.id, nat.id, outcome, terminal.id)
    return plan, nat, terminals


def execution(artifact, kind, index=0, occurrence=0):
    matches = [
        item
        for item in artifact["branches"][index]["stage_executions"]
        if item["stage_kind"] == kind
    ]
    return matches[occurrence]


def replace_destination(value):
    return {
        "op": "TRANSFORM",
        "destination_ip": {"op": "REPLACE_EXACT", "value": value},
    }


def test_singular_nat_attachment_ignores_unrelated_corruption():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _pa, _ra, attachment_a = add_nat_attachment(
            repository, {"op": "IDENTITY"}, stage_order=100
        )
        _pb, _rb, attachment_b = add_nat_attachment(
            repository, replace_destination("198.51.100.8"), stage_order=1
        )
        session.execute(
            text(
                "UPDATE nat_policy_attachments SET scope=jsonb_build_object("
                "'routing_context_ids', jsonb_build_array(CAST(:missing AS text))) "
                "WHERE id=:id"
            ),
            {"missing": uuid.uuid4(), "id": attachment_b.id},
        )

        record = repository.get_nat_policy_attachment(attachment_a.id)
        artifact = resolve_exact(repository, attachment_a.id)

    assert record.attachment_id == attachment_a.id
    assert artifact.result == "IDENTITY"
    assert attachment_b.id not in {ref.entity_id for ref in artifact.evidence_refs}


def test_plan_nat_stage_never_discovers_or_evidences_neighboring_attachment():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        _pa, _ra, attachment_a = add_nat_attachment(
            repository, {"op": "IDENTITY"}, stage_order=100
        )
        _pb, _rb, attachment_b = add_nat_attachment(
            repository, replace_destination("198.51.100.8"), stage_order=1
        )
        plan, _nat, _terminals = add_nat_plan(repository, attachment_a.id)
        plan_id, context_id = plan.id, context.id

    artifact = evaluate(plan_id, context_id).json()
    refs = {
        (ref["entity_type"], ref["entity_id"])
        for ref in execution(artifact, "NAT")["evidence_refs"]
    }

    assert artifact["result"] == "CONTINUE_TO_NEXT_HOP"
    assert ("NATPolicyAttachment", str(attachment_a.id)) in refs
    assert ("NATPolicyAttachment", str(attachment_b.id)) not in refs


def test_requested_nat_attachment_malformed_scope_is_model_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _policy, _rule, attachment = add_nat_attachment(
            repository, {"op": "IDENTITY"}
        )
        session.execute(
            text(
                "UPDATE nat_policy_attachments SET scope=jsonb_build_object("
                "'traffic_classes', 'TRANSIT') WHERE id=:id"
            ),
            {"id": attachment.id},
        )
        with pytest.raises(ModelError):
            repository.get_nat_policy_attachment(attachment.id)


def test_requested_nat_attachment_dangling_policy_is_model_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _policy, _rule, attachment = add_nat_attachment(
            repository, {"op": "IDENTITY"}
        )
        session.execute(text("SET session_replication_role = replica"))
        session.execute(
            text("UPDATE nat_policy_attachments SET policy_id=:missing WHERE id=:id"),
            {"missing": uuid.uuid4(), "id": attachment.id},
        )
        session.execute(text("SET session_replication_role = origin"))
        with pytest.raises(ModelError):
            repository.get_nat_policy_attachment(attachment.id)


@pytest.mark.parametrize(
    ("scope", "transform", "expected_applicability", "expected_result"),
    [
        ({"traffic_classes": ["LOCAL_INPUT"]}, replace_destination("198.51.100.8"), "FALSE", "IDENTITY"),
        ({}, {"op": "IDENTITY"}, "TRUE", "IDENTITY"),
        ({}, replace_destination("198.51.100.8"), "TRUE", "TRANSFORMED_EXACT"),
    ],
)
def test_exact_attachment_scope_and_deterministic_mapping(
    scope, transform, expected_applicability, expected_result
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _policy, _rule, attachment = add_nat_attachment(
            repository, transform, scope=scope
        )
        artifact = resolve_exact(repository, attachment.id)

    assert artifact.applicability == expected_applicability
    assert artifact.result == expected_result
    assert (artifact.policy_evaluation is None) == (expected_applicability == "FALSE")
    if expected_result == "IDENTITY":
        assert artifact.packet_after == artifact.packet_before


def test_exact_attachment_constrained_output_has_no_representative_packet():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        pool = repository.add_nat_pool(
            address_ranges=[
                {"start": "198.51.100.10", "end": "198.51.100.20"}
            ]
        )
        _policy, _rule, attachment = add_nat_attachment(
            repository,
            {
                "op": "TRANSFORM",
                "source_ip": {"op": "SELECT_FROM", "pool_id": str(pool.id)},
            },
        )
        artifact = resolve_exact(repository, attachment.id)

    assert artifact.result == "TRANSFORMED_CONSTRAINED"
    assert artifact.packet_after is None
    assert artifact.packet_after_constraint is not None
    assert artifact.packet_after_constraint.source_ip_ranges[0].start.exploded == "198.51.100.10"
    assert {ref.entity_type for ref in artifact.evidence_refs} >= {
        "NATPolicyAttachment", "NATPolicy", "NATRule", "NATPool"
    }


def test_true_incomplete_nat_policy_is_unknown_without_output():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _policy, _rule, attachment = add_nat_attachment(
            repository, replace_destination("198.51.100.8"), completeness="PARTIAL"
        )
        artifact = resolve_exact(repository, attachment.id)

    assert artifact.result == "UNKNOWN"
    assert artifact.packet_after is None
    assert artifact.packet_after_constraint is None


@pytest.mark.parametrize(
    ("transform", "expected"),
    [
        ({"op": "IDENTITY"}, "IDENTITY"),
        (replace_destination("203.0.113.8"), "IDENTITY"),
        (replace_destination("198.51.100.8"), "UNKNOWN"),
    ],
)
def test_unknown_applicability_collapses_by_possible_packet_outputs(transform, expected):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        context = repository.add_routing_context()
        binding = repository.add_l3_binding(interface.id, context.id)
        _policy, _rule, attachment = add_nat_attachment(
            repository,
            transform,
            scope={"egress_l3_binding_ids": [str(binding.id)]},
        )
        artifact = resolve_exact(repository, attachment.id)

    assert artifact.applicability == "UNKNOWN"
    assert artifact.result == expected
    if expected == "UNKNOWN":
        assert artifact.packet_after is None
        assert artifact.packet_after_constraint is None


def test_unknown_applicability_constrained_is_unknown_not_apply_only_constraint():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        context = repository.add_routing_context()
        binding = repository.add_l3_binding(interface.id, context.id)
        pool = repository.add_nat_pool(
            port_ranges=[{"start": 40000, "end": 50000}]
        )
        _policy, _rule, attachment = add_nat_attachment(
            repository,
            {
                "op": "TRANSFORM",
                "source_port": {"op": "SELECT_FROM", "pool_id": str(pool.id)},
            },
            scope={"egress_l3_binding_ids": [str(binding.id)]},
        )
        artifact = resolve_exact(repository, attachment.id)

    assert artifact.result == "UNKNOWN"
    assert artifact.packet_after is None
    assert artifact.packet_after_constraint is None


@pytest.mark.parametrize(
    ("connection_state", "expected"),
    [("ESTABLISHED", "TRANSFORMED_EXACT"), ("NEW", "IDENTITY"), (None, "UNKNOWN")],
)
def test_nat_attachment_receives_connection_state(connection_state, expected):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _policy, _rule, attachment = add_nat_attachment(
            repository,
            replace_destination("198.51.100.8"),
            predicate={"op": "CONNECTION_STATE_IN", "values": ["ESTABLISHED"]},
        )
        plan, _nat, _terminals = add_nat_plan(repository, attachment.id)
        context = repository.add_routing_context()
        plan_id, context_id = plan.id, context.id

    runtime = {} if connection_state is None else {"connection_state": connection_state}
    artifact = evaluate(plan_id, context_id, **runtime).json()
    nat = execution(artifact, "NAT")

    assert nat["stage_outcome"] == expected
    assert nat["nat_attachment_evaluation"]["context"]["connection_state"] == connection_state


def test_packet_value_transitions_exact_constrained_and_unknown():
    cases = []
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        pool = repository.add_nat_pool(
            address_ranges=[{"start": "198.51.100.10", "end": "198.51.100.20"}]
        )
        transforms = [
            ({"op": "IDENTITY"}, {}, "IDENTITY"),
            (replace_destination("198.51.100.8"), {}, "TRANSFORMED_EXACT"),
            ({"op": "TRANSFORM", "source_ip": {"op": "SELECT_FROM", "pool_id": str(pool.id)}}, {}, "TRANSFORMED_CONSTRAINED"),
        ]
        for transform, scope, outcome in transforms:
            _policy, _rule, attachment = add_nat_attachment(repository, transform, scope=scope)
            plan, _nat, _terminals = add_nat_plan(repository, attachment.id)
            cases.append((plan.id, outcome))
        interface = repository.add_network_interface()
        binding = repository.add_l3_binding(interface.id, context.id)
        _policy, _rule, attachment = add_nat_attachment(
            repository,
            replace_destination("198.51.100.8"),
            scope={"egress_l3_binding_ids": [str(binding.id)]},
        )
        plan, _nat, _terminals = add_nat_plan(repository, attachment.id)
        cases.append((plan.id, "UNKNOWN"))
        context_id = context.id

    for plan_id, outcome in cases:
        artifact = evaluate(plan_id, context_id).json()
        nat = execution(artifact, "NAT")
        final = artifact["branches"][0]["final_state"]
        assert nat["stage_outcome"] == outcome
        if outcome in {"IDENTITY", "TRANSFORMED_EXACT"}:
            assert final["current_packet_state"] is not None
            assert final["current_packet_constraint"] is None
            assert final["current_packet_unknown"] is False
        elif outcome == "TRANSFORMED_CONSTRAINED":
            assert final["current_packet_state"] is None
            assert final["current_packet_constraint"] is not None
            assert final["current_packet_unknown"] is False
        else:
            assert final["current_packet_state"] is None
            assert final["current_packet_constraint"] is None
            assert final["current_packet_unknown"] is True


def add_downstream_stage(repository, plan_id, kind):
    if kind == "ROUTING_POLICY":
        context = repository.add_routing_context()
        table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        policy = repository.add_routing_policy(
            {"op": "SELECT_TABLE", "routing_table_id": str(table.id)}, "COMPLETE"
        )
        payload = {"policy_id": str(policy.id)}
    elif kind == "SECURITY":
        policy = repository.add_security_policy("PERMIT", "COMPLETE")
        attachment = repository.add_security_policy_attachment(policy.id, 10, {})
        payload = {"attachment_id": str(attachment.id)}
    elif kind == "NAT":
        policy = repository.add_nat_policy({"op": "IDENTITY"}, "COMPLETE")
        attachment = repository.add_nat_policy_attachment(policy.id, 10, {})
        payload = {"attachment_id": str(attachment.id)}
    else:
        payload = {}
    return repository.add_processing_stage(plan_id, kind, payload)


@pytest.mark.parametrize("kind", ["ROUTING_POLICY", "ROUTE_DECISION", "SECURITY", "NAT"])
@pytest.mark.parametrize("source_value", ["CONSTRAINED", "UNKNOWN"])
def test_nonexact_packet_skips_downstream_resolver_and_follows_uncertainty(kind, source_value):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        if source_value == "CONSTRAINED":
            pool = repository.add_nat_pool(
                address_ranges=[{"start": "198.51.100.10", "end": "198.51.100.20"}]
            )
            transform = {"op": "TRANSFORM", "source_ip": {"op": "SELECT_FROM", "pool_id": str(pool.id)}}
            scope = {}
            source_outcome = "TRANSFORMED_CONSTRAINED"
        else:
            interface = repository.add_network_interface()
            binding = repository.add_l3_binding(interface.id, context.id)
            transform = replace_destination("198.51.100.8")
            scope = {"egress_l3_binding_ids": [str(binding.id)]}
            source_outcome = "UNKNOWN"
        _policy, _rule, attachment = add_nat_attachment(repository, transform, scope=scope)
        plan = repository.add_packet_processing_plan("COMPLETE")
        source = repository.add_processing_stage(plan.id, "NAT", {"attachment_id": str(attachment.id)})
        downstream = add_downstream_stage(repository, plan.id, kind)
        terminal = add_terminal(repository, plan.id, "UNKNOWN")
        repository.add_processing_entry_point(plan.id, "TRANSIT", source.id)
        for outcome in ("IDENTITY", "TRANSFORMED_EXACT", "TRANSFORMED_CONSTRAINED", "UNKNOWN"):
            repository.add_processing_transition(plan.id, source.id, outcome, downstream.id if outcome == source_outcome else terminal.id)
        downstream_outcomes = {
            "ROUTING_POLICY": ("TABLE_SELECTED", "TABLE_SELECTION_UNKNOWN"),
            "ROUTE_DECISION": ("FORWARD", "LOCAL", "DISCARD", "NO_ROUTE", "UNKNOWN", "CONFLICTING"),
            "SECURITY": ("PASS", "BLOCKED", "UNKNOWN"),
            "NAT": ("IDENTITY", "TRANSFORMED_EXACT", "TRANSFORMED_CONSTRAINED", "UNKNOWN"),
        }[kind]
        for outcome in downstream_outcomes:
            repository.add_processing_transition(plan.id, downstream.id, outcome, terminal.id)
        plan_id, context_id = plan.id, context.id

    artifact = evaluate(plan_id, context_id).json()
    downstream_execution = execution(artifact, kind, occurrence=(1 if kind == "NAT" else 0))
    expected_outcome = "TABLE_SELECTION_UNKNOWN" if kind == "ROUTING_POLICY" else "UNKNOWN"
    expected_gap = "PACKET_CONSTRAINT_UNSUPPORTED" if source_value == "CONSTRAINED" else "PACKET_STATE_UNKNOWN"

    assert downstream_execution["stage_outcome"] == expected_outcome
    assert expected_gap in {gap["code"] for gap in downstream_execution["gaps"]}
    assert downstream_execution["routing_policy_evaluation"] is None
    assert downstream_execution["next_hop_resolution"] is None
    assert downstream_execution["security_attachment_evaluation"] is None
    assert downstream_execution["nat_attachment_evaluation"] is None


def routing_setup(repository):
    context = repository.add_routing_context()
    table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
    policy = repository.add_routing_policy(
        {"op": "SELECT_TABLE", "routing_table_id": str(table.id)}, "COMPLETE"
    )
    return context, table, policy


def add_route_edges(repository, plan_id, route, forward, unknown):
    for outcome in ("FORWARD", "LOCAL", "DISCARD", "NO_ROUTE"):
        repository.add_processing_transition(plan_id, route.id, outcome, forward.id)
    for outcome in ("UNKNOWN", "CONFLICTING"):
        repository.add_processing_transition(plan_id, route.id, outcome, unknown.id)


def test_nat_before_routing_policy_and_route_both_see_translated_packet():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, table, policy = routing_setup(repository)
        interface = repository.add_network_interface()
        binding = repository.add_l3_binding(interface.id, context.id)
        repository.add_route(table.id, "198.51.100.0/24", "FORWARD", [RouteNextHopInput(egress_l3_binding_id=binding.id)])
        _np, _nr, attachment = add_nat_attachment(repository, replace_destination("198.51.100.8"))
        plan = repository.add_packet_processing_plan("COMPLETE")
        nat = repository.add_processing_stage(plan.id, "NAT", {"attachment_id": str(attachment.id)})
        rp = repository.add_processing_stage(plan.id, "ROUTING_POLICY", {"policy_id": str(policy.id)})
        route = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        forward = add_terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
        unknown = add_terminal(repository, plan.id, "UNKNOWN")
        repository.add_processing_entry_point(plan.id, "TRANSIT", nat.id)
        for outcome in ("IDENTITY", "TRANSFORMED_CONSTRAINED", "UNKNOWN"):
            repository.add_processing_transition(plan.id, nat.id, outcome, unknown.id)
        repository.add_processing_transition(plan.id, nat.id, "TRANSFORMED_EXACT", rp.id)
        repository.add_processing_transition(plan.id, rp.id, "TABLE_SELECTED", route.id)
        repository.add_processing_transition(plan.id, rp.id, "TABLE_SELECTION_UNKNOWN", unknown.id)
        add_route_edges(repository, plan.id, route, forward, unknown)
        plan_id, context_id, table_id = plan.id, context.id, table.id

    artifact = evaluate(plan_id, context_id).json()
    policy_execution = execution(artifact, "ROUTING_POLICY")
    route_execution = execution(artifact, "ROUTE_DECISION")

    assert artifact["result"] == "CONTINUE_TO_NEXT_HOP"
    assert policy_execution["routing_policy_evaluation"]["query"]["packet_state"]["destination_ip"] == "198.51.100.8"
    assert route_execution["next_hop_resolution"]["query"]["destination_ip"] == "198.51.100.8"
    assert route_execution["selected_routing_table_id_before"] == str(table_id)


def build_route_nat_plan(
    repository, *, reroute=False, reselect=False, first_gateway=None
):
    context = repository.add_routing_context()
    table_a = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
    table_b = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
    interfaces = [repository.add_network_interface() for _ in range(2)]
    bindings = [repository.add_l3_binding(item.id, context.id) for item in interfaces]
    repository.add_route(
        table_a.id,
        "203.0.113.0/24",
        "FORWARD",
        [
            RouteNextHopInput(
                gateway_address=first_gateway,
                egress_l3_binding_id=bindings[0].id,
            )
        ],
    )
    repository.add_route((table_b if reselect else table_a).id, "198.51.100.0/24", "FORWARD", [RouteNextHopInput(egress_l3_binding_id=bindings[1].id)])
    policy_a = repository.add_routing_policy({"op": "SELECT_TABLE", "routing_table_id": str(table_a.id)}, "COMPLETE")
    policy_b = repository.add_routing_policy({"op": "SELECT_TABLE", "routing_table_id": str(table_b.id)}, "COMPLETE")
    _np, _nr, attachment = add_nat_attachment(repository, replace_destination("198.51.100.8"))
    plan = repository.add_packet_processing_plan("COMPLETE")
    rp1 = repository.add_processing_stage(plan.id, "ROUTING_POLICY", {"policy_id": str(policy_a.id)})
    route1 = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
    nat = repository.add_processing_stage(plan.id, "NAT", {"attachment_id": str(attachment.id)})
    rp2 = repository.add_processing_stage(plan.id, "ROUTING_POLICY", {"policy_id": str(policy_b.id)}) if reselect else None
    route2 = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {}) if reroute else None
    forward = add_terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
    unknown = add_terminal(repository, plan.id, "UNKNOWN")
    repository.add_processing_entry_point(plan.id, "TRANSIT", rp1.id)
    repository.add_processing_transition(plan.id, rp1.id, "TABLE_SELECTED", route1.id)
    repository.add_processing_transition(plan.id, rp1.id, "TABLE_SELECTION_UNKNOWN", unknown.id)
    add_route_edges(repository, plan.id, route1, nat, unknown)
    target_after_nat = rp2 if rp2 is not None else route2 if route2 is not None else forward
    for outcome in ("IDENTITY", "TRANSFORMED_CONSTRAINED", "UNKNOWN"):
        repository.add_processing_transition(plan.id, nat.id, outcome, unknown.id)
    repository.add_processing_transition(plan.id, nat.id, "TRANSFORMED_EXACT", target_after_nat.id)
    if rp2 is not None:
        repository.add_processing_transition(plan.id, rp2.id, "TABLE_SELECTED", route2.id)
        repository.add_processing_transition(plan.id, rp2.id, "TABLE_SELECTION_UNKNOWN", unknown.id)
    if route2 is not None:
        add_route_edges(repository, plan.id, route2, forward, unknown)
    return plan, context, table_a, table_b, bindings


@pytest.mark.parametrize(("reroute", "reselect"), [(False, False), (True, False), (True, True)])
def test_nat_after_route_requires_explicit_reroute_or_policy_reselection(reroute, reselect):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan, context, table_a, table_b, bindings = build_route_nat_plan(repository, reroute=reroute, reselect=reselect)
        plan_id, context_id = plan.id, context.id
        binding_ids = [str(item.id) for item in bindings]

    artifact = evaluate(plan_id, context_id).json()
    route_executions = [item for item in artifact["branches"][0]["stage_executions"] if item["stage_kind"] == "ROUTE_DECISION"]
    final = artifact["branches"][0]["final_state"]

    assert final["current_packet_state"]["destination_ip"] == "198.51.100.8"
    assert len(route_executions) == (2 if reroute else 1)
    assert route_executions[0]["next_hop_resolution"]["query"]["destination_ip"] == "203.0.113.8"
    if not reroute:
        assert final["direct_egress"]["egress_l3_binding_id"] == binding_ids[0]
        assert final["direct_egress"]["adjacency_mode"] == "DIRECT_DESTINATION"
        assert final["direct_egress"]["gateway_address"] is None
        decision = DirectEgressState.model_validate(final["direct_egress"])
        assert str(
            derive_adjacency_target(
                decision,
                PacketState.model_validate(final["current_packet_state"]).destination_ip,
            )
        ) == "198.51.100.8"
        assert final["selected_routing_table_id"] == str(table_a.id)
    else:
        assert route_executions[1]["next_hop_resolution"]["query"]["destination_ip"] == "198.51.100.8"
        expected_table = table_b.id if reselect else table_a.id
        assert route_executions[1]["selected_routing_table_id_before"] == str(expected_table)
        assert final["direct_egress"]["egress_l3_binding_id"] == binding_ids[1]
        assert final["direct_egress"]["adjacency_mode"] == "DIRECT_DESTINATION"
    policy_executions = [item for item in artifact["branches"][0]["stage_executions"] if item["stage_kind"] == "ROUTING_POLICY"]
    assert len(policy_executions) == (2 if reselect else 1)


def test_nat_after_gateway_route_preserves_gateway_adjacency_target():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan, context, table_a, _table_b, bindings = build_route_nat_plan(
            repository, first_gateway="192.0.2.1"
        )
        plan_id, context_id = plan.id, context.id

    artifact = evaluate(plan_id, context_id).json()
    final = artifact["branches"][0]["final_state"]
    decision = DirectEgressState.model_validate(final["direct_egress"])

    assert final["current_packet_state"]["destination_ip"] == "198.51.100.8"
    assert final["direct_egress"] == {
        "egress_l3_binding_id": str(bindings[0].id),
        "adjacency_mode": "GATEWAY",
        "gateway_address": "192.0.2.1",
        "original_destination": "203.0.113.8",
    }
    assert str(
        derive_adjacency_target(
            decision,
            PacketState.model_validate(final["current_packet_state"]).destination_ip,
        )
    ) == "192.0.2.1"
    assert final["selected_routing_table_id"] == str(table_a.id)


def test_nat_then_security_sees_translated_packet_and_reverse_order_sees_original():
    results = []
    for nat_first in (True, False):
        with SessionLocal.begin() as session:
            repository = CanonicalRepository(session)
            context = repository.add_routing_context()
            _np, _nr, nat_attachment = add_nat_attachment(repository, replace_destination("198.51.100.8"))
            security_policy = repository.add_security_policy("DROP", "COMPLETE")
            repository.add_security_rule(security_policy.id, 10, {"op": "DESTINATION_IP_IN", "prefixes": ["198.51.100.8/32"]}, "PERMIT")
            security_attachment = repository.add_security_policy_attachment(security_policy.id, 10, {})
            plan = repository.add_packet_processing_plan("COMPLETE")
            nat = repository.add_processing_stage(plan.id, "NAT", {"attachment_id": str(nat_attachment.id)})
            security = repository.add_processing_stage(plan.id, "SECURITY", {"attachment_id": str(security_attachment.id)})
            passed = add_terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
            blocked = add_terminal(repository, plan.id, "NOT_DELIVERED")
            unknown = add_terminal(repository, plan.id, "UNKNOWN")
            entry, second = (nat, security) if nat_first else (security, nat)
            repository.add_processing_entry_point(plan.id, "TRANSIT", entry.id)
            if nat_first:
                for outcome in ("IDENTITY", "TRANSFORMED_CONSTRAINED", "UNKNOWN"):
                    repository.add_processing_transition(plan.id, nat.id, outcome, unknown.id)
                repository.add_processing_transition(plan.id, nat.id, "TRANSFORMED_EXACT", security.id)
                repository.add_processing_transition(plan.id, security.id, "PASS", passed.id)
            else:
                repository.add_processing_transition(plan.id, security.id, "PASS", nat.id)
                for outcome in ("IDENTITY", "TRANSFORMED_EXACT"):
                    repository.add_processing_transition(plan.id, nat.id, outcome, passed.id)
                for outcome in ("TRANSFORMED_CONSTRAINED", "UNKNOWN"):
                    repository.add_processing_transition(plan.id, nat.id, outcome, unknown.id)
            repository.add_processing_transition(plan.id, security.id, "BLOCKED", blocked.id)
            repository.add_processing_transition(plan.id, security.id, "UNKNOWN", unknown.id)
            plan_id, context_id = plan.id, context.id
        artifact = evaluate(plan_id, context_id).json()
        results.append((nat_first, artifact))

    first_security = execution(results[0][1], "SECURITY")
    second_security = execution(results[1][1], "SECURITY")
    assert first_security["packet_before"]["destination_ip"] == "198.51.100.8"
    assert first_security["stage_outcome"] == "PASS"
    assert second_security["packet_before"]["destination_ip"] == "203.0.113.8"
    assert second_security["stage_outcome"] == "BLOCKED"
    assert not any(item["stage_kind"] == "NAT" for item in results[1][1]["branches"][0]["stage_executions"])


def test_ecmp_branches_run_nat_independently_with_branch_local_egress_scope():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context, table, routing_policy = routing_setup(repository)
        interfaces = [repository.add_network_interface() for _ in range(2)]
        bindings = [
            repository.add_l3_binding(interface.id, context.id)
            for interface in interfaces
        ]
        repository.add_route(
            table.id,
            "203.0.113.0/24",
            "FORWARD",
            [RouteNextHopInput(egress_l3_binding_id=item.id) for item in bindings],
        )
        _policy, _rule, attachment = add_nat_attachment(
            repository,
            replace_destination("198.51.100.8"),
            scope={"egress_l3_binding_ids": [str(bindings[0].id)]},
        )
        plan = repository.add_packet_processing_plan("COMPLETE")
        rp = repository.add_processing_stage(
            plan.id, "ROUTING_POLICY", {"policy_id": str(routing_policy.id)}
        )
        route = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        nat = repository.add_processing_stage(
            plan.id, "NAT", {"attachment_id": str(attachment.id)}
        )
        forward = add_terminal(repository, plan.id, "CONTINUE_TO_NEXT_HOP")
        unknown = add_terminal(repository, plan.id, "UNKNOWN")
        repository.add_processing_entry_point(plan.id, "TRANSIT", rp.id)
        repository.add_processing_transition(plan.id, rp.id, "TABLE_SELECTED", route.id)
        repository.add_processing_transition(plan.id, rp.id, "TABLE_SELECTION_UNKNOWN", unknown.id)
        add_route_edges(repository, plan.id, route, nat, unknown)
        for outcome in ("IDENTITY", "TRANSFORMED_EXACT"):
            repository.add_processing_transition(plan.id, nat.id, outcome, forward.id)
        for outcome in ("TRANSFORMED_CONSTRAINED", "UNKNOWN"):
            repository.add_processing_transition(plan.id, nat.id, outcome, unknown.id)
        plan_id, context_id = plan.id, context.id

    artifact = evaluate(plan_id, context_id).json()
    outputs = {
        (
            execution({"branches": [branch]}, "NAT")[
                "nat_attachment_evaluation"
            ]["context"]["egress_l3_binding_id"],
            execution({"branches": [branch]}, "NAT")["stage_outcome"],
            branch["final_state"]["current_packet_state"]["destination_ip"],
        )
        for branch in artifact["branches"]
    }

    assert len(artifact["branches"]) == 2
    assert outputs == {
        (str(bindings[0].id), "TRANSFORMED_EXACT", "198.51.100.8"),
        (str(bindings[1].id), "IDENTITY", "203.0.113.8"),
    }
    assert artifact["result"] == "CONTINUE_TO_NEXT_HOP"
