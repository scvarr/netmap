import inspect
import json
import os
import uuid

import httpx
import pytest
from sqlalchemy import delete, func, select, text

from app import packet_processing_plan_resolver
from app.database import SessionLocal
from app.errors import ModelError, ValidationError
from app.models import (
    PacketProcessingPlan,
    ProcessingEntryPoint,
    ProcessingStage,
    ProcessingTransition,
)
from app.repository import CanonicalRepository


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def validate_api(plan_id):
    return httpx.post(
        f"{BASE_URL}/v1/traces/packet-processing/plan-validation",
        json={"plan_id": str(plan_id)},
        timeout=5,
    )


def references(repository):
    context = repository.add_routing_context()
    table = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
    routing_policy = repository.add_routing_policy(
        {"op": "SELECT_TABLE", "routing_table_id": str(table.id)},
        "COMPLETE",
        policy_id=uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    )
    security_policy = repository.add_security_policy("PERMIT", "COMPLETE")
    security_attachment = repository.add_security_policy_attachment(
        security_policy.id, 10, {}
    )
    nat_policy = repository.add_nat_policy({"op": "IDENTITY"}, "COMPLETE")
    nat_attachment = repository.add_nat_policy_attachment(nat_policy.id, 10, {})
    return routing_policy.id, security_attachment.id, nat_attachment.id


def terminal_plan(completeness="COMPLETE", traffic_classes=("TRANSIT",)):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan(completeness)
        terminal = repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "CONTINUE_TO_NEXT_HOP"}
        )
        entries = [
            repository.add_processing_entry_point(plan.id, item, terminal.id)
            for item in traffic_classes
        ]
        return plan.id, terminal.id, [entry.id for entry in entries]


def test_create_plan_and_direct_terminal_validation_artifact():
    plan_id, stage_id, entry_ids = terminal_plan()

    response = validate_api(plan_id)
    artifact = response.json()

    assert response.status_code == 200
    assert artifact["result"] == "VALID"
    assert artifact["configured_completeness"] == "COMPLETE"
    assert artifact["stages"] == [
        {
            "stage_id": str(stage_id),
            "kind": "TERMINATE",
            "payload": {"outcome": "CONTINUE_TO_NEXT_HOP"},
        }
    ]
    assert artifact["entry_points"][0]["entry_point_id"] == str(entry_ids[0])


@pytest.mark.parametrize("completeness", ["COMPLETE", "PARTIAL", "UNKNOWN"])
def test_valid_plan_completeness_values(completeness):
    plan_id, _, _ = terminal_plan(completeness)
    assert validate_api(plan_id).json()["configured_completeness"] == completeness


def test_invalid_plan_completeness_is_rejected():
    with SessionLocal.begin() as session:
        with pytest.raises(ValidationError):
            CanonicalRepository(session).add_packet_processing_plan("OBSERVED")


@pytest.mark.parametrize(
    ("kind", "payload", "reference_index"),
    [
        ("ROUTING_POLICY", {"policy_id": "{reference}"}, 0),
        ("ROUTE_DECISION", {}, None),
        ("SECURITY", {"attachment_id": "{reference}"}, 1),
        ("NAT", {"attachment_id": "{reference}"}, 2),
        ("TERMINATE", {"outcome": "UNKNOWN"}, None),
    ],
)
def test_supported_stage_kinds_and_payloads(kind, payload, reference_index):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        refs = references(repository)
        plan = repository.add_packet_processing_plan("PARTIAL")
        if reference_index is not None:
            payload = {next(iter(payload)): str(refs[reference_index])}
        stage = repository.add_processing_stage(plan.id, kind, payload)

    assert stage.kind == kind
    assert stage.payload == payload


@pytest.mark.parametrize("kind", ["PACKET_MARK", "ADJACENCY_L2", "LOCAL_DELIVERY"])
def test_unsupported_stage_kinds_are_rejected(kind):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan("PARTIAL")
        with pytest.raises(ValidationError):
            repository.add_processing_stage(plan.id, kind, {})


def test_duplicate_stage_id_is_rejected():
    shared_id = uuid.uuid4()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan("PARTIAL")
        repository.add_processing_stage(
            plan.id, "ROUTE_DECISION", {}, stage_id=shared_id
        )
        with pytest.raises(ValidationError):
            repository.add_processing_stage(
                plan.id, "TERMINATE", {"outcome": "UNKNOWN"}, stage_id=shared_id
            )


def test_duplicate_entry_class_rejected_but_stage_may_serve_multiple_classes():
    plan_id, stage_id, _ = terminal_plan(
        traffic_classes=("TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT")
    )
    assert validate_api(plan_id).status_code == 200
    with SessionLocal.begin() as session:
        with pytest.raises(ValidationError):
            CanonicalRepository(session).add_processing_entry_point(
                plan_id, "TRANSIT", stage_id
            )


