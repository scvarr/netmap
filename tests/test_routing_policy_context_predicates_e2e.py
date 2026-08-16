import json
import os
import uuid

import httpx
import pytest
from sqlalchemy import text

from app.database import SessionLocal
from app.errors import ValidationError
from app.repository import CanonicalRepository


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def selection(table_id):
    return {"op": "SELECT_TABLE", "routing_table_id": str(table_id)}


def fixture(*, second_context=False):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        other_context = repository.add_routing_context()
        table_a = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        table_b = repository.add_routing_table(context.id, "IPv4", "COMPLETE")
        interface = repository.add_network_interface()
        other_interface = repository.add_network_interface()
        binding = repository.add_l3_binding(interface.id, context.id)
        other_binding = repository.add_l3_binding(
            other_interface.id,
            other_context.id if second_context else context.id,
        )
        return {
            "context": context.id,
            "other_context": other_context.id,
            "table_a": table_a.id,
            "table_b": table_b.id,
            "interface": interface.id,
            "other_interface": other_interface.id,
            "binding": binding.id,
            "other_binding": other_binding.id,
        }


def policy(default_table, predicate, rule_table=None, completeness="COMPLETE"):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        stored = repository.add_routing_policy(selection(default_table), completeness)
        rule = repository.add_routing_policy_rule(
            stored.id,
            10,
            predicate,
            selection(rule_table or default_table),
        )
        return stored.id, rule.id


def evaluate(policy_id, context_id, **runtime):
    return httpx.post(
        f"{BASE_URL}/v1/traces/routing/policy-evaluation",
        json={
            "policy_id": str(policy_id),
            "routing_context_id": str(context_id),
            "packet_state": runtime.pop(
                "packet_state", {"destination_ip": "198.51.100.10"}
            ),
            **runtime,
        },
        timeout=5,
    )


def materialize(value, data):
    if isinstance(value, dict):
        return {key: materialize(item, data) for key, item in value.items()}
    if isinstance(value, list):
        return [materialize(item, data) for item in value]
    if isinstance(value, str) and value.startswith("{") and value.endswith("}"):
        return str(data[value[1:-1]])
    return value


def test_context_predicates_are_canonicalized_on_write():
    data = fixture()
    upper = str(data["context"]).upper()
    predicate = {
        "op": "ALL",
        "children": [
            {
                "op": "TRAFFIC_CLASS_IN",
                "values": ["LOCAL_OUTPUT", "TRANSIT", "TRANSIT"],
            },
            {"op": "ROUTING_CONTEXT_IN", "ids": [upper, upper]},
        ],
    }
    policy_id, _ = policy(data["table_a"], predicate)

    with SessionLocal() as session:
        stored = CanonicalRepository(session).get_routing_policy(policy_id)

    assert stored.rules[0].predicate == {
        "op": "ALL",
        "children": [
            {
                "op": "TRAFFIC_CLASS_IN",
                "values": ["TRANSIT", "LOCAL_OUTPUT"],
            },
            {"op": "ROUTING_CONTEXT_IN", "ids": [str(data["context"])]},
        ],
    }


@pytest.mark.parametrize(
    "predicate",
    [
        {"op": "TRAFFIC_CLASS_IN", "values": []},
        {"op": "TRAFFIC_CLASS_IN", "values": ["FORWARD"]},
        {"op": "TRAFFIC_CLASS_IN", "values": ["TRANSIT"], "extra": True},
        {"op": "ROUTING_CONTEXT_IN", "ids": []},
        {"op": "ROUTING_CONTEXT_IN", "ids": ["invalid"]},
        {"op": "LOCAL_MARK_IN", "values": [1]},
        {"op": "CONNECTION_STATE_IN", "values": ["NEW"]},
    ],
)
def test_invalid_context_predicates_are_rejected(predicate):
    data = fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        stored = repository.add_routing_policy(selection(data["table_a"]), "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_routing_policy_rule(
                stored.id, 10, predicate, selection(data["table_a"])
            )


@pytest.mark.parametrize(
    ("op", "entity_key"),
    [
        ("ROUTING_CONTEXT_IN", "context"),
        ("INGRESS_NETWORK_INTERFACE_IN", "interface"),
        ("INGRESS_L3_BINDING_IN", "binding"),
    ],
)
def test_uuid_context_references_must_exist(op, entity_key):
    data = fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        stored = repository.add_routing_policy(selection(data["table_a"]), "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_routing_policy_rule(
                stored.id,
                10,
                {"op": op, "ids": [str(uuid.uuid4())]},
                selection(data["table_a"]),
            )


