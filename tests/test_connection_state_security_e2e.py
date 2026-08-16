import os

import httpx
import pytest
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select, text

from app.database import SessionLocal
from app.errors import ValidationError
from app.models import SecurityPolicy, SecurityPolicyAttachment, SecurityRule
from app.repository import CanonicalRepository
from app.schemas import PacketState, SecurityEvaluationContext


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def create_policy(
    predicate,
    action="PERMIT",
    *,
    default="DROP",
    later_action=None,
    attached=True,
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_security_policy(default, "COMPLETE")
        first = repository.add_security_rule(policy.id, 10, predicate, action)
        if later_action is not None:
            repository.add_security_rule(
                policy.id, 20, {"op": "TRUE"}, later_action
            )
        if attached:
            repository.add_security_policy_attachment(policy.id, 10, {})
        return policy.id, first.id


def evaluate_stages(connection_state="OMITTED", packet_state=None):
    context = {
        "packet_state": packet_state or {},
        "traffic_class": "TRANSIT",
    }
    if connection_state != "OMITTED":
        context["connection_state"] = connection_state
    return httpx.post(
        f"{BASE_URL}/v1/traces/security/evaluation",
        json={
            "context": context,
            "configured_attachment_completeness": "COMPLETE",
        },
        timeout=5,
    )


def evaluate_policy(policy_id, packet_state=None):
    return httpx.post(
        f"{BASE_URL}/v1/traces/security/policy-evaluation",
        json={"policy_id": str(policy_id), "packet_state": packet_state or {}},
        timeout=5,
    )


def nested_policy(artifact):
    return artifact["attachment_evaluations"][0]["policy_evaluation"]


@pytest.mark.parametrize(
    ("values", "runtime_state", "predicate_result", "policy_result"),
    [
        (["NEW"], "NEW", "TRUE", "PERMIT"),
        (["NEW"], "ESTABLISHED", "FALSE", "DROP"),
        (["ESTABLISHED", "RELATED"], "ESTABLISHED", "TRUE", "PERMIT"),
        (["ESTABLISHED", "RELATED"], "RELATED", "TRUE", "PERMIT"),
        (["ESTABLISHED", "RELATED"], "NEW", "FALSE", "DROP"),
    ],
)
def test_connection_state_leaf_exact_set_semantics(
    values, runtime_state, predicate_result, policy_result
):
    create_policy({"op": "CONNECTION_STATE_IN", "values": values})
    policy = nested_policy(evaluate_stages(runtime_state).json())
    assert policy["branches"][0]["steps"][0]["predicate_result"] == predicate_result
    assert policy["result"] == policy_result


@pytest.mark.parametrize("runtime_state", ["OMITTED", None, "UNKNOWN"])
def test_missing_null_and_explicit_unknown_state_are_predicate_unknown(runtime_state):
    create_policy(
        {"op": "CONNECTION_STATE_IN", "values": ["ESTABLISHED"]},
        action="PERMIT",
        default="DROP",
    )
    policy = nested_policy(evaluate_stages(runtime_state).json())
    assert policy["result"] == "UNKNOWN"
    assert len(policy["branches"]) == 2
    assert {
        branch["steps"][0]["branch_assumption"] for branch in policy["branches"]
    } == {"MATCH", "NO_MATCH"}
    assert all(
        branch["steps"][0]["predicate_result"] == "UNKNOWN"
        for branch in policy["branches"]
    )


@pytest.mark.parametrize(
    ("runtime_state", "expected"),
    [("ESTABLISHED", "PASS"), ("NEW", "BLOCKED"), ("OMITTED", "UNKNOWN")],
)
def test_stateful_first_match_flows_through_stage_aggregation(runtime_state, expected):
    create_policy(
        {
            "op": "CONNECTION_STATE_IN",
            "values": ["ESTABLISHED", "RELATED"],
        },
        action="PERMIT",
        later_action="DROP",
    )
    artifact = evaluate_stages(runtime_state).json()
    assert artifact["result"] == expected


@pytest.mark.parametrize(
    ("early_action", "later_action", "expected"),
    [("PERMIT", "PERMIT", "PASS"), ("DROP", "PERMIT", "UNKNOWN")],
)
def test_unknown_state_rule_keeps_existing_branch_collapse(
    early_action, later_action, expected
):
    create_policy(
        {"op": "CONNECTION_STATE_IN", "values": ["ESTABLISHED"]},
        action=early_action,
        default=later_action,
        later_action=later_action,
    )
    artifact = evaluate_stages().json()
    assert artifact["result"] == expected


@pytest.mark.parametrize(
    ("predicate", "packet", "expected"),
    [
        (
            {
                "op": "ALL",
                "children": [
                    {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]},
                    {"op": "CONNECTION_STATE_IN", "values": ["NEW"]},
                ],
            },
            {"source_ip": "192.0.2.1"},
            "FALSE",
        ),
        (
            {
                "op": "ALL",
                "children": [
                    {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]},
                    {"op": "CONNECTION_STATE_IN", "values": ["NEW"]},
                ],
            },
            {"source_ip": "10.1.2.3"},
            "UNKNOWN",
        ),
        (
            {
                "op": "ANY",
                "children": [
                    {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]},
                    {"op": "CONNECTION_STATE_IN", "values": ["NEW"]},
                ],
            },
            {"source_ip": "10.1.2.3"},
            "TRUE",
        ),
        (
            {
                "op": "NOT",
                "child": {"op": "CONNECTION_STATE_IN", "values": ["NEW"]},
            },
            {},
            "UNKNOWN",
        ),
    ],
)
def test_connection_state_composes_with_existing_three_valued_algebra(
    predicate, packet, expected
):
    create_policy(predicate, action="DROP", default="PERMIT")
    policy = nested_policy(evaluate_stages(packet_state=packet).json())
    assert policy["branches"][0]["steps"][0]["predicate_result"] == expected