@pytest.mark.parametrize(
    ("kind", "payload"),
    [
        ("ROUTING_POLICY", {"policy_id": str(uuid.uuid4())}),
        ("SECURITY", {"attachment_id": str(uuid.uuid4())}),
        ("NAT", {"attachment_id": str(uuid.uuid4())}),
    ],
)
def test_dangling_stage_payload_reference_is_rejected(kind, payload):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan("PARTIAL")
        with pytest.raises(ValidationError):
            repository.add_processing_stage(plan.id, kind, payload)


@pytest.mark.parametrize(
    ("kind", "payload"),
    [
        ("ROUTING_POLICY", {"policy_id": str(uuid.uuid4()), "extra": True}),
        ("ROUTE_DECISION", {"table_id": str(uuid.uuid4())}),
        ("SECURITY", {"policy_id": str(uuid.uuid4())}),
        ("NAT", {"attachment_id": "invalid"}),
        ("TERMINATE", {"outcome": "PERMIT"}),
    ],
)
def test_invalid_stage_payload_shape_is_rejected(kind, payload):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan("PARTIAL")
        with pytest.raises(ValidationError):
            repository.add_processing_stage(plan.id, kind, payload)


def test_routing_plan_persists_and_validates_without_execution():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        routing_policy_id, _, _ = references(repository)
        plan = repository.add_packet_processing_plan("COMPLETE")
        policy = repository.add_processing_stage(
            plan.id, "ROUTING_POLICY", {"policy_id": str(routing_policy_id)}
        )
        route = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        forward = repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "CONTINUE_TO_NEXT_HOP"}
        )
        local = repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "NETWORK_DELIVERY"}
        )
        negative = repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "NOT_DELIVERED"}
        )
        unknown = repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "UNKNOWN"}
        )
        repository.add_processing_entry_point(plan.id, "TRANSIT", policy.id)
        repository.add_processing_transition(
            plan.id, policy.id, "TABLE_SELECTED", route.id
        )
        repository.add_processing_transition(
            plan.id, policy.id, "TABLE_SELECTION_UNKNOWN", unknown.id
        )
        for outcome, target in (
            ("FORWARD", forward),
            ("LOCAL", local),
            ("DISCARD", negative),
            ("NO_ROUTE", negative),
            ("UNKNOWN", unknown),
            ("CONFLICTING", unknown),
        ):
            repository.add_processing_transition(
                plan.id, route.id, outcome, target.id
            )
        plan_id = plan.id

    artifact = validate_api(plan_id).json()

    assert artifact["result"] == "VALID"
    assert len(artifact["stages"]) == 6
    assert len(artifact["transitions"]) == 8
    assert "Route" not in {ref["entity_type"] for ref in artifact["evidence_refs"]}


def test_security_nat_plan_persists_and_validates_without_execution():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        _, security_attachment_id, nat_attachment_id = references(repository)
        plan = repository.add_packet_processing_plan("COMPLETE")
        security = repository.add_processing_stage(
            plan.id, "SECURITY", {"attachment_id": str(security_attachment_id)}
        )
        nat = repository.add_processing_stage(
            plan.id, "NAT", {"attachment_id": str(nat_attachment_id)}
        )
        proceed = repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "CONTINUE_TO_NEXT_HOP"}
        )
        blocked = repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "NOT_DELIVERED"}
        )
        unknown = repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "UNKNOWN"}
        )
        repository.add_processing_entry_point(plan.id, "TRANSIT", security.id)
        for outcome, target in (
            ("PASS", nat),
            ("BLOCKED", blocked),
            ("UNKNOWN", unknown),
        ):
            repository.add_processing_transition(
                plan.id, security.id, outcome, target.id
            )
        for outcome, target in (
            ("IDENTITY", proceed),
            ("TRANSFORMED_EXACT", proceed),
            ("TRANSFORMED_CONSTRAINED", unknown),
            ("UNKNOWN", unknown),
        ):
            repository.add_processing_transition(
                plan.id, nat.id, outcome, target.id
            )
        plan_id = plan.id

    artifact = validate_api(plan_id).json()
    refs = {ref["entity_type"] for ref in artifact["evidence_refs"]}

    assert artifact["result"] == "VALID"
    assert {"SecurityPolicyAttachment", "NATPolicyAttachment"} <= refs
    assert "SecurityPolicy" not in refs
    assert "NATPolicy" not in refs