@pytest.mark.parametrize(
    ("predicate", "runtime_key", "runtime_value_key", "expected"),
    [
        ({"op": "TRAFFIC_CLASS_IN", "values": ["TRANSIT"]}, "traffic_class", "TRANSIT", "TRUE"),
        ({"op": "TRAFFIC_CLASS_IN", "values": ["TRANSIT"]}, "traffic_class", "LOCAL_INPUT", "FALSE"),
        ({"op": "TRAFFIC_CLASS_IN", "values": ["TRANSIT"]}, None, None, "UNKNOWN"),
        ({"op": "ROUTING_CONTEXT_IN", "ids": ["{context}"]}, None, None, "TRUE"),
        ({"op": "ROUTING_CONTEXT_IN", "ids": ["{other_context}"]}, None, None, "FALSE"),
        ({"op": "INGRESS_NETWORK_INTERFACE_IN", "ids": ["{interface}"]}, "ingress_network_interface_id", "interface", "TRUE"),
        ({"op": "INGRESS_NETWORK_INTERFACE_IN", "ids": ["{interface}"]}, "ingress_network_interface_id", "other_interface", "FALSE"),
        ({"op": "INGRESS_NETWORK_INTERFACE_IN", "ids": ["{interface}"]}, None, None, "UNKNOWN"),
        ({"op": "INGRESS_L3_BINDING_IN", "ids": ["{binding}"]}, "ingress_l3_binding_id", "binding", "TRUE"),
        ({"op": "INGRESS_L3_BINDING_IN", "ids": ["{binding}"]}, "ingress_l3_binding_id", "other_binding", "FALSE"),
        ({"op": "INGRESS_L3_BINDING_IN", "ids": ["{binding}"]}, None, None, "UNKNOWN"),
    ],
)
def test_context_leaf_runtime_truth_values(
    predicate, runtime_key, runtime_value_key, expected
):
    data = fixture()
    predicate = materialize(predicate, data)
    policy_id, _ = policy(data["table_a"], predicate, data["table_b"])
    runtime = {}
    if runtime_key is not None:
        runtime[runtime_key] = (
            str(data[runtime_value_key])
            if runtime_value_key in data
            else runtime_value_key
        )
    response = evaluate(policy_id, data["context"], **runtime)

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["branches"][0]["steps"][0]["predicate_result"] == expected
    if expected == "TRUE":
        assert artifact["selected_routing_table_id"] == str(data["table_b"])
    elif expected == "FALSE":
        assert artifact["selected_routing_table_id"] == str(data["table_a"])
    else:
        assert artifact["result"] == "TABLE_SELECTION_UNKNOWN"


@pytest.mark.parametrize(
    ("predicate", "runtime", "expected"),
    [
        (
            {"op": "ALL", "children": [{"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}, {"op": "TRAFFIC_CLASS_IN", "values": ["TRANSIT"]}]},
            {"packet_state": {"source_ip": "10.1.2.3", "destination_ip": "198.51.100.10"}, "traffic_class": "TRANSIT"},
            "TRUE",
        ),
        (
            {"op": "ALL", "children": [{"op": "TRUE"}, {"op": "INGRESS_NETWORK_INTERFACE_IN", "ids": ["{interface}"]}]},
            {},
            "UNKNOWN",
        ),
        (
            {"op": "ALL", "children": [{"op": "TRAFFIC_CLASS_IN", "values": ["TRANSIT"]}, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}]},
            {"traffic_class": "LOCAL_INPUT"},
            "FALSE",
        ),
        (
            {"op": "ANY", "children": [{"op": "TRAFFIC_CLASS_IN", "values": ["TRANSIT"]}, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}]},
            {"traffic_class": "TRANSIT"},
            "TRUE",
        ),
        (
            {"op": "ANY", "children": [{"op": "TRAFFIC_CLASS_IN", "values": ["TRANSIT"]}, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}]},
            {"traffic_class": "LOCAL_INPUT"},
            "UNKNOWN",
        ),
        (
            {"op": "NOT", "child": {"op": "INGRESS_L3_BINDING_IN", "ids": ["{binding}"]}},
            {},
            "UNKNOWN",
        ),
        (
            {"op": "NOT", "child": {"op": "ANY", "children": [{"op": "FALSE"}, {"op": "TRAFFIC_CLASS_IN", "values": ["LOCAL_INPUT"]}]}},
            {"traffic_class": "TRANSIT"},
            "TRUE",
        ),
    ],
)
def test_mixed_packet_context_boolean_trees(predicate, runtime, expected):
    data = fixture()
    predicate = materialize(predicate, data)
    policy_id, _ = policy(data["table_a"], predicate, data["table_b"])

    artifact = evaluate(policy_id, data["context"], **runtime).json()

    assert artifact["branches"][0]["steps"][0]["predicate_result"] == expected


def test_unknown_context_selection_collapses_when_tables_are_same():
    data = fixture()
    predicate = {
        "op": "INGRESS_NETWORK_INTERFACE_IN",
        "ids": [str(data["interface"])],
    }
    policy_id, _ = policy(data["table_a"], predicate, data["table_a"])

    artifact = evaluate(policy_id, data["context"]).json()

    assert artifact["result"] == "TABLE_SELECTED"
    assert len(artifact["branches"]) == 2


