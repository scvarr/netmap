import os
import uuid

import httpx
import pytest
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import text

from app.database import SessionLocal
from app.errors import ValidationError
from app.models import SecurityPolicyAttachment
from app.repository import CanonicalRepository
from app.schemas import PacketState, SecurityEvaluationContext


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def evaluate(context=None, completeness="COMPLETE"):
    return httpx.post(
        f"{BASE_URL}/v1/traces/security/evaluation",
        json={
            "context": context
            or {"packet_state": {}, "traffic_class": "TRANSIT"},
            "configured_attachment_completeness": completeness,
        },
        timeout=5,
    )


def add_attached_policy(
    *, scope=None, action="PERMIT", stage_order=10, policy_completeness="COMPLETE"
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_security_policy("PERMIT", policy_completeness)
        rule = repository.add_security_rule(
            policy.id, 10, {"op": "TRUE"}, action
        )
        attachment = repository.add_security_policy_attachment(
            policy.id, stage_order, scope or {}
        )
        return attachment.id, policy.id, rule.id


@pytest.mark.parametrize(
    ("completeness", "result", "reason", "gap"),
    [
        ("COMPLETE", "PASS", "NO_POLICY_APPLICABLE", None),
        (
            "PARTIAL",
            "UNKNOWN",
            "SECURITY_UNCERTAINTY",
            "SECURITY_ATTACHMENT_COVERAGE_INCOMPLETE",
        ),
        (
            "UNKNOWN",
            "UNKNOWN",
            "SECURITY_UNCERTAINTY",
            "SECURITY_ATTACHMENT_COVERAGE_INCOMPLETE",
        ),
    ],
)
def test_empty_attachment_view_respects_completeness(
    completeness, result, reason, gap
):
    artifact = evaluate(completeness=completeness).json()
    assert artifact["result"] == result
    assert artifact["reason"] == reason
    assert [item["code"] for item in artifact["gaps"]] == ([] if gap is None else [gap])


@pytest.mark.parametrize(
    ("scope", "context_patch", "expected"),
    [
        ({"traffic_classes": ["TRANSIT"]}, {}, "TRUE"),
        ({"traffic_classes": ["LOCAL_INPUT"]}, {}, "FALSE"),
        ({"ingress_l3_binding_ids": ["00000000-0000-0000-0000-000000000001"]}, {}, "WRITE_ERROR"),
    ],
)
def test_traffic_scope_and_dangling_write_validation(scope, context_patch, expected):
    if expected == "WRITE_ERROR":
        with SessionLocal.begin() as session:
            repository = CanonicalRepository(session)
            policy = repository.add_security_policy("PERMIT", "COMPLETE")
            with pytest.raises(ValidationError):
                repository.add_security_policy_attachment(policy.id, 1, scope)
        return
    add_attached_policy(scope=scope)
    context = {"packet_state": {}, "traffic_class": "TRANSIT", **context_patch}
    artifact = evaluate(context).json()
    assert artifact["attachment_evaluations"][0]["applicability"] == expected


def test_missing_constrained_runtime_field_is_unknown_and_false_dominates_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        routing_context = repository.add_routing_context()
        binding = repository.add_l3_binding(interface.id, routing_context.id)
        policy = repository.add_security_policy("PERMIT", "COMPLETE")
        repository.add_security_rule(policy.id, 10, {"op": "TRUE"}, "DROP")
        repository.add_security_policy_attachment(
            policy.id,
            10,
            {"ingress_l3_binding_ids": [str(binding.id)]},
        )
        second = repository.add_security_policy("PERMIT", "COMPLETE")
        repository.add_security_rule(second.id, 10, {"op": "TRUE"}, "DROP")
        repository.add_security_policy_attachment(
            second.id,
            20,
            {
                "traffic_classes": ["LOCAL_INPUT"],
                "ingress_l3_binding_ids": [str(binding.id)],
            },
        )

    artifact = evaluate().json()
    assert [item["applicability"] for item in artifact["attachment_evaluations"]] == [
        "UNKNOWN",
        "FALSE",
    ]
    assert artifact["result"] == "UNKNOWN"


def test_all_id_scope_dimensions_and_multiple_values_are_evaluated_exactly():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context_a = repository.add_routing_context()
        interface_in = repository.add_network_interface()
        interface_out = repository.add_network_interface()
        other_interface = repository.add_network_interface()
        binding_in = repository.add_l3_binding(interface_in.id, context_a.id)
        binding_out = repository.add_l3_binding(interface_out.id, context_a.id)
        policy = repository.add_security_policy("DROP", "COMPLETE")
        repository.add_security_rule(policy.id, 10, {"op": "TRUE"}, "PERMIT")
        attachment = repository.add_security_policy_attachment(
            policy.id,
            10,
            {
                "routing_context_ids": [str(context_a.id)],
                "ingress_network_interface_ids": [
                    str(other_interface.id),
                    str(interface_in.id),
                ],
                "egress_network_interface_ids": [str(interface_out.id)],
                "ingress_l3_binding_ids": [str(binding_in.id)],
                "egress_l3_binding_ids": [str(binding_out.id)],
            },
        )
        attachment_id = attachment.id

    artifact = evaluate(
        {
            "packet_state": {},
            "traffic_class": "TRANSIT",
            "routing_context_id": str(context_a.id),
            "ingress_network_interface_id": str(interface_in.id),
            "egress_network_interface_id": str(interface_out.id),
            "ingress_l3_binding_id": str(binding_in.id),
            "egress_l3_binding_id": str(binding_out.id),
        }
    ).json()
    item = artifact["attachment_evaluations"][0]
    assert item["attachment_id"] == str(attachment_id)
    assert item["applicability"] == "TRUE"
    assert artifact["result"] == "PASS"
    assert {
        "RoutingContext",
        "NetworkInterface",
        "L3Binding",
    }.issubset({ref["entity_type"] for ref in item["evidence_refs"]})


@pytest.mark.parametrize(
    ("action", "coverage", "expected", "reason"),
    [
        ("PERMIT", "COMPLETE", "PASS", "ALL_APPLICABLE_POLICIES_PERMIT"),
        ("DROP", "COMPLETE", "BLOCKED", "POLICY_DROP"),
        ("REJECT", "COMPLETE", "BLOCKED", "POLICY_REJECT"),
        ("PERMIT", "PARTIAL", "UNKNOWN", "SECURITY_UNCERTAINTY"),
        ("DROP", "PARTIAL", "BLOCKED", "POLICY_DROP"),
    ],
)
def test_definite_policy_aggregation(action, coverage, expected, reason):
    add_attached_policy(action=action)
    artifact = evaluate(completeness=coverage).json()
    assert artifact["result"] == expected
    assert artifact["reason"] == reason
    assert artifact["attachment_evaluations"][0]["policy_evaluation"]["result"] == action


def test_definite_permit_and_later_drop_block_and_preserve_ordered_stages():
    add_attached_policy(action="PERMIT", stage_order=10)
    add_attached_policy(action="DROP", stage_order=20)
    artifact = evaluate().json()
    assert artifact["result"] == "BLOCKED"
    assert [item["stage_order"] for item in artifact["attachment_evaluations"]] == [10, 20]
    assert [item["policy_evaluation"]["result"] for item in artifact["attachment_evaluations"]] == [
        "PERMIT",
        "DROP",
    ]


def test_same_stage_attachments_are_both_evaluated_without_unique_priority():
    ids = {
        add_attached_policy(action="PERMIT", stage_order=10)[0],
        add_attached_policy(action="DROP", stage_order=10)[0],
    }
    artifact = evaluate().json()
    assert artifact["result"] == "BLOCKED"
    assert {uuid.UUID(item["attachment_id"]) for item in artifact["attachment_evaluations"]} == ids
    assert {item["policy_evaluation"]["result"] for item in artifact["attachment_evaluations"]} == {
        "PERMIT",
        "DROP",
    }


@pytest.mark.parametrize(
    ("action", "expected"),
    [("DROP", "UNKNOWN"), ("REJECT", "UNKNOWN"), ("PERMIT", "PASS")],
)
def test_unknown_applicability_aggregation(action, expected):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        routing_context = repository.add_routing_context()
        binding = repository.add_l3_binding(interface.id, routing_context.id)
        policy = repository.add_security_policy("PERMIT", "COMPLETE")
        repository.add_security_rule(policy.id, 10, {"op": "TRUE"}, action)
        repository.add_security_policy_attachment(
            policy.id, 10, {"ingress_l3_binding_ids": [str(binding.id)]}
        )
    artifact = evaluate().json()
    assert artifact["result"] == expected
    assert artifact["attachment_evaluations"][0]["applicability"] == "UNKNOWN"
    assert "SECURITY_ATTACHMENT_APPLICABILITY_UNKNOWN" in {
        gap["code"] for gap in artifact["gaps"]
    }


def test_definite_drop_overrides_unrelated_unknown_attachment():
    add_attached_policy(action="DROP", stage_order=10)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        context = repository.add_routing_context()
        binding = repository.add_l3_binding(interface.id, context.id)
        policy = repository.add_security_policy("DROP", "COMPLETE")
        repository.add_security_rule(policy.id, 10, {"op": "TRUE"}, "REJECT")
        repository.add_security_policy_attachment(
            policy.id, 20, {"egress_l3_binding_ids": [str(binding.id)]}
        )
    artifact = evaluate().json()
    assert artifact["result"] == "BLOCKED"
    assert {item["applicability"] for item in artifact["attachment_evaluations"]} == {
        "TRUE",
        "UNKNOWN",
    }


def test_unknown_policy_evaluation_is_preserved_as_typed_uncertainty():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_security_policy("PERMIT", "COMPLETE")
        repository.add_security_rule(
            policy.id,
            10,
            {"op": "DESTINATION_PORT_IN", "ranges": [{"start": 22, "end": 22}]},
            "DROP",
        )
        repository.add_security_policy_attachment(policy.id, 10, {})
    artifact = evaluate().json()
    assert artifact["result"] == "UNKNOWN"
    assert artifact["attachment_evaluations"][0]["policy_evaluation"]["result"] == "UNKNOWN"
    assert "SECURITY_POLICY_EVALUATION_UNKNOWN" in {
        gap["code"] for gap in artifact["gaps"]
    }


def test_scope_is_canonicalized_and_invalid_shapes_are_rejected():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface_a = repository.add_network_interface()
        interface_b = repository.add_network_interface()
        policy = repository.add_security_policy("PERMIT", "COMPLETE")
        attachment = repository.add_security_policy_attachment(
            policy.id,
            10,
            {
                "traffic_classes": ["TRANSIT", "TRANSIT"],
                "ingress_network_interface_ids": [
                    str(interface_b.id),
                    str(interface_a.id),
                    str(interface_a.id),
                ],
            },
        )
        assert attachment.scope["traffic_classes"] == ["TRANSIT"]
        assert attachment.scope["ingress_network_interface_ids"] == sorted(
            [str(interface_a.id), str(interface_b.id)]
        )
        for invalid in (
            {"traffic_classes": []},
            {"traffic_classes": ["BOGUS"]},
            {"unknown": ["x"]},
            {"routing_context_ids": ["not-a-uuid"]},
        ):
            with pytest.raises(ValidationError):
                repository.add_security_policy_attachment(policy.id, 20, invalid)


def test_corrupt_or_dangling_stored_scope_is_model_error_through_endpoint():
    attachment_id, _, _ = add_attached_policy()
    missing = uuid.UUID("00000000-0000-0000-0000-000000000001")
    with SessionLocal.begin() as session:
        session.execute(
            text(
                "UPDATE security_policy_attachments "
                "SET scope = jsonb_build_object('routing_context_ids', jsonb_build_array(CAST(:missing AS text))) "
                "WHERE id = :id"
            ),
            {"missing": missing, "id": attachment_id},
        )
    response = evaluate()
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_noncanonical_stored_scope_is_model_error_through_endpoint():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        policy = repository.add_security_policy("PERMIT", "COMPLETE")
        attachment = repository.add_security_policy_attachment(
            policy.id, 10, {"ingress_network_interface_ids": [str(interface.id)]}
        )
        session.execute(
            text(
                "UPDATE security_policy_attachments "
                "SET scope = jsonb_build_object('ingress_network_interface_ids', "
                "jsonb_build_array(CAST(:value AS text), CAST(:value AS text))) WHERE id = :id"
            ),
            {"value": interface.id, "id": attachment.id},
        )
    assert evaluate().status_code == 409


def test_l3_binding_interface_context_inconsistency_is_validation_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface_a = repository.add_network_interface()
        interface_b = repository.add_network_interface()
        context = repository.add_routing_context()
        binding = repository.add_l3_binding(interface_a.id, context.id)
    response = evaluate(
        {
            "packet_state": {},
            "traffic_class": "TRANSIT",
            "ingress_network_interface_id": str(interface_b.id),
            "ingress_l3_binding_id": str(binding.id),
        }
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_packet_and_context_models_are_frozen_and_marks_stay_forbidden():
    packet = PacketState(source_ip="192.0.2.1")
    context = SecurityEvaluationContext(packet_state=packet, traffic_class="TRANSIT")
    with pytest.raises(PydanticValidationError):
        packet.source_ip = "192.0.2.2"
    with pytest.raises(PydanticValidationError):
        context.traffic_class = "LOCAL_INPUT"
    response = evaluate(
        {"packet_state": {"fwmark": 10}, "traffic_class": "TRANSIT"}
    )
    assert response.status_code == 422


def test_attachment_evidence_contains_only_security_and_used_scope_entities():
    attachment_id, policy_id, rule_id = add_attached_policy(action="PERMIT")
    artifact = evaluate().json()
    refs = {(item["entity_type"], item["entity_id"]) for item in artifact["evidence_refs"]}
    assert refs == {
        ("SecurityPolicyAttachment", str(attachment_id)),
        ("SecurityPolicy", str(policy_id)),
        ("SecurityRule", str(rule_id)),
    }
    assert not ({"Route", "L2Binding", "RoutingTable"} & {kind for kind, _ in refs})


def test_attachment_model_has_no_workspace_id_and_stage_order_is_not_unique():
    assert "workspace_id" not in SecurityPolicyAttachment.__table__.columns
    assert not any(
        constraint.name and "stage_order" in constraint.name
        for constraint in SecurityPolicyAttachment.__table__.constraints
    )