@pytest.mark.parametrize(
    ("kind", "valid_outcome"),
    [
        ("ROUTING_POLICY", "TABLE_SELECTED"),
        ("ROUTE_DECISION", "FORWARD"),
        ("SECURITY", "PASS"),
        ("NAT", "TRANSFORMED_EXACT"),
    ],
)
def test_valid_transition_outcome_vocabulary(kind, valid_outcome):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        refs = references(repository)
        plan = repository.add_packet_processing_plan("PARTIAL")
        payload = {
            "ROUTING_POLICY": {"policy_id": str(refs[0])},
            "ROUTE_DECISION": {},
            "SECURITY": {"attachment_id": str(refs[1])},
            "NAT": {"attachment_id": str(refs[2])},
        }[kind]
        source = repository.add_processing_stage(plan.id, kind, payload)
        target = repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "UNKNOWN"}
        )
        edge = repository.add_processing_transition(
            plan.id, source.id, valid_outcome, target.id
        )
    assert edge.outcome == valid_outcome


def test_invalid_duplicate_terminal_and_cross_plan_transitions_are_rejected():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan_a = repository.add_packet_processing_plan("PARTIAL")
        plan_b = repository.add_packet_processing_plan("PARTIAL")
        source = repository.add_processing_stage(plan_a.id, "ROUTE_DECISION", {})
        target = repository.add_processing_stage(
            plan_a.id, "TERMINATE", {"outcome": "UNKNOWN"}
        )
        foreign = repository.add_processing_stage(
            plan_b.id, "TERMINATE", {"outcome": "UNKNOWN"}
        )
        repository.add_processing_transition(
            plan_a.id, source.id, "FORWARD", target.id
        )
        with pytest.raises(ValidationError):
            repository.add_processing_transition(
                plan_a.id, source.id, "FORWARD", target.id
            )
        with pytest.raises(ValidationError):
            repository.add_processing_transition(
                plan_a.id, source.id, "TABLE_SELECTED", target.id
            )
        with pytest.raises(ValidationError):
            repository.add_processing_transition(
                plan_a.id, target.id, "UNKNOWN", source.id
            )
        with pytest.raises(ValidationError):
            repository.add_processing_transition(
                plan_a.id, source.id, "LOCAL", foreign.id
            )
        with pytest.raises(ValidationError):
            repository.add_processing_transition(
                plan_a.id, source.id, "LOCAL", uuid.uuid4()
            )


def test_plan_without_entry_is_model_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan("PARTIAL")
        repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "UNKNOWN"}
        )
        plan_id = plan.id
    response = validate_api(plan_id)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_unreachable_stage_is_model_error():
    plan_id, _, _ = terminal_plan("PARTIAL")
    with SessionLocal.begin() as session:
        CanonicalRepository(session).add_processing_stage(
            plan_id, "TERMINATE", {"outcome": "UNKNOWN"}
        )
    assert validate_api(plan_id).status_code == 409


@pytest.mark.parametrize("completeness", ["PARTIAL", "UNKNOWN"])
def test_incomplete_plan_may_have_nonterminal_dead_end(completeness):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan(completeness)
        stage = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        repository.add_processing_entry_point(plan.id, "TRANSIT", stage.id)
        plan_id = plan.id
    assert validate_api(plan_id).json()["result"] == "VALID"


@pytest.mark.parametrize("edge_count", [0, 1])
def test_complete_plan_missing_required_outcomes_or_dead_end_is_model_error(edge_count):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan("COMPLETE")
        stage = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        terminal = repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "UNKNOWN"}
        )
        repository.add_processing_entry_point(plan.id, "TRANSIT", stage.id)
        if edge_count:
            repository.add_processing_transition(
                plan.id, stage.id, "UNKNOWN", terminal.id
            )
        else:
            session.delete(terminal)
        plan_id = plan.id
    assert validate_api(plan_id).status_code == 409


def test_write_helper_rejects_self_and_multi_node_cycles():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan("PARTIAL")
        first = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        second = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        with pytest.raises(ValidationError):
            repository.add_processing_transition(
                plan.id, first.id, "FORWARD", first.id
            )
        repository.add_processing_transition(
            plan.id, first.id, "FORWARD", second.id
        )
        with pytest.raises(ValidationError):
            repository.add_processing_transition(
                plan.id, second.id, "LOCAL", first.id
            )


def test_write_level_final_graph_validation_uses_validation_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan("COMPLETE")
        stage = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        repository.add_processing_entry_point(plan.id, "TRANSIT", stage.id)
        with pytest.raises(ValidationError):
            repository.validate_packet_processing_plan(plan.id)


