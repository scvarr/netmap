import inspect
import os
import uuid

import httpx
import pytest
from sqlalchemy import text

from app.database import SessionLocal
from app.errors import ModelError, ValidationError
from app.models import NATPool
from app.nat_evaluation_resolver import ConfiguredNATEvaluationResolver
from app.nat_resolver import ConfiguredNATPolicyResolver
from app.nat_transforms import apply_nat_transform
from app.repository import CanonicalRepository


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def identity():
    return {"op": "IDENTITY"}


def select_from(pool_id):
    return {"op": "SELECT_FROM", "pool_id": str(pool_id)}


def transform(**fields):
    return {"op": "TRANSFORM", **fields}


def replace(value):
    return {"op": "REPLACE_EXACT", "value": value}


def policy_evaluate(policy_id, packet=None):
    return httpx.post(
        f"{BASE_URL}/v1/traces/nat/policy-evaluation",
        json={"policy_id": str(policy_id), "packet_state": packet or {}},
        timeout=5,
    )


def stages_evaluate(packet=None, **context):
    return httpx.post(
        f"{BASE_URL}/v1/traces/nat/evaluation",
        json={
            "context": {
                "packet_state": packet or {},
                "traffic_class": "TRANSIT",
                **context,
            },
            "configured_attachment_completeness": "COMPLETE",
        },
        timeout=5,
    )


def add_policy(*, default=None, rules=(), completeness="COMPLETE", attach=None):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_nat_policy(default or identity(), completeness)
        rule_ids = []
        for order_key, predicate, rule_transform in rules:
            rule_ids.append(
                repository.add_nat_rule(
                    policy.id, order_key, predicate, rule_transform
                ).id
            )
        attachment_id = None
        if attach is not None:
            stage_order, scope = attach
            attachment_id = repository.add_nat_policy_attachment(
                policy.id, stage_order, scope
            ).id
        return policy.id, rule_ids, attachment_id


def add_pool(*, addresses=None, ports=None):
    with SessionLocal.begin() as session:
        return CanonicalRepository(session).add_nat_pool(
            address_ranges=addresses,
            port_ranges=ports,
        ).id


def test_address_port_and_combined_pools_are_canonical():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        address_pool = repository.add_nat_pool(
            address_ranges=[
                {"start": "203.0.113.15", "end": "203.0.113.30"},
                {"start": "203.0.113.10", "end": "203.0.113.20"},
                {"start": "203.0.113.31", "end": "203.0.113.31"},
            ]
        )
        port_pool = repository.add_nat_pool(
            port_ranges=[
                {"start": 40010, "end": 40020},
                {"start": 40000, "end": 40009},
                {"start": 40015, "end": 40030},
            ]
        )
        combined = repository.add_nat_pool(
            address_ranges=[{"start": "192.0.2.1", "end": "192.0.2.1"}],
            port_ranges=[{"start": 443, "end": 443}],
        )

        address_record = repository.get_nat_pool(address_pool.id)
        port_record = repository.get_nat_pool(port_pool.id)
        combined_record = repository.get_nat_pool(combined.id)
        assert address_record.address_ranges == (
            {"start": "203.0.113.10", "end": "203.0.113.31"},
        )
        assert address_record.port_ranges == ()
        assert port_record.port_ranges == ({"start": 40000, "end": 40030},)
        assert port_record.address_ranges == ()
        assert combined_record.address_ranges and combined_record.port_ranges


def test_ipv6_ranges_canonicalize_merge_and_remain_separate_from_ipv4():
    pool_id = add_pool(
        addresses=[
            {"start": "2001:0DB8::2", "end": "2001:db8::3"},
            {"start": "2001:db8::1", "end": "2001:db8::1"},
            {"start": "192.0.2.1", "end": "192.0.2.2"},
        ]
    )
    with SessionLocal.begin() as session:
        record = CanonicalRepository(session).get_nat_pool(pool_id)
    assert record.address_ranges == (
        {"start": "192.0.2.1", "end": "192.0.2.2"},
        {"start": "2001:db8::1", "end": "2001:db8::3"},
    )


@pytest.mark.parametrize(
    ("addresses", "ports"),
    [
        ([], []),
        ([{"start": "192.0.2.1", "end": "2001:db8::1"}], []),
        ([{"start": "192.0.2.2", "end": "192.0.2.1"}], []),
        ([], [{"start": -1, "end": 10}]),
        ([], [{"start": 10, "end": 70000}]),
        ([], [{"start": True, "end": 10}]),
    ],
)
def test_invalid_or_empty_pool_is_rejected(addresses, ports):
    with SessionLocal.begin() as session:
        with pytest.raises(ValidationError):
            CanonicalRepository(session).add_nat_pool(addresses, ports)


