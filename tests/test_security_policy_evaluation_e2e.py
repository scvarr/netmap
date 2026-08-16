import os

import httpx
import pytest
from sqlalchemy import text

from app.database import SessionLocal
from app.errors import ModelError, ValidationError
from app.models import SecurityRule
from app.repository import CanonicalRepository


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def evaluate(policy_id, packet_state=None):
    return httpx.post(
        f"{BASE_URL}/v1/traces/security/policy-evaluation",
        json={
            "policy_id": str(policy_id),
            "packet_state": packet_state or {},
        },
        timeout=5,
    )


def create_policy(default="DROP", completeness="COMPLETE", rules=()):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_security_policy(default, completeness)
        stored_rules = [
            repository.add_security_rule(
                policy.id, order_key, predicate, action
            )
            for order_key, predicate, action in rules
        ]
        return policy.id, [rule.id for rule in stored_rules]


def test_first_true_rule_permits_and_later_rules_are_not_evaluated():
    policy_id, rule_ids = create_policy(
        rules=(
            (10, {"op": "TRUE"}, "PERMIT"),
            (20, {"op": "TRUE"}, "DROP"),
        )
    )

    artifact = evaluate(policy_id).json()

    assert artifact["result"] == "PERMIT"
    assert [step["rule_id"] for step in artifact["branches"][0]["steps"]] == [
        str(rule_ids[0])
    ]
    assert str(rule_ids[1]) not in {
        ref["entity_id"] for ref in artifact["evidence_refs"]
    }


def test_first_false_then_true_drop():
    policy_id, _ = create_policy(
        default="PERMIT",
        rules=(
            (10, {"op": "FALSE"}, "REJECT"),
            (30, {"op": "TRUE"}, "DROP"),
        ),
    )

    artifact = evaluate(policy_id).json()

    assert artifact["result"] == "DROP"
    assert [step["predicate_result"] for step in artifact["branches"][0]["steps"]] == [
        "FALSE",
        "TRUE",
    ]


def test_rules_are_evaluated_by_order_key_not_insert_order():
    policy_id, rule_ids = create_policy(
        rules=(
            (200, {"op": "TRUE"}, "DROP"),
            (10, {"op": "TRUE"}, "PERMIT"),
        )
    )

    artifact = evaluate(policy_id).json()

    assert artifact["result"] == "PERMIT"
    assert artifact["branches"][0]["steps"][0]["rule_id"] == str(rule_ids[1])


@pytest.mark.parametrize("default", ["PERMIT", "DROP", "REJECT"])
def test_all_false_uses_explicit_default(default):
    policy_id, _ = create_policy(
        default=default, rules=((50, {"op": "FALSE"}, "PERMIT"),)
    )

    artifact = evaluate(policy_id).json()

    assert artifact["result"] == default
    branch = artifact["branches"][0]
    assert branch["terminal_source"] == "DEFAULT"
    assert branch["terminal_action"] == default


def test_reject_is_distinct_from_drop():
    policy_id, _ = create_policy(
        rules=((10, {"op": "TRUE"}, "REJECT"),)
    )
    assert evaluate(policy_id).json()["result"] == "REJECT"


@pytest.mark.parametrize(
    ("early_action", "later_action", "expected"),
    [
        ("DROP", "PERMIT", "UNKNOWN"),
        ("PERMIT", "PERMIT", "PERMIT"),
        ("DROP", "DROP", "DROP"),
    ],
)
def test_unknown_early_rule_branches_and_collapses_by_terminal_actions(
    early_action, later_action, expected
):
    policy_id, _ = create_policy(
        default=later_action,
        rules=(
            (
                10,
                {"op": "DESTINATION_PORT_IN", "ranges": [{"start": 22, "end": 22}]},
                early_action,
            ),
            (20, {"op": "TRUE"}, later_action),
        ),
    )

    artifact = evaluate(policy_id).json()

    assert artifact["result"] == expected
    assert len(artifact["branches"]) == 2
    assert {branch["steps"][0]["branch_assumption"] for branch in artifact["branches"]} == {
        "MATCH",
        "NO_MATCH",
    }