def test_direct_stored_self_cycle_is_model_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan("PARTIAL")
        stage = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        repository.add_processing_entry_point(plan.id, "TRANSIT", stage.id)
        session.add(
            ProcessingTransition(
                plan_id=plan.id,
                from_stage_id=stage.id,
                outcome="FORWARD",
                to_stage_id=stage.id,
            )
        )
        plan_id = plan.id
    assert validate_api(plan_id).status_code == 409


def test_direct_stored_multi_node_cycle_is_model_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan("PARTIAL")
        first = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        second = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        repository.add_processing_entry_point(plan.id, "TRANSIT", first.id)
        repository.add_processing_transition(
            plan.id, first.id, "FORWARD", second.id
        )
        session.add(
            ProcessingTransition(
                plan_id=plan.id,
                from_stage_id=second.id,
                outcome="LOCAL",
                to_stage_id=first.id,
            )
        )
        plan_id = plan.id
    assert validate_api(plan_id).status_code == 409


def test_cross_plan_entry_and_transition_corruption_are_model_errors():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        first = repository.add_packet_processing_plan("PARTIAL")
        second = repository.add_packet_processing_plan("PARTIAL")
        first_stage = repository.add_processing_stage(
            first.id, "ROUTE_DECISION", {}
        )
        second_stage = repository.add_processing_stage(
            second.id, "TERMINATE", {"outcome": "UNKNOWN"}
        )
        session.add(
            ProcessingEntryPoint(
                plan_id=first.id,
                traffic_class="TRANSIT",
                stage_id=second_stage.id,
            )
        )
        session.add(
            ProcessingTransition(
                plan_id=first.id,
                from_stage_id=first_stage.id,
                outcome="FORWARD",
                to_stage_id=second_stage.id,
            )
        )
        first_id = first.id
    assert validate_api(first_id).status_code == 409


@pytest.mark.parametrize("corruption", ["unsupported_kind", "invalid_outcome"])
def test_direct_stored_stage_or_transition_corruption_is_model_error(corruption):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        plan = repository.add_packet_processing_plan("PARTIAL")
        source = repository.add_processing_stage(plan.id, "ROUTE_DECISION", {})
        target = repository.add_processing_stage(
            plan.id, "TERMINATE", {"outcome": "UNKNOWN"}
        )
        repository.add_processing_entry_point(plan.id, "TRANSIT", source.id)
        if corruption == "unsupported_kind":
            source.kind = "PACKET_MARK"
        else:
            session.add(
                ProcessingTransition(
                    plan_id=plan.id,
                    from_stage_id=source.id,
                    outcome="TABLE_SELECTED",
                    to_stage_id=target.id,
                )
            )
        plan_id = plan.id
    response = validate_api(plan_id)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


@pytest.mark.parametrize("corruption", ["noncanonical", "dangling"])
def test_direct_stored_payload_corruption_is_model_error(corruption):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        routing_policy_id, _, _ = references(repository)
        plan = repository.add_packet_processing_plan("PARTIAL")
        stage = repository.add_processing_stage(
            plan.id, "ROUTING_POLICY", {"policy_id": str(routing_policy_id)}
        )
        repository.add_processing_entry_point(plan.id, "TRANSIT", stage.id)
        payload = {
            "policy_id": (
                str(routing_policy_id).upper()
                if corruption == "noncanonical"
                else str(uuid.uuid4())
            )
        }
        session.execute(
            text(
                "UPDATE processing_stages SET payload = CAST(:payload AS jsonb) WHERE id = :id"
            ),
            {"payload": json.dumps(payload), "id": stage.id},
        )
        plan_id = plan.id
    assert validate_api(plan_id).status_code == 409


def test_plan_delete_cascades_all_graph_records():
    plan_id, _, _ = terminal_plan()
    with SessionLocal.begin() as session:
        session.execute(
            delete(PacketProcessingPlan).where(PacketProcessingPlan.id == plan_id)
        )
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(ProcessingStage)) == 0
        assert session.scalar(select(func.count()).select_from(ProcessingTransition)) == 0
        assert session.scalar(select(func.count()).select_from(ProcessingEntryPoint)) == 0


def test_validation_is_read_only_standalone_and_workspace_agnostic():
    plan_id, _, _ = terminal_plan()
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
    assert validate_api(plan_id).status_code == 200
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
    source = inspect.getsource(packet_processing_plan_resolver).lower()
    assert before == after
    for forbidden in (
        "sessionlocal",
        "create_engine",
        "workspace",
        "cache",
        "routingpolicyresolver",
        "routedecisionresolver",
        "securityresolver",
        "natresolver",
        "l2resolver",
        "packetstate",
    ):
        assert forbidden not in source
    for model in (
        PacketProcessingPlan,
        ProcessingStage,
        ProcessingTransition,
        ProcessingEntryPoint,
    ):
        assert "workspace_id" not in model.__table__.columns