@pytest.mark.parametrize(
    "corrupt_addresses",
    [
        [{"start": "2001:0DB8::1", "end": "2001:0DB8::2"}],
        [
            {"start": "192.0.2.1", "end": "192.0.2.5"},
            {"start": "192.0.2.4", "end": "192.0.2.8"},
        ],
        [{"start": "not-an-ip", "end": "not-an-ip"}],
    ],
)
def test_direct_pool_corruption_is_model_error(corrupt_addresses):
    pool_id = add_pool(
        addresses=[{"start": "192.0.2.1", "end": "192.0.2.1"}]
    )
    with SessionLocal.begin() as session:
        session.execute(
            text(
                "UPDATE nat_pools SET address_ranges = CAST(:ranges AS jsonb) "
                "WHERE id = :pool_id"
            ),
            {"ranges": __import__("json").dumps(corrupt_addresses), "pool_id": pool_id},
        )
    with SessionLocal.begin() as session:
        with pytest.raises(ModelError):
            CanonicalRepository(session).get_nat_pool(pool_id)


@pytest.mark.parametrize(
    ("field", "pool_kind", "constraint_field"),
    [
        ("source_ip", "address", "source_ip_ranges"),
        ("destination_ip", "address", "destination_ip_ranges"),
        ("source_port", "port", "source_port_ranges"),
        ("destination_port", "port", "destination_port_ranges"),
    ],
)
def test_select_from_multivalue_pool_returns_constraint(
    field, pool_kind, constraint_field
):
    pool_id = (
        add_pool(addresses=[{"start": "203.0.113.10", "end": "203.0.113.20"}])
        if pool_kind == "address"
        else add_pool(ports=[{"start": 40000, "end": 60000}])
    )
    policy_id, _, _ = add_policy(
        rules=((10, {"op": "TRUE"}, transform(**{field: select_from(pool_id)})),)
    )
    artifact = policy_evaluate(
        policy_id,
        {"source_ip": "10.0.0.1", "destination_ip": "198.51.100.1"},
    ).json()
    assert artifact["result"] == "TRANSFORMED_CONSTRAINED"
    assert artifact["packet_after"] is None
    assert artifact["packet_after_constraint"][constraint_field]
    assert artifact["branches"][0]["transform_result"] == "TRANSFORMED_CONSTRAINED"
    assert {ref["entity_type"] for ref in artifact["evidence_refs"]} >= {
        "NATPolicy",
        "NATRule",
        "NATPool",
    }
    if field == "source_ip":
        assert artifact["packet_after_constraint"]["packet_base"][field] == "10.0.0.1"
    if field == "destination_ip":
        assert artifact["packet_after_constraint"]["packet_base"][field] == "198.51.100.1"


def test_multiple_select_from_fields_use_one_symbolic_constraint_without_product():
    pool_id = add_pool(
        addresses=[{"start": "203.0.113.10", "end": "203.0.113.20"}],
        ports=[{"start": 40000, "end": 60000}],
    )
    policy_id, _, _ = add_policy(
        rules=(
            (
                10,
                {"op": "TRUE"},
                transform(
                    source_ip=select_from(pool_id),
                    source_port=select_from(pool_id),
                ),
            ),
        )
    )
    artifact = policy_evaluate(policy_id).json()
    constraint = artifact["packet_after_constraint"]
    assert artifact["result"] == "TRANSFORMED_CONSTRAINED"
    assert constraint["source_ip_ranges"] == [
        {"start": "203.0.113.10", "end": "203.0.113.20"}
    ]
    assert constraint["source_port_ranges"] == [{"start": 40000, "end": 60000}]
    assert len(artifact["branches"]) == 1


def test_singleton_select_from_collapses_to_exact_for_ip_and_port():
    pool_id = add_pool(
        addresses=[{"start": "203.0.113.5", "end": "203.0.113.5"}],
        ports=[{"start": 40000, "end": 40000}],
    )
    policy_id, _, _ = add_policy(
        rules=(
            (
                10,
                {"op": "TRUE"},
                transform(
                    source_ip=select_from(pool_id),
                    source_port=select_from(pool_id),
                ),
            ),
        )
    )
    artifact = policy_evaluate(policy_id).json()
    assert artifact["result"] == "TRANSFORMED_EXACT"
    assert artifact["packet_after"]["source_ip"] == "203.0.113.5"
    assert artifact["packet_after"]["source_port"] == 40000
    assert artifact["packet_after_constraint"] is None


