import inspect
import os
import uuid

import httpx
import pytest
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import text

from app.database import SessionLocal
from app.errors import ValidationError
from app.models import NATPolicy, NATRule
from app.nat_resolver import ConfiguredNATPolicyResolver
from app import packet_predicates, security_predicates
from app.repository import CanonicalRepository
from app.schemas import (
    EvaluationView,
    NATPolicyEvaluationArtifact,
    NATPolicyEvaluationQuery,
    PacketState,
)


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def identity():
    return {"op": "IDENTITY"}


def transform(**fields):
    return {
        "op": "TRANSFORM",
        **{
            field: {"op": "REPLACE_EXACT", "value": value}
            for field, value in fields.items()
        },
    }


def create_policy(default=None, completeness="COMPLETE", rules=()):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_nat_policy(
            default or identity(), completeness
        )
        stored_rules = [
            repository.add_nat_rule(
                policy.id, order_key, predicate, rule_transform
            )
            for order_key, predicate, rule_transform in rules
        ]
        return policy.id, [rule.id for rule in stored_rules]


def evaluate(policy_id, packet_state=None):
    return httpx.post(
        f"{BASE_URL}/v1/traces/nat/policy-evaluation",
        json={"policy_id": str(policy_id), "packet_state": packet_state or {}},
        timeout=5,
    )


def first_step(artifact):
    return artifact["branches"][0]["steps"][0]


@pytest.mark.parametrize(
    ("default", "expected", "packet_after"),
    [
        (identity(), "IDENTITY", {"source_ip": "10.0.0.10"}),
        (
            transform(source_ip="203.0.113.5"),
            "TRANSFORMED_EXACT",
            {"source_ip": "203.0.113.5"},
        ),
    ],
)
def test_complete_empty_policy_uses_explicit_default(
    default, expected, packet_after
):
    policy_id, _ = create_policy(default=default)
    artifact = evaluate(policy_id, {"source_ip": "10.0.0.10"}).json()
    assert artifact["result"] == expected
    assert artifact["packet_after"]["source_ip"] == packet_after["source_ip"]
    assert artifact["branches"][0]["terminal_source"] == "DEFAULT"
    assert artifact["branches"][0]["selected_transform"] == default


@pytest.mark.parametrize(
    ("rule_transform", "expected_changes"),
    [
        (transform(source_ip="203.0.113.5"), {"source_ip": "203.0.113.5"}),
        (transform(destination_ip="10.0.0.10"), {"destination_ip": "10.0.0.10"}),
        (
            transform(destination_ip="10.0.0.10", destination_port=443),
            {"destination_ip": "10.0.0.10", "destination_port": 443},
        ),
        (
            transform(source_ip="203.0.113.5", source_port=40000),
            {"source_ip": "203.0.113.5", "source_port": 40000},
        ),
        (
            transform(source_ip="203.0.113.5", destination_ip="10.0.0.10"),
            {"source_ip": "203.0.113.5", "destination_ip": "10.0.0.10"},
        ),
    ],
)
def test_true_rule_applies_exact_transform_and_preserves_other_fields(
    rule_transform, expected_changes
):
    policy_id, _ = create_policy(
        rules=((10, {"op": "TRUE"}, rule_transform),)
    )
    before = {
        "source_ip": "10.0.0.10",
        "destination_ip": "198.51.100.20",
        "ip_protocol": 6,
        "source_port": 12345,
        "destination_port": 8443,
        "icmp_type": 8,
        "icmp_code": 0,
    }
    artifact = evaluate(policy_id, before).json()
    expected = {**before, **expected_changes}
    assert artifact["result"] == "TRANSFORMED_EXACT"
    assert artifact["packet_before"] == before
    assert artifact["packet_after"] == expected
    assert artifact["branches"][0]["terminal_source"] == "RULE"


