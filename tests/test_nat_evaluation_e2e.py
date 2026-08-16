import inspect
import os
import uuid

import httpx
import pytest
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import text

from app.database import SessionLocal
from app.errors import ValidationError
from app.models import NATPolicyAttachment
from app.nat_evaluation_resolver import ConfiguredNATEvaluationResolver
from app.repository import CanonicalRepository
from app.schemas import NATEvaluationContext, PacketState


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def identity():
    return {"op": "IDENTITY"}


def transform(**fields):
    return {
        "op": "TRANSFORM",
        **{
            key: {"op": "REPLACE_EXACT", "value": value}
            for key, value in fields.items()
        },
    }


def evaluate(*, packet=None, completeness="COMPLETE", **context):
    return httpx.post(
        f"{BASE_URL}/v1/traces/nat/evaluation",
        json={
            "context": {
                "packet_state": packet or {},
                "traffic_class": "TRANSIT",
                **context,
            },
            "configured_attachment_completeness": completeness,
        },
        timeout=5,
    )


def attached_policy(
    *,
    order=10,
    scope=None,
    predicate=None,
    selected_transform=None,
    default=None,
    policy_completeness="COMPLETE",
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_nat_policy(
            default or identity(), policy_completeness
        )
        if predicate is not None:
            repository.add_nat_rule(
                policy.id,
                10,
                predicate,
                selected_transform or identity(),
            )
        attachment = repository.add_nat_policy_attachment(
            policy.id, order, scope or {}
        )
        return attachment.id, policy.id


@pytest.mark.parametrize(
    ("completeness", "result", "reason", "gap"),
    [
        ("COMPLETE", "IDENTITY", "NO_NAT_POLICY_APPLICABLE", None),
        (
            "PARTIAL",
            "UNKNOWN",
            "NAT_UNCERTAINTY",
            "NAT_ATTACHMENT_COVERAGE_INCOMPLETE",
        ),
        (
            "UNKNOWN",
            "UNKNOWN",
            "NAT_UNCERTAINTY",
            "NAT_ATTACHMENT_COVERAGE_INCOMPLETE",
        ),
    ],
)
def test_empty_attachment_view_respects_completeness(
    completeness, result, reason, gap
):
    response = evaluate(completeness=completeness)
    assert response.status_code == 200
    artifact = response.json()
    assert artifact["result"] == result
    assert artifact["reason"] == reason
    assert [item["code"] for item in artifact["gaps"]] == (
        [] if gap is None else [gap]
    )


def test_definite_identity_and_exact_translation_stages():
    attached_policy(predicate={"op": "TRUE"}, selected_transform=identity())
    identity_artifact = evaluate(packet={"source_ip": "10.0.0.1"}).json()
    assert identity_artifact["result"] == "IDENTITY"
    assert identity_artifact["reason"] == "NAT_STAGES_IDENTITY"
    assert identity_artifact["branches"][0]["stage_executions"][0]["executed"]

    with SessionLocal.begin() as session:
        session.query(NATPolicyAttachment).delete()
    attached_policy(
        predicate={"op": "TRUE"},
        selected_transform=transform(source_ip="203.0.113.5"),
    )
    translated = evaluate(packet={"source_ip": "10.0.0.1"}).json()
    assert translated["result"] == "TRANSFORMED_EXACT"
    assert translated["packet_after"]["source_ip"] == "203.0.113.5"


def test_sequential_stage_uses_previous_packet_output():
    attached_policy(
        order=10,
        predicate={"op": "DESTINATION_IP_IN", "prefixes": ["203.0.113.10/32"]},
        selected_transform=transform(destination_ip="10.0.0.10"),
    )
    attached_policy(
        order=20,
        predicate={"op": "DESTINATION_IP_IN", "prefixes": ["10.0.0.10/32"]},
        selected_transform=transform(destination_port=443),
    )
    artifact = evaluate(
        packet={"destination_ip": "203.0.113.10", "destination_port": 8443}
    ).json()
    assert artifact["result"] == "TRANSFORMED_EXACT"
    assert artifact["packet_after"]["destination_ip"] == "10.0.0.10"
    assert artifact["packet_after"]["destination_port"] == 443
    stages = artifact["branches"][0]["stage_executions"]
    assert stages[1]["packet_before"] == stages[0]["packet_after"]
    assert stages[1]["policy_evaluation"]["branches"][0]["steps"][0][
        "predicate_result"
    ] == "TRUE"


def test_reverse_stage_order_changes_which_packet_predicate_sees():
    attached_policy(
        order=20,
        predicate={"op": "TRUE"},
        selected_transform=transform(destination_ip="10.0.0.10"),
    )
    attached_policy(
        order=10,
        predicate={"op": "DESTINATION_IP_IN", "prefixes": ["10.0.0.10/32"]},
        selected_transform=transform(destination_port=443),
    )
    artifact = evaluate(
        packet={"destination_ip": "203.0.113.10", "destination_port": 8443}
    ).json()
    assert artifact["packet_after"]["destination_ip"] == "10.0.0.10"
    assert artifact["packet_after"]["destination_port"] == 8443
    assert artifact["branches"][0]["stage_executions"][0][
        "policy_evaluation"
    ]["branches"][0]["steps"][0]["predicate_result"] == "FALSE"


def test_two_translations_preserve_each_others_fields_and_identity_lineage():
    attached_policy(order=5, predicate={"op": "TRUE"}, selected_transform=identity())
    attached_policy(
        order=10,
        predicate={"op": "TRUE"},
        selected_transform=transform(source_ip="203.0.113.5"),
    )
    attached_policy(
        order=20,
        predicate={"op": "TRUE"},
        selected_transform=transform(destination_ip="10.0.0.10"),
    )
    artifact = evaluate(
        packet={"source_ip": "10.1.1.1", "destination_ip": "198.51.100.1"}
    ).json()
    assert artifact["packet_after"]["source_ip"] == "203.0.113.5"
    assert artifact["packet_after"]["destination_ip"] == "10.0.0.10"
    stages = artifact["branches"][0]["stage_executions"]
    assert [stage["local_stage_order"] for stage in stages] == [5, 10, 20]
    assert stages[0]["policy_evaluation"]["result"] == "IDENTITY"


@pytest.mark.parametrize(
    ("selected_transform", "expected"),
    [
        (identity(), "IDENTITY"),
        (transform(source_ip="203.0.113.5"), "UNKNOWN"),
        (transform(source_ip="10.0.0.1"), "TRANSFORMED_EXACT"),
    ],
)
def test_unknown_applicability_apply_skip_branch_aggregation(
    selected_transform, expected
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        routing_context = repository.add_routing_context()
        binding = repository.add_l3_binding(interface.id, routing_context.id)
        binding_id = binding.id
    attached_policy(
        scope={"ingress_l3_binding_ids": [str(binding_id)]},
        predicate={"op": "TRUE"},
        selected_transform=selected_transform,
    )
    artifact = evaluate(packet={"source_ip": "10.0.0.1"}).json()
    assert artifact["result"] == expected
    assert len(artifact["branches"]) == 2
    assert {
        stage["branch_assumption"]
        for branch in artifact["branches"]
        for stage in branch["stage_executions"]
    } == {"APPLY", "SKIP"}
    assert "NAT_ATTACHMENT_APPLICABILITY_UNKNOWN" in {
        gap["code"] for gap in artifact["gaps"]
    }


def test_unknown_policy_stage_terminates_without_running_later_stage():
    first_id, _ = attached_policy(
        order=10,
        predicate={"op": "TRUE"},
        selected_transform=transform(source_ip="203.0.113.5"),
        policy_completeness="PARTIAL",
    )
    second_id, _ = attached_policy(
        order=20,
        predicate={"op": "TRUE"},
        selected_transform=transform(destination_port=443),
    )
    artifact = evaluate(packet={"source_ip": "10.0.0.1"}).json()
    assert artifact["result"] == "UNKNOWN"
    assert artifact["branches"][0]["termination"] == "NAT_POLICY_EVALUATION_UNKNOWN"
    stage_ids = {
        stage["attachment_id"]
        for stage in artifact["branches"][0]["stage_executions"]
    }
    assert str(first_id) in stage_ids
    assert str(second_id) not in stage_ids


def test_same_order_true_attachments_are_ambiguous_without_policy_execution():
    first, _ = attached_policy(predicate={"op": "TRUE"})
    second, _ = attached_policy(predicate={"op": "TRUE"})
    artifact = evaluate().json()
    assert artifact["result"] == "UNKNOWN"
    branch = artifact["branches"][0]
    assert branch["termination"] == "NAT_STAGE_ORDER_AMBIGUOUS"
    assert all(not stage["executed"] for stage in branch["stage_executions"])
    gap = next(
        gap for gap in artifact["gaps"] if gap["code"] == "NAT_STAGE_ORDER_AMBIGUOUS"
    )
    assert set(gap["competing_attachment_ids"]) == {str(first), str(second)}


def test_true_and_unknown_same_order_only_ambiguous_when_unknown_applies():
    attached_policy(predicate={"op": "TRUE"})
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        routing_context = repository.add_routing_context()
        binding = repository.add_l3_binding(interface.id, routing_context.id)
        binding_id = binding.id
    attached_policy(
        scope={"ingress_l3_binding_ids": [str(binding_id)]},
        predicate={"op": "TRUE"},
    )
    artifact = evaluate().json()
    assert {branch["termination"] for branch in artifact["branches"]} == {
        "COMPLETED",
        "NAT_STAGE_ORDER_AMBIGUOUS",
    }
    assert artifact["result"] == "UNKNOWN"


def test_true_and_false_same_order_executes_only_true_and_two_false_execute_none():
    attached_policy(scope={"traffic_classes": ["TRANSIT"]}, predicate={"op": "TRUE"})
    attached_policy(
        scope={"traffic_classes": ["LOCAL_INPUT"]}, predicate={"op": "TRUE"}
    )
    artifact = evaluate().json()
    assert artifact["result"] == "IDENTITY"
    assert sum(
        stage["executed"] for stage in artifact["branches"][0]["stage_executions"]
    ) == 1

    with SessionLocal.begin() as session:
        session.query(NATPolicyAttachment).delete()
    attached_policy(scope={"traffic_classes": ["LOCAL_INPUT"]})
    attached_policy(scope={"traffic_classes": ["LOCAL_OUTPUT"]})
    no_match = evaluate().json()
    assert no_match["reason"] == "NO_NAT_POLICY_APPLICABLE"
    assert not any(
        stage["executed"] for stage in no_match["branches"][0]["stage_executions"]
    )


def test_connection_state_is_passed_to_shared_predicate_context():
    attached_policy(
        predicate={"op": "CONNECTION_STATE_IN", "values": ["ESTABLISHED"]},
        selected_transform=transform(destination_port=443),
    )
    established = evaluate(
        packet={"destination_port": 8443}, connection_state="ESTABLISHED"
    ).json()
    new = evaluate(packet={"destination_port": 8443}, connection_state="NEW").json()
    missing = evaluate(packet={"destination_port": 8443}).json()
    assert established["result"] == "TRANSFORMED_EXACT"
    assert new["result"] == "IDENTITY"
    assert missing["result"] == "UNKNOWN"


def test_scope_canonicalization_reuses_security_semantics_and_all_dimensions_work():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        routing_context = repository.add_routing_context()
        ingress = repository.add_network_interface()
        egress = repository.add_network_interface()
        ingress_binding = repository.add_l3_binding(ingress.id, routing_context.id)
        egress_binding = repository.add_l3_binding(egress.id, routing_context.id)
        policy = repository.add_nat_policy(identity(), "COMPLETE")
        attachment = repository.add_nat_policy_attachment(
            policy.id,
            10,
            {
                "traffic_classes": ["TRANSIT", "TRANSIT"],
                "routing_context_ids": [str(routing_context.id)],
                "ingress_network_interface_ids": [str(ingress.id)],
                "egress_network_interface_ids": [str(egress.id)],
                "ingress_l3_binding_ids": [str(ingress_binding.id)],
                "egress_l3_binding_ids": [str(egress_binding.id)],
            },
        )
        assert attachment.scope["traffic_classes"] == ["TRANSIT"]

    artifact = evaluate(
        routing_context_id=str(routing_context.id),
        ingress_network_interface_id=str(ingress.id),
        egress_network_interface_id=str(egress.id),
        ingress_l3_binding_id=str(ingress_binding.id),
        egress_l3_binding_id=str(egress_binding.id),
    ).json()
    assert artifact["result"] == "IDENTITY"
    entity_types = {ref["entity_type"] for ref in artifact["evidence_refs"]}
    assert {
        "NATPolicyAttachment",
        "NATPolicy",
        "RoutingContext",
        "NetworkInterface",
        "L3Binding",
    } <= entity_types


def test_scope_validation_and_read_boundary_corruption():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_nat_policy(identity(), "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_nat_policy_attachment(
                policy.id,
                10,
                {"ingress_l3_binding_ids": [str(uuid.uuid4())]},
            )
        attachment = repository.add_nat_policy_attachment(policy.id, 10, {})
        attachment_id = attachment.id
    with SessionLocal.begin() as session:
        session.execute(
            text(
                "UPDATE nat_policy_attachments "
                "SET scope = CAST(:scope AS jsonb) WHERE id = :attachment_id"
            ),
            {
                "scope": '{"ingress_l3_binding_ids":["00000000-0000-0000-0000-000000000001"]}',
                "attachment_id": attachment_id,
            },
        )
    response = evaluate()
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_context_validation_frozen_models_and_workspace_constraints():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        routing_context = repository.add_routing_context()
        first = repository.add_network_interface()
        second = repository.add_network_interface()
        binding = repository.add_l3_binding(first.id, routing_context.id)
    response = evaluate(
        ingress_network_interface_id=str(second.id),
        ingress_l3_binding_id=str(binding.id),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"

    context = NATEvaluationContext(packet_state={}, traffic_class="TRANSIT")
    with pytest.raises(PydanticValidationError):
        context.traffic_class = "LOCAL_INPUT"
    assert "workspace_id" not in NATPolicyAttachment.__table__.columns
    source = inspect.getsource(ConfiguredNATEvaluationResolver).lower()
    assert "sessionlocal" not in source
    assert "create_engine" not in source
    assert "public." not in source