@pytest.mark.parametrize(
    ("predicate", "expected"),
    [
        ({"op": "NOT", "child": {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}}, "UNKNOWN"),
        ({"op": "ALL", "children": [{"op": "FALSE"}, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}]}, "FALSE"),
        ({"op": "ALL", "children": [{"op": "TRUE"}, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}]}, "UNKNOWN"),
        ({"op": "ANY", "children": [{"op": "TRUE"}, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}]}, "TRUE"),
        ({"op": "ANY", "children": [{"op": "FALSE"}, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}]}, "UNKNOWN"),
    ],
)
def test_three_valued_boolean_algebra(predicate, expected):
    policy_id, _ = create_policy(
        default="PERMIT", rules=((10, predicate, "DROP"),)
    )

    artifact = evaluate(policy_id).json()

    assert artifact["branches"][0]["steps"][0]["predicate_result"] == expected


@pytest.mark.parametrize(
    ("predicate", "packet", "expected"),
    [
        ({"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}, {}, "UNKNOWN"),
        ({"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}, {"source_ip": "10.1.2.3"}, "TRUE"),
        ({"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}, {"source_ip": "2001:db8::1"}, "FALSE"),
        ({"op": "IP_PROTOCOL_IN", "values": [6, 17]}, {"ip_protocol": 17}, "TRUE"),
        ({"op": "SOURCE_PORT_IN", "ranges": [{"start": 1000, "end": 2000}]}, {"source_port": 1500}, "TRUE"),
        ({"op": "DESTINATION_PORT_IN", "ranges": [{"start": 443, "end": 443}]}, {"destination_port": 80}, "FALSE"),
        ({"op": "DESTINATION_PORT_IN", "ranges": [{"start": 443, "end": 443}]}, {}, "UNKNOWN"),
        ({"op": "ICMP_TYPE_IN", "values": [8]}, {"icmp_type": 8}, "TRUE"),
        ({"op": "ICMP_CODE_IN", "values": [0]}, {"icmp_code": 1}, "FALSE"),
    ],
)
def test_leaf_predicates(predicate, packet, expected):
    policy_id, _ = create_policy(
        default="PERMIT", rules=((10, predicate, "DROP"),)
    )

    artifact = evaluate(policy_id, packet).json()

    assert artifact["branches"][0]["steps"][0]["predicate_result"] == expected


def test_prefix_is_canonicalized_on_write():
    policy_id, rule_ids = create_policy(
        rules=((10, {"op": "SOURCE_IP_IN", "prefixes": ["10.1.2.3/8"]}, "PERMIT"),)
    )
    with SessionLocal() as session:
        rule = session.get(SecurityRule, rule_ids[0])
        assert rule is not None
        assert rule.predicate["prefixes"] == ["10.0.0.0/8"]
    assert evaluate(policy_id, {"source_ip": "10.9.8.7"}).json()["result"] == "PERMIT"


def test_duplicate_order_key_is_rejected_but_same_key_in_other_policy_is_allowed():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy_a = repository.add_security_policy("DROP", "COMPLETE")
        policy_b = repository.add_security_policy("DROP", "COMPLETE")
        repository.add_security_rule(policy_a.id, 10, {"op": "TRUE"}, "PERMIT")
        repository.add_security_rule(policy_b.id, 10, {"op": "TRUE"}, "PERMIT")
        with pytest.raises(ValidationError):
            repository.add_security_rule(policy_a.id, 10, {"op": "FALSE"}, "DROP")


@pytest.mark.parametrize(
    "predicate",
    [
        {"op": "SOURCE_IP_IN", "prefixes": ["not-a-prefix"]},
        {"op": "IP_PROTOCOL_IN", "values": [256]},
        {"op": "SOURCE_PORT_IN", "ranges": [{"start": -1, "end": 80}]},
        {"op": "DESTINATION_PORT_IN", "ranges": [{"start": 100, "end": 99}]},
        {"op": "UNSUPPORTED"},
    ],
)
def test_invalid_predicate_is_rejected_on_write(predicate):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_security_policy("DROP", "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_security_rule(policy.id, 10, predicate, "PERMIT")


def test_corrupt_predicate_is_model_error_through_endpoint():
    policy_id, rule_ids = create_policy(
        rules=((10, {"op": "TRUE"}, "PERMIT"),)
    )
    with SessionLocal.begin() as session:
        session.execute(
            text(
                "UPDATE security_rules SET predicate = "
                "'{\"op\": \"IP_PROTOCOL_IN\", \"values\": [999]}'::jsonb "
                "WHERE id = :id"
            ),
            {"id": rule_ids[0]},
        )

    response = evaluate(policy_id)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_noncanonical_stored_prefix_is_model_error_through_endpoint():
    policy_id, rule_ids = create_policy(
        rules=((10, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}, "PERMIT"),)
    )
    with SessionLocal.begin() as session:
        session.execute(
            text(
                "UPDATE security_rules SET predicate = "
                "'{\"op\": \"SOURCE_IP_IN\", \"prefixes\": [\"10.1.2.3/8\"]}'::jsonb "
                "WHERE id = :id"
            ),
            {"id": rule_ids[0]},
        )

    response = evaluate(policy_id, {"source_ip": "10.1.2.3"})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_repository_rejects_invalid_actions_and_completeness():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        with pytest.raises(ValidationError):
            repository.add_security_policy("ALLOW", "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_security_policy("PERMIT", "STALE")
        policy = repository.add_security_policy("DROP", "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_security_rule(
                policy.id, 10, {"op": "TRUE"}, "ALLOW"
            )


@pytest.mark.parametrize(
    ("table", "constraint", "column", "value"),
    [
        (
            "security_policies",
            "ck_security_policies_default_action_valid",
            "default_action",
            "ALLOW",
        ),
        (
            "security_policies",
            "ck_security_policies_configured_completeness_valid",
            "configured_completeness",
            "STALE",
        ),
        (
            "security_rules",
            "ck_security_rules_action_valid",
            "action",
            "ALLOW",
        ),
    ],
)
def test_corrupt_action_or_completeness_is_model_error_at_read_boundary(
    table, constraint, column, value
):
    policy_id, rule_ids = create_policy(
        rules=((10, {"op": "TRUE"}, "PERMIT"),)
    )
    entity_id = policy_id if table == "security_policies" else rule_ids[0]
    session = SessionLocal()
    try:
        session.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT {constraint}"))
        session.execute(
            text(f"UPDATE {table} SET {column} = :value WHERE id = :id"),
            {"value": value, "id": entity_id},
        )
        with pytest.raises(ModelError):
            CanonicalRepository(session).get_security_policy(policy_id)
    finally:
        session.rollback()
        session.close()


@pytest.mark.parametrize("completeness", ["PARTIAL", "UNKNOWN"])
def test_incomplete_policy_is_unknown_even_with_apparent_match(completeness):
    policy_id, _ = create_policy(
        completeness=completeness,
        rules=((10, {"op": "TRUE"}, "PERMIT"),),
    )

    artifact = evaluate(policy_id).json()

    assert artifact["result"] == "UNKNOWN"
    assert artifact["gaps"][0]["code"] == "SECURITY_POLICY_INCOMPLETE"


@pytest.mark.parametrize("default", ["PERMIT", "DROP", "REJECT"])
def test_complete_empty_policy_uses_explicit_default(default):
    policy_id, _ = create_policy(default=default)

    artifact = evaluate(policy_id).json()

    assert artifact["result"] == default
    assert artifact["branches"][0]["steps"] == []
    assert artifact["branches"][0]["terminal_source"] == "DEFAULT"


def test_policy_not_found_is_validation_error():
    response = evaluate("00000000-0000-0000-0000-000000000001")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("field", ["mark", "fwmark"])
def test_packet_state_rejects_local_mark_fields(field):
    policy_id, _ = create_policy(default="PERMIT")
    response = evaluate(policy_id, {field: 42})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("ip_protocol", 256),
        ("source_port", -1),
        ("destination_port", 65536),
        ("icmp_type", 256),
        ("icmp_code", -1),
    ],
)
def test_packet_state_range_validation(field, value):
    policy_id, _ = create_policy(default="PERMIT")
    assert evaluate(policy_id, {field: value}).status_code == 422


def test_security_evidence_does_not_include_other_layers():
    policy_id, _ = create_policy(
        rules=((10, {"op": "TRUE"}, "PERMIT"),)
    )
    artifact = evaluate(policy_id).json()
    assert {ref["entity_type"] for ref in artifact["evidence_refs"]} == {
        "SecurityPolicy",
        "SecurityRule",
    }