def test_false_rule_continues_to_true_second_rule():
    policy_id, rule_ids = create_policy(
        rules=(
            (10, {"op": "FALSE"}, transform(source_ip="192.0.2.1")),
            (20, {"op": "TRUE"}, transform(source_ip="203.0.113.5")),
        )
    )
    artifact = evaluate(policy_id, {"source_ip": "10.0.0.1"}).json()
    assert artifact["packet_after"]["source_ip"] == "203.0.113.5"
    assert [step["predicate_result"] for step in artifact["branches"][0]["steps"]] == [
        "FALSE",
        "TRUE",
    ]
    assert artifact["branches"][0]["terminal_rule_id"] == str(rule_ids[1])


@pytest.mark.parametrize(
    ("first_transform", "expected_result", "expected_source"),
    [
        (transform(source_ip="203.0.113.5"), "TRANSFORMED_EXACT", "203.0.113.5"),
        (identity(), "IDENTITY", "10.0.0.1"),
    ],
)
def test_true_first_rule_including_identity_shadows_later_translation(
    first_transform, expected_result, expected_source
):
    policy_id, rule_ids = create_policy(
        rules=(
            (10, {"op": "TRUE"}, first_transform),
            (20, {"op": "TRUE"}, transform(source_ip="192.0.2.1")),
        )
    )
    artifact = evaluate(policy_id, {"source_ip": "10.0.0.1"}).json()
    assert artifact["result"] == expected_result
    assert artifact["packet_after"]["source_ip"] == expected_source
    assert len(artifact["branches"][0]["steps"]) == 1
    assert str(rule_ids[1]) not in {
        ref["entity_id"] for ref in artifact["evidence_refs"]
    }


def test_all_false_uses_explicit_default_transform():
    policy_id, _ = create_policy(
        default=transform(destination_port=443),
        rules=((10, {"op": "FALSE"}, transform(destination_port=80)),),
    )
    artifact = evaluate(policy_id, {"destination_port": 8443}).json()
    assert artifact["packet_after"]["destination_port"] == 443
    assert artifact["branches"][0]["terminal_source"] == "DEFAULT"


@pytest.mark.parametrize(
    ("early", "default", "expected", "expected_source"),
    [
        (transform(source_ip="203.0.113.5"), identity(), "UNKNOWN", None),
        (identity(), identity(), "IDENTITY", "10.0.0.1"),
        (
            transform(source_ip="203.0.113.5"),
            transform(source_ip="203.0.113.5"),
            "TRANSFORMED_EXACT",
            "203.0.113.5",
        ),
        (
            transform(source_ip="203.0.113.5"),
            transform(source_ip="192.0.2.5"),
            "UNKNOWN",
            None,
        ),
    ],
)
def test_unknown_predicate_branches_aggregate_by_exact_output_packet(
    early, default, expected, expected_source
):
    policy_id, _ = create_policy(
        default=default,
        rules=(
            (
                10,
                {
                    "op": "DESTINATION_PORT_IN",
                    "ranges": [{"start": 443, "end": 443}],
                },
                early,
            ),
        ),
    )
    artifact = evaluate(policy_id, {"source_ip": "10.0.0.1"}).json()
    assert artifact["result"] == expected
    assert len(artifact["branches"]) == 2
    assert {branch["steps"][0]["branch_assumption"] for branch in artifact["branches"]} == {
        "MATCH",
        "NO_MATCH",
    }
    if expected_source is None:
        assert artifact["packet_after"] is None
        assert artifact["gaps"][0]["code"] == "NAT_TRANSLATION_UNKNOWN"
    else:
        assert artifact["packet_after"]["source_ip"] == expected_source