def test_exact_and_constrained_fields_are_separated_in_packet_constraint():
    pool_id = add_pool(ports=[{"start": 40000, "end": 60000}])
    policy_id, _, _ = add_policy(
        rules=(
            (
                10,
                {"op": "TRUE"},
                transform(
                    source_ip=replace("203.0.113.5"),
                    source_port=select_from(pool_id),
                ),
            ),
        )
    )
    artifact = policy_evaluate(
        policy_id, {"source_ip": "10.0.0.1", "source_port": 12345}
    ).json()
    constraint = artifact["packet_after_constraint"]
    assert artifact["result"] == "TRANSFORMED_CONSTRAINED"
    assert constraint["packet_base"]["source_ip"] == "203.0.113.5"
    assert constraint["packet_base"]["source_port"] == 12345
    assert constraint["source_port_ranges"] == [{"start": 40000, "end": 60000}]


@pytest.mark.parametrize(
    ("field", "pool_kwargs"),
    [
        ("source_ip", {"ports": [{"start": 1, "end": 2}]}),
        (
            "source_port",
            {"addresses": [{"start": "192.0.2.1", "end": "192.0.2.2"}]},
        ),
    ],
)
def test_select_from_requires_matching_pool_dimension(field, pool_kwargs):
    pool_id = add_pool(**pool_kwargs)
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_nat_policy(identity(), "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_nat_rule(
                policy.id,
                10,
                {"op": "TRUE"},
                transform(**{field: select_from(pool_id)}),
            )


def test_missing_pool_and_malformed_select_from_are_rejected_on_write():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_nat_policy(identity(), "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_nat_rule(
                policy.id,
                10,
                {"op": "TRUE"},
                transform(source_ip=select_from(uuid.uuid4())),
            )
        with pytest.raises(ValidationError):
            repository.add_nat_rule(
                policy.id,
                20,
                {"op": "TRUE"},
                transform(source_ip={"op": "SELECT_FROM", "values": []}),
            )


def test_dangling_pool_in_stored_transform_is_model_error():
    pool_id = add_pool(
        addresses=[{"start": "203.0.113.10", "end": "203.0.113.20"}]
    )
    policy_id, rule_ids, _ = add_policy(
        rules=((10, {"op": "TRUE"}, transform(source_ip=select_from(pool_id))),)
    )
    with SessionLocal.begin() as session:
        session.execute(
            text("DELETE FROM nat_pools WHERE id = :pool_id"), {"pool_id": pool_id}
        )
    response = policy_evaluate(policy_id)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"
    assert rule_ids


def test_unknown_select_from_vs_identity_is_unknown_and_preserves_constraint_branch():
    pool_id = add_pool(
        addresses=[{"start": "203.0.113.10", "end": "203.0.113.20"}]
    )
    policy_id, _, _ = add_policy(
        rules=(
            (
                10,
                {"op": "SOURCE_PORT_IN", "ranges": [{"start": 443, "end": 443}]},
                transform(source_ip=select_from(pool_id)),
            ),
        )
    )
    artifact = policy_evaluate(policy_id, {"source_ip": "10.0.0.1"}).json()
    assert artifact["result"] == "UNKNOWN"
    assert {branch["transform_result"] for branch in artifact["branches"]} == {
        "IDENTITY",
        "TRANSFORMED_CONSTRAINED",
    }
    assert "NAT_TRANSLATION_UNKNOWN" in {gap["code"] for gap in artifact["gaps"]}


def test_unknown_branches_with_same_constraint_collapse_but_different_pools_do_not():
    first_pool = add_pool(
        addresses=[{"start": "203.0.113.10", "end": "203.0.113.20"}]
    )
    second_pool = add_pool(
        addresses=[{"start": "198.51.100.10", "end": "198.51.100.20"}]
    )
    unknown_predicate = {
        "op": "SOURCE_PORT_IN",
        "ranges": [{"start": 443, "end": 443}],
    }
    same_id, _, _ = add_policy(
        default=transform(source_ip=select_from(first_pool)),
        rules=(
            (10, unknown_predicate, transform(source_ip=select_from(first_pool))),
        ),
    )
    same = policy_evaluate(same_id).json()
    assert same["result"] == "TRANSFORMED_CONSTRAINED"

    different_id, _, _ = add_policy(
        default=transform(source_ip=select_from(second_pool)),
        rules=(
            (10, unknown_predicate, transform(source_ip=select_from(first_pool))),
        ),
    )
    different = policy_evaluate(different_id).json()
    assert different["result"] == "UNKNOWN"