def test_standalone_m51_stateful_rule_has_unavailable_state_not_validation_error():
    policy_id, _ = create_policy(
        {"op": "CONNECTION_STATE_IN", "values": ["ESTABLISHED"]},
        action="PERMIT",
        default="DROP",
        attached=False,
    )
    response = evaluate_policy(policy_id)
    artifact = response.json()
    assert response.status_code == 200
    assert artifact["result"] == "UNKNOWN"
    assert artifact["branches"][0]["steps"][0]["predicate_result"] == "UNKNOWN"
    assert "connection_state" not in artifact["query"]["packet_state"]


@pytest.mark.parametrize(
    "predicate",
    [
        {"op": "CONNECTION_STATE_IN", "values": []},
        {"op": "CONNECTION_STATE_IN", "values": ["UNKNOWN"]},
        {"op": "CONNECTION_STATE_IN", "values": ["UNTRACKED"]},
        {"op": "CONNECTION_STATE_IN", "values": [1]},
    ],
)
def test_invalid_connection_state_predicate_is_rejected_on_write(predicate):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_security_policy("DROP", "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_security_rule(policy.id, 10, predicate, "PERMIT")


def test_connection_state_values_are_deduplicated_in_canonical_enum_order():
    policy_id, rule_id = create_policy(
        {
            "op": "CONNECTION_STATE_IN",
            "values": ["RELATED", "ESTABLISHED", "RELATED"],
        },
        attached=False,
    )
    with SessionLocal() as session:
        rule = session.get(SecurityRule, rule_id)
        assert rule is not None
        assert rule.predicate == {
            "op": "CONNECTION_STATE_IN",
            "values": ["ESTABLISHED", "RELATED"],
        }
    assert evaluate_policy(policy_id).status_code == 200


def test_noncanonical_stored_connection_state_predicate_is_model_error():
    policy_id, rule_id = create_policy(
        {
            "op": "CONNECTION_STATE_IN",
            "values": ["ESTABLISHED", "RELATED"],
        },
        attached=False,
    )
    with SessionLocal.begin() as session:
        session.execute(
            text(
                "UPDATE security_rules SET predicate = "
                "'{\"op\": \"CONNECTION_STATE_IN\", "
                "\"values\": [\"RELATED\", \"ESTABLISHED\"]}'::jsonb "
                "WHERE id = :id"
            ),
            {"id": rule_id},
        )
    response = evaluate_policy(policy_id)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_connection_state_is_context_only_and_context_remains_frozen():
    assert "connection_state" not in PacketState.model_fields
    packet_response = evaluate_policy(
        create_policy({"op": "TRUE"}, attached=False)[0],
        {"connection_state": "NEW"},
    )
    assert packet_response.status_code == 422
    for field in ("mark", "fwmark"):
        response = evaluate_policy(
            create_policy({"op": "TRUE"}, attached=False)[0], {field: 10}
        )
        assert response.status_code == 422
    context = SecurityEvaluationContext(
        packet_state=PacketState(),
        traffic_class="TRANSIT",
        connection_state="NEW",
    )
    with pytest.raises(PydanticValidationError):
        context.connection_state = "ESTABLISHED"


def test_security_evaluation_is_read_only_and_does_not_infer_reverse_state():
    create_policy(
        {"op": "CONNECTION_STATE_IN", "values": ["NEW"]},
        action="PERMIT",
        default="DROP",
    )
    with SessionLocal() as session:
        before = tuple(
            session.scalar(select(func.count()).select_from(model))
            for model in (SecurityPolicy, SecurityRule, SecurityPolicyAttachment)
        )

    forward = evaluate_stages("NEW").json()
    reverse_without_state = evaluate_stages().json()

    with SessionLocal() as session:
        after = tuple(
            session.scalar(select(func.count()).select_from(model))
            for model in (SecurityPolicy, SecurityRule, SecurityPolicyAttachment)
        )
    assert forward["result"] == "PASS"
    assert reverse_without_state["result"] == "UNKNOWN"
    assert before == after