@pytest.mark.parametrize("completeness", ["PARTIAL", "UNKNOWN"])
def test_incomplete_policy_is_unknown_even_with_apparent_exact_match(completeness):
    policy_id, _ = create_policy(
        completeness=completeness,
        rules=((10, {"op": "TRUE"}, transform(source_ip="203.0.113.5")),),
    )
    artifact = evaluate(policy_id, {"source_ip": "10.0.0.1"}).json()
    assert artifact["result"] == "UNKNOWN"
    assert artifact["packet_after"] is None
    assert artifact["gaps"][0]["code"] == "NAT_POLICY_INCOMPLETE"


@pytest.mark.parametrize(
    ("predicate", "packet", "expected"),
    [
        ({"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}, {"source_ip": "10.1.2.3"}, "TRUE"),
        ({"op": "DESTINATION_IP_IN", "prefixes": ["192.0.2.0/24"]}, {"destination_ip": "198.51.100.1"}, "FALSE"),
        ({"op": "IP_PROTOCOL_IN", "values": [6]}, {"ip_protocol": 6}, "TRUE"),
        ({"op": "SOURCE_PORT_IN", "ranges": [{"start": 1000, "end": 2000}]}, {"source_port": 1500}, "TRUE"),
        ({"op": "DESTINATION_PORT_IN", "ranges": [{"start": 443, "end": 443}]}, {"destination_port": 80}, "FALSE"),
        ({"op": "NOT", "child": {"op": "FALSE"}}, {}, "TRUE"),
        ({"op": "ALL", "children": [{"op": "TRUE"}, {"op": "TRUE"}]}, {}, "TRUE"),
        ({"op": "ANY", "children": [{"op": "FALSE"}, {"op": "TRUE"}]}, {}, "TRUE"),
    ],
)
def test_nat_reuses_shared_packet_predicates(predicate, packet, expected):
    policy_id, _ = create_policy(
        rules=((10, predicate, transform(source_ip="203.0.113.5")),)
    )
    artifact = evaluate(policy_id, packet).json()
    assert first_step(artifact)["predicate_result"] == expected


def test_connection_state_predicate_is_unknown_for_standalone_nat():
    policy_id, _ = create_policy(
        rules=(
            (
                10,
                {"op": "CONNECTION_STATE_IN", "values": ["NEW"]},
                transform(source_ip="203.0.113.5"),
            ),
        )
    )
    artifact = evaluate(policy_id, {"source_ip": "10.0.0.1"}).json()
    assert artifact["result"] == "UNKNOWN"
    assert first_step(artifact)["predicate_result"] == "UNKNOWN"


def test_ip_transform_is_canonicalized_on_write():
    policy_id, _ = create_policy(
        default=transform(destination_ip="2001:0DB8:0:0:0:0:0:1")
    )
    with SessionLocal() as session:
        policy = session.get(NATPolicy, policy_id)
        assert policy is not None
        assert policy.default_transform["destination_ip"]["value"] == "2001:db8::1"


@pytest.mark.parametrize(
    "invalid_transform",
    [
        transform(source_ip="not-an-ip"),
        transform(destination_ip="192.0.2.0/24"),
        transform(source_port=-1),
        transform(destination_port=65536),
        transform(source_port=True),
        {"op": "SELECT_FROM"},
        {"op": "TRANSFORM"},
        {"op": "TRANSFORM", "ip_protocol": {"op": "REPLACE_EXACT", "value": 17}},
        {"op": "TRANSFORM", "source_ip": {"op": "MAP", "value": "192.0.2.1"}},
    ],
)
def test_invalid_or_unsupported_transform_is_rejected(invalid_transform):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        with pytest.raises(ValidationError):
            repository.add_nat_policy(invalid_transform, "COMPLETE")


def test_nat_rule_order_key_invariants():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy_a = repository.add_nat_policy(identity(), "COMPLETE")
        policy_b = repository.add_nat_policy(identity(), "COMPLETE")
        repository.add_nat_rule(policy_a.id, 10, {"op": "TRUE"}, identity())
        repository.add_nat_rule(policy_b.id, 10, {"op": "TRUE"}, identity())
        with pytest.raises(ValidationError):
            repository.add_nat_rule(policy_a.id, 10, {"op": "FALSE"}, identity())


def test_malformed_predicate_is_rejected_by_shared_validator():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_nat_policy(identity(), "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_nat_rule(
                policy.id,
                10,
                {"op": "IP_PROTOCOL_IN", "values": [999]},
                identity(),
            )


@pytest.mark.parametrize(
    ("column", "stored_json"),
    [
        ("transform", '{"op":"TRANSFORM","source_port":{"op":"REPLACE_EXACT","value":70000}}'),
        ("transform", '{"op":"TRANSFORM","destination_ip":{"op":"REPLACE_EXACT","value":"2001:0DB8:0:0:0:0:0:1"}}'),
        ("predicate", '{"op":"IP_PROTOCOL_IN","values":[999]}'),
    ],
)
def test_corrupt_rule_json_is_model_error_at_endpoint(column, stored_json):
    policy_id, rule_ids = create_policy(
        rules=((10, {"op": "TRUE"}, identity()),)
    )
    with SessionLocal.begin() as session:
        session.execute(
            text(
                f"UPDATE nat_rules SET {column} = CAST(:payload AS jsonb) WHERE id = :id"
            ),
            {"payload": stored_json, "id": rule_ids[0]},
        )
    response = evaluate(policy_id)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_policy_not_found_is_validation_error():
    response = evaluate(uuid.UUID("00000000-0000-0000-0000-000000000001"))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_input_packet_is_not_mutated_and_output_packet_is_frozen():
    policy_id, _ = create_policy(
        rules=((10, {"op": "TRUE"}, transform(source_ip="203.0.113.5")),)
    )
    packet = PacketState(
        source_ip="10.0.0.1", destination_ip="198.51.100.1", ip_protocol=6
    )
    before_dump = packet.model_dump()
    with SessionLocal() as session:
        artifact = ConfiguredNATPolicyResolver(CanonicalRepository(session)).resolve(
            NATPolicyEvaluationQuery(policy_id=policy_id, packet_state=packet),
            EvaluationView(),
        )
    assert packet.model_dump() == before_dump
    assert artifact.packet_before is packet
    assert artifact.packet_after is not packet
    assert str(artifact.packet_after.source_ip) == "203.0.113.5"
    with pytest.raises(PydanticValidationError):
        artifact.packet_after.source_ip = "192.0.2.1"


def test_artifact_evidence_is_nat_only():
    policy_id, rule_ids = create_policy(
        rules=((10, {"op": "TRUE"}, identity()),)
    )
    artifact = evaluate(policy_id).json()
    assert {(ref["entity_type"], ref["entity_id"]) for ref in artifact["evidence_refs"]} == {
        ("NATPolicy", str(policy_id)),
        ("NATRule", str(rule_ids[0])),
    }


def test_nat_domain_and_resolver_have_no_workspace_cache_or_random_allocation():
    assert "workspace_id" not in NATPolicy.__table__.columns
    assert "workspace_id" not in NATRule.__table__.columns
    source = inspect.getsource(ConfiguredNATPolicyResolver).lower()
    for forbidden in (
        "sessionlocal",
        "create_engine",
        "workspace",
        "cache",
        "random",
        "select_from",
    ):
        assert forbidden not in source


def test_security_compatibility_module_reexports_the_shared_predicate_core():
    assert security_predicates.normalize_predicate is packet_predicates.normalize_predicate
    assert security_predicates.evaluate_predicate is packet_predicates.evaluate_predicate


def test_nat_artifact_round_trip_keeps_packet_states_immutable():
    policy_id, _ = create_policy(default=identity())
    artifact = NATPolicyEvaluationArtifact.model_validate(
        evaluate(policy_id, {"source_ip": "10.0.0.1"}).json()
    )
    with pytest.raises(PydanticValidationError):
        artifact.packet_after.source_ip = "192.0.2.1"