def test_context_first_match_shadows_packet_rule():
    data = fixture()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        stored = repository.add_routing_policy(selection(data["table_a"]), "COMPLETE")
        first = repository.add_routing_policy_rule(
            stored.id,
            10,
            {"op": "TRAFFIC_CLASS_IN", "values": ["TRANSIT"]},
            selection(data["table_b"]),
        )
        second = repository.add_routing_policy_rule(
            stored.id, 20, {"op": "TRUE"}, selection(data["table_a"])
        )

    artifact = evaluate(stored.id, data["context"], traffic_class="TRANSIT").json()
    refs = {item["entity_id"] for item in artifact["evidence_refs"]}

    assert artifact["selected_routing_table_id"] == str(data["table_b"])
    assert str(first.id) in refs
    assert str(second.id) not in refs


@pytest.mark.parametrize("missing", ["interface", "binding"])
def test_missing_supplied_runtime_entity_is_validation_error(missing):
    data = fixture()
    policy_id, _ = policy(data["table_a"], {"op": "TRUE"})
    field = (
        "ingress_network_interface_id"
        if missing == "interface"
        else "ingress_l3_binding_id"
    )

    response = evaluate(policy_id, data["context"], **{field: str(uuid.uuid4())})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_binding_interface_mismatch_is_validation_error():
    data = fixture()
    policy_id, _ = policy(data["table_a"], {"op": "TRUE"})

    response = evaluate(
        policy_id,
        data["context"],
        ingress_network_interface_id=str(data["other_interface"]),
        ingress_l3_binding_id=str(data["binding"]),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_ingress_binding_from_another_context_is_validation_error():
    data = fixture(second_context=True)
    policy_id, _ = policy(data["table_a"], {"op": "TRUE"})

    response = evaluate(
        policy_id,
        data["context"],
        ingress_l3_binding_id=str(data["other_binding"]),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_context_entity_evidence_is_added_only_for_concrete_evaluated_values():
    data = fixture()
    predicate = {
        "op": "ALL",
        "children": [
            {"op": "ROUTING_CONTEXT_IN", "ids": [str(data["context"])]},
            {"op": "INGRESS_NETWORK_INTERFACE_IN", "ids": [str(data["interface"])]},
            {"op": "INGRESS_L3_BINDING_IN", "ids": [str(data["binding"])]},
        ],
    }
    policy_id, _ = policy(data["table_a"], predicate, data["table_b"])

    artifact = evaluate(
        policy_id,
        data["context"],
        ingress_network_interface_id=str(data["interface"]),
        ingress_l3_binding_id=str(data["binding"]),
    ).json()
    refs = {(item["entity_type"], item["entity_id"]) for item in artifact["evidence_refs"]}

    assert ("RoutingContext", str(data["context"])) in refs
    assert ("NetworkInterface", str(data["interface"])) in refs
    assert ("L3Binding", str(data["binding"])) in refs
    assert not {"Route", "RouteNextHop", "SecurityPolicy", "NATPolicy"} & {
        entity_type for entity_type, _ in refs
    }


@pytest.mark.parametrize("corruption", ["noncanonical", "dangling"])
def test_stored_context_predicate_corruption_is_model_error(corruption):
    data = fixture()
    predicate = {
        "op": "ROUTING_CONTEXT_IN",
        "ids": [str(data["context"])],
    }
    policy_id, rule_id = policy(data["table_a"], predicate)
    if corruption == "noncanonical":
        corrupt = {"op": "ROUTING_CONTEXT_IN", "ids": [str(data["context"]).upper()]}
    else:
        corrupt = {"op": "ROUTING_CONTEXT_IN", "ids": [str(uuid.uuid4())]}
    with SessionLocal.begin() as session:
        session.execute(
            text(
                "UPDATE routing_policy_rules SET predicate = CAST(:predicate AS jsonb) WHERE id = :id"
            ),
            {"predicate": json.dumps(corrupt), "id": rule_id},
        )

    response = evaluate(policy_id, data["context"])

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_incomplete_policy_and_legacy_query_semantics_remain_unchanged():
    data = fixture()
    policy_id, _ = policy(
        data["table_a"],
        {"op": "TRAFFIC_CLASS_IN", "values": ["TRANSIT"]},
        data["table_b"],
        completeness="PARTIAL",
    )

    artifact = evaluate(policy_id, data["context"]).json()

    assert artifact["result"] == "TABLE_SELECTION_UNKNOWN"
    assert {gap["code"] for gap in artifact["gaps"]} == {
        "ROUTING_POLICY_INCOMPLETE"
    }
    assert artifact["query"]["traffic_class"] is None
    assert artifact["query"]["ingress_network_interface_id"] is None
    assert artifact["query"]["ingress_l3_binding_id"] is None