def test_false_then_exact_and_identity_exemption_keep_first_match_semantics():
    pool_id = add_pool(
        addresses=[{"start": "203.0.113.10", "end": "203.0.113.20"}]
    )
    exact_id, _, _ = add_policy(
        rules=(
            (10, {"op": "FALSE"}, transform(source_ip=select_from(pool_id))),
            (20, {"op": "TRUE"}, transform(source_ip=replace("192.0.2.1"))),
        )
    )
    assert policy_evaluate(exact_id).json()["result"] == "TRANSFORMED_EXACT"

    exempt_id, _, _ = add_policy(
        rules=(
            (10, {"op": "TRUE"}, identity()),
            (20, {"op": "TRUE"}, transform(source_ip=select_from(pool_id))),
        )
    )
    artifact = policy_evaluate(exempt_id).json()
    assert artifact["result"] == "IDENTITY"
    assert len(artifact["branches"][0]["steps"]) == 1


def test_incomplete_policy_stays_unknown_but_preserves_constrained_branch():
    pool_id = add_pool(ports=[{"start": 40000, "end": 60000}])
    policy_id, _, _ = add_policy(
        completeness="PARTIAL",
        rules=((10, {"op": "TRUE"}, transform(source_port=select_from(pool_id))),),
    )
    artifact = policy_evaluate(policy_id).json()
    assert artifact["result"] == "UNKNOWN"
    assert artifact["branches"][0]["transform_result"] == "TRANSFORMED_CONSTRAINED"
    assert [gap["code"] for gap in artifact["gaps"]] == ["NAT_POLICY_INCOMPLETE"]


def test_m62_stops_at_constrained_stage_and_does_not_guess_for_later_policy():
    pool_id = add_pool(
        addresses=[{"start": "10.0.0.10", "end": "10.0.0.20"}]
    )
    _, _, first_attachment = add_policy(
        rules=((10, {"op": "TRUE"}, transform(destination_ip=select_from(pool_id))),),
        attach=(10, {}),
    )
    _, _, second_attachment = add_policy(
        rules=(
            (
                10,
                {"op": "DESTINATION_IP_IN", "prefixes": ["10.0.0.0/24"]},
                transform(destination_port=replace(443)),
            ),
        ),
        attach=(20, {}),
    )
    artifact = stages_evaluate(
        packet={"destination_ip": "203.0.113.10", "destination_port": 8443}
    ).json()
    assert artifact["result"] == "UNKNOWN"
    branch = artifact["branches"][0]
    assert branch["termination"] == "NAT_CONSTRAINED_OUTPUT"
    assert branch["final_packet"] is None
    assert [stage["attachment_id"] for stage in branch["stage_executions"]] == [
        str(first_attachment)
    ]
    nested = branch["stage_executions"][0]["policy_evaluation"]
    assert nested["result"] == "TRANSFORMED_CONSTRAINED"
    assert nested["packet_after"] is None
    assert nested["packet_after_constraint"] is not None
    assert str(second_attachment) not in str(branch)
    assert "NAT_CONSTRAINED_OUTPUT" in {gap["code"] for gap in artifact["gaps"]}


def test_unknown_attachment_apply_constrained_and_skip_exact_remains_unknown():
    pool_id = add_pool(ports=[{"start": 40000, "end": 60000}])
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        interface = repository.add_network_interface()
        routing_context = repository.add_routing_context()
        binding = repository.add_l3_binding(interface.id, routing_context.id)
        binding_id = binding.id
    add_policy(
        rules=((10, {"op": "TRUE"}, transform(source_port=select_from(pool_id))),),
        attach=(10, {"ingress_l3_binding_ids": [str(binding_id)]}),
    )
    artifact = stages_evaluate().json()
    assert artifact["result"] == "UNKNOWN"
    assert {branch["termination"] for branch in artifact["branches"]} == {
        "COMPLETED",
        "NAT_CONSTRAINED_OUTPUT",
    }


def test_nat_pool_workspace_and_no_allocation_implementation_contract():
    assert "workspace_id" not in NATPool.__table__.columns
    source = (
        inspect.getsource(ConfiguredNATPolicyResolver)
        + inspect.getsource(ConfiguredNATEvaluationResolver)
        + inspect.getsource(apply_nat_transform)
    ).lower()
    for forbidden in (
        "sessionlocal",
        "create_engine",
        "public.",
        "random",
        "choice(",
        "current_workspace",
    ):
        assert forbidden not in source
