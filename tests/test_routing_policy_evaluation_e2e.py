import inspect
import os
import uuid

import httpx
import pytest
from sqlalchemy import text

from app.database import SessionLocal
from app.errors import ValidationError
from app.models import Route, RoutingPolicy, RoutingPolicyRule
from app import routing_policy_resolver
from app.repository import CanonicalRepository
from app.routing_policy_resolver import ConfiguredRoutingPolicyResolver
from app.schemas import EvaluationView, PacketState, RoutingPolicyEvaluationQuery


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def select_table(table_id):
    return {"op": "SELECT_TABLE", "routing_table_id": str(table_id)}


def create_context_tables(
    *,
    family="IPv4",
    first_completeness="COMPLETE",
    second_completeness="COMPLETE",
):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        table_a = repository.add_routing_table(
            context.id, family, first_completeness
        )
        table_b = repository.add_routing_table(
            context.id, family, second_completeness
        )
        return context.id, table_a.id, table_b.id


def create_policy(default_table_id, *, completeness="COMPLETE", rules=()):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_routing_policy(
            select_table(default_table_id), completeness
        )
        stored_rules = [
            repository.add_routing_policy_rule(
                policy.id,
                order_key,
                predicate,
                select_table(table_id),
            )
            for order_key, predicate, table_id in rules
        ]
        return policy.id, [rule.id for rule in stored_rules]


def evaluate(policy_id, context_id, packet_state=None):
    return httpx.post(
        f"{BASE_URL}/v1/traces/routing/policy-evaluation",
        json={
            "policy_id": str(policy_id),
            "routing_context_id": str(context_id),
            "packet_state": (
                {"destination_ip": "198.51.100.10"}
                if packet_state is None
                else packet_state
            ),
        },
        timeout=5,
    )


def test_complete_policy_without_rules_selects_explicit_default():
    context_id, table_id, _ = create_context_tables()
    policy_id, _ = create_policy(table_id)

    response = evaluate(policy_id, context_id)
    artifact = response.json()

    assert response.status_code == 200
    assert artifact["result"] == "TABLE_SELECTED"
    assert artifact["selected_routing_table_id"] == str(table_id)
    assert artifact["branches"][0]["terminal_source"] == "DEFAULT"
    assert artifact["branches"][0]["selection"] == select_table(table_id)
    assert artifact["address_family"] == "IPv4"


def test_true_rule_selects_table_and_shadows_later_rules():
    context_id, table_a, table_b = create_context_tables()
    policy_id, rule_ids = create_policy(
        table_a,
        rules=(
            (10, {"op": "TRUE"}, table_b),
            (20, {"op": "TRUE"}, table_a),
        ),
    )

    artifact = evaluate(policy_id, context_id).json()

    assert artifact["result"] == "TABLE_SELECTED"
    assert artifact["selected_routing_table_id"] == str(table_b)
    assert artifact["branches"][0]["terminal_rule_id"] == str(rule_ids[0])
    assert len(artifact["branches"][0]["steps"]) == 1
    assert str(rule_ids[1]) not in {
        ref["entity_id"] for ref in artifact["evidence_refs"]
    }


def test_false_rules_continue_to_later_match():
    context_id, table_a, table_b = create_context_tables()
    policy_id, rule_ids = create_policy(
        table_a,
        rules=(
            (10, {"op": "FALSE"}, table_a),
            (20, {"op": "FALSE"}, table_a),
            (30, {"op": "TRUE"}, table_b),
        ),
    )

    artifact = evaluate(policy_id, context_id).json()

    assert artifact["selected_routing_table_id"] == str(table_b)
    assert [step["predicate_result"] for step in artifact["branches"][0]["steps"]] == [
        "FALSE",
        "FALSE",
        "TRUE",
    ]
    assert artifact["branches"][0]["terminal_rule_id"] == str(rule_ids[2])


def test_unknown_rule_with_different_default_is_selection_unknown():
    context_id, table_a, table_b = create_context_tables()
    policy_id, _ = create_policy(
        table_a,
        rules=((10, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}, table_b),),
    )

    artifact = evaluate(
        policy_id, context_id, {"destination_ip": "198.51.100.10"}
    ).json()

    assert artifact["result"] == "TABLE_SELECTION_UNKNOWN"
    assert artifact["selected_routing_table_id"] is None
    assert {branch["selected_routing_table_id"] for branch in artifact["branches"]} == {
        str(table_a),
        str(table_b),
    }
    assert {gap["code"] for gap in artifact["gaps"]} == {
        "ROUTING_TABLE_SELECTION_UNKNOWN"
    }


def test_unknown_rule_collapses_when_rule_and_default_select_same_table():
    context_id, table_a, _ = create_context_tables()
    policy_id, _ = create_policy(
        table_a,
        rules=((10, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}, table_a),),
    )

    artifact = evaluate(
        policy_id, context_id, {"destination_ip": "198.51.100.10"}
    ).json()

    assert artifact["result"] == "TABLE_SELECTED"
    assert artifact["selected_routing_table_id"] == str(table_a)
    assert len(artifact["branches"]) == 2
    assert {step["branch_assumption"] for branch in artifact["branches"] for step in branch["steps"]} == {
        "MATCH",
        "NO_MATCH",
    }


def test_nested_unknown_branches_collapse_to_one_table():
    context_id, table_a, _ = create_context_tables()
    policy_id, _ = create_policy(
        table_a,
        rules=(
            (10, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}, table_a),
            (20, {"op": "DESTINATION_PORT_IN", "ranges": [{"start": 443, "end": 443}]}, table_a),
        ),
    )

    artifact = evaluate(
        policy_id, context_id, {"destination_ip": "198.51.100.10"}
    ).json()

    assert artifact["result"] == "TABLE_SELECTED"
    assert artifact["selected_routing_table_id"] == str(table_a)
    assert len(artifact["branches"]) == 3


@pytest.mark.parametrize("completeness", ["PARTIAL", "UNKNOWN"])
def test_incomplete_policy_is_always_unknown(completeness):
    context_id, table_a, _ = create_context_tables()
    policy_id, _ = create_policy(
        table_a,
        completeness=completeness,
        rules=((10, {"op": "TRUE"}, table_a),),
    )

    artifact = evaluate(policy_id, context_id).json()

    assert artifact["result"] == "TABLE_SELECTION_UNKNOWN"
    assert artifact["selected_routing_table_id"] is None
    assert {gap["code"] for gap in artifact["gaps"]} == {
        "ROUTING_POLICY_INCOMPLETE"
    }
    assert artifact["branches"][0]["selected_routing_table_id"] == str(table_a)


@pytest.mark.parametrize("table_completeness", ["PARTIAL", "UNKNOWN"])
def test_routing_table_completeness_does_not_affect_table_selection(
    table_completeness,
):
    context_id, table_a, _ = create_context_tables(
        first_completeness=table_completeness
    )
    policy_id, _ = create_policy(table_a)

    artifact = evaluate(policy_id, context_id).json()

    assert artifact["result"] == "TABLE_SELECTED"
    assert artifact["selected_routing_table_id"] == str(table_a)
    assert artifact["gaps"] == []


def test_empty_complete_routing_table_is_still_selected_without_route_lookup():
    context_id, table_a, _ = create_context_tables()
    policy_id, _ = create_policy(table_a)

    selection = evaluate(policy_id, context_id).json()
    route_decision = httpx.post(
        f"{BASE_URL}/v1/traces/l3/route-decision",
        json={
            "routing_context_id": str(context_id),
            "routing_table_id": str(table_a),
            "destination_ip": "198.51.100.10",
        },
        timeout=5,
    ).json()

    assert selection["result"] == "TABLE_SELECTED"
    assert route_decision["result"] == "NO_ROUTE"


def test_selected_table_can_be_passed_to_unchanged_route_decision_endpoint():
    context_id, table_a, _ = create_context_tables()
    policy_id, _ = create_policy(table_a)
    with SessionLocal.begin() as session:
        route = CanonicalRepository(session).add_route(
            table_a, "198.51.100.0/24", "LOCAL"
        )

    selected = evaluate(policy_id, context_id).json()
    decision = httpx.post(
        f"{BASE_URL}/v1/traces/l3/route-decision",
        json={
            "routing_context_id": str(context_id),
            "routing_table_id": selected["selected_routing_table_id"],
            "destination_ip": "198.51.100.10",
        },
        timeout=5,
    ).json()

    assert selected["result"] == "TABLE_SELECTED"
    assert decision["result"] == "LOCAL"
    assert decision["selected_route_id"] == str(route.id)


def test_missing_destination_ip_is_validation_error():
    context_id, table_a, _ = create_context_tables()
    policy_id, _ = create_policy(table_a)

    response = evaluate(policy_id, context_id, {})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_missing_routing_context_is_validation_error():
    context_id, table_a, _ = create_context_tables()
    policy_id, _ = create_policy(table_a)

    response = evaluate(policy_id, uuid.uuid4())

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_policy_not_found_is_validation_error():
    context_id, _, _ = create_context_tables()

    response = evaluate(uuid.uuid4(), context_id)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_selection_from_another_routing_context_is_model_error():
    context_a, _, _ = create_context_tables()
    context_b, table_b, _ = create_context_tables()
    policy_id, _ = create_policy(table_b)

    response = evaluate(policy_id, context_a)

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "MODEL_ERROR"
    assert error["details"]["expected_routing_context_id"] == str(context_a)
    assert error["details"]["actual_routing_context_id"] == str(context_b)


@pytest.mark.parametrize(
    ("table_family", "destination_ip"),
    [("IPv4", "2001:db8::10"), ("IPv6", "198.51.100.10")],
)
def test_selection_address_family_mismatch_is_model_error(
    table_family, destination_ip
):
    context_id, table_a, _ = create_context_tables(family=table_family)
    policy_id, _ = create_policy(table_a)

    response = evaluate(
        policy_id, context_id, {"destination_ip": destination_ip}
    )

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "MODEL_ERROR"
    assert error["details"]["actual_address_family"] == table_family


def test_rule_order_key_is_unique_only_within_policy():
    _, table_a, _ = create_context_tables()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy_a = repository.add_routing_policy(select_table(table_a), "COMPLETE")
        policy_b = repository.add_routing_policy(select_table(table_a), "COMPLETE")
        repository.add_routing_policy_rule(
            policy_a.id, 10, {"op": "TRUE"}, select_table(table_a)
        )
        repository.add_routing_policy_rule(
            policy_b.id, 10, {"op": "TRUE"}, select_table(table_a)
        )
        with pytest.raises(ValidationError):
            repository.add_routing_policy_rule(
                policy_a.id, 10, {"op": "FALSE"}, select_table(table_a)
            )


@pytest.mark.parametrize(
    "invalid_action",
    [
        {"op": "SELECT_NEXT_HOP", "routing_table_id": str(uuid.uuid4())},
        {"op": "SELECT_TABLE", "routing_table_id": str(uuid.uuid4()), "extra": True},
        {"op": "SELECT_TABLE", "routing_table_id": "not-a-uuid"},
        {"op": "SELECT_TABLE", "routing_table_id": str(uuid.uuid4()).upper()},
    ],
)
def test_invalid_selection_action_is_rejected_on_write(invalid_action):
    with SessionLocal.begin() as session:
        with pytest.raises(ValidationError):
            CanonicalRepository(session).add_routing_policy(
                invalid_action, "COMPLETE"
            )


def test_missing_routing_table_is_rejected_on_write():
    with SessionLocal.begin() as session:
        with pytest.raises(ValidationError):
            CanonicalRepository(session).add_routing_policy(
                select_table(uuid.uuid4()), "COMPLETE"
            )


@pytest.mark.parametrize(
    "predicate",
    [
        {"op": "CONNECTION_STATE_IN", "values": ["NEW"]},
        {"op": "TRAFFIC_CLASS_IN", "values": ["TRANSIT"]},
        {"op": "ROUTING_CONTEXT_IN", "values": [str(uuid.uuid4())]},
        {"op": "INGRESS_NETWORK_INTERFACE_IN", "values": [str(uuid.uuid4())]},
        {"op": "INGRESS_L3_BINDING_IN", "values": [str(uuid.uuid4())]},
        {"op": "LOCAL_MARK_IN", "values": [1]},
    ],
)
def test_non_m71_predicate_operations_are_rejected_without_changing_shared_core(
    predicate,
):
    _, table_a, _ = create_context_tables()
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        policy = repository.add_routing_policy(select_table(table_a), "COMPLETE")
        with pytest.raises(ValidationError):
            repository.add_routing_policy_rule(
                policy.id, 10, predicate, select_table(table_a)
            )


@pytest.mark.parametrize(
    ("predicate", "packet_state"),
    [
        ({"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}, {"source_ip": "10.1.2.3", "destination_ip": "198.51.100.10"}),
        ({"op": "DESTINATION_IP_IN", "prefixes": ["198.51.100.0/24"]}, {"destination_ip": "198.51.100.10"}),
        ({"op": "IP_PROTOCOL_IN", "values": [6]}, {"destination_ip": "198.51.100.10", "ip_protocol": 6}),
        ({"op": "SOURCE_PORT_IN", "ranges": [{"start": 1000, "end": 2000}]}, {"destination_ip": "198.51.100.10", "source_port": 1500}),
        ({"op": "DESTINATION_PORT_IN", "ranges": [{"start": 443, "end": 443}]}, {"destination_ip": "198.51.100.10", "destination_port": 443}),
        ({"op": "ICMP_TYPE_IN", "values": [8]}, {"destination_ip": "198.51.100.10", "icmp_type": 8}),
        ({"op": "ICMP_CODE_IN", "values": [0]}, {"destination_ip": "198.51.100.10", "icmp_code": 0}),
        ({"op": "ALL", "children": [{"op": "TRUE"}, {"op": "NOT", "child": {"op": "FALSE"}}]}, {"destination_ip": "198.51.100.10"}),
        ({"op": "ANY", "children": [{"op": "FALSE"}, {"op": "TRUE"}]}, {"destination_ip": "198.51.100.10"}),
    ],
)
def test_allowed_shared_packet_predicates_select_rule_table(predicate, packet_state):
    context_id, table_a, table_b = create_context_tables()
    policy_id, _ = create_policy(
        table_a, rules=((10, predicate, table_b),)
    )

    artifact = evaluate(policy_id, context_id, packet_state).json()

    assert artifact["result"] == "TABLE_SELECTED"
    assert artifact["selected_routing_table_id"] == str(table_b)
    assert artifact["branches"][0]["steps"][0]["predicate_result"] == "TRUE"


@pytest.mark.parametrize(
    ("target", "payload"),
    [
        ("default_selection", {"op": "DROP", "routing_table_id": str(uuid.uuid4())}),
        ("default_selection", {"op": "SELECT_TABLE", "routing_table_id": str(uuid.uuid4()).upper()}),
        ("rule_action", {"op": "SELECT_TABLE", "routing_table_id": "invalid"}),
        ("rule_predicate", {"op": "CONNECTION_STATE_IN", "values": ["NEW"]}),
        ("rule_predicate", {"op": "SOURCE_IP_IN", "prefixes": ["10.1.2.3/8"]}),
    ],
)
def test_corrupt_stored_policy_data_is_model_error(target, payload):
    context_id, table_a, _ = create_context_tables()
    policy_id, rule_ids = create_policy(
        table_a, rules=((10, {"op": "TRUE"}, table_a),)
    )
    with SessionLocal.begin() as session:
        if target == "default_selection":
            session.execute(
                text(
                    "UPDATE routing_policies SET default_selection = CAST(:payload AS jsonb) WHERE id = :id"
                ),
                {"payload": __import__("json").dumps(payload), "id": policy_id},
            )
        elif target == "rule_action":
            session.execute(
                text(
                    "UPDATE routing_policy_rules SET action = CAST(:payload AS jsonb) WHERE id = :id"
                ),
                {"payload": __import__("json").dumps(payload), "id": rule_ids[0]},
            )
        else:
            session.execute(
                text(
                    "UPDATE routing_policy_rules SET predicate = CAST(:payload AS jsonb) WHERE id = :id"
                ),
                {"payload": __import__("json").dumps(payload), "id": rule_ids[0]},
            )

    response = evaluate(policy_id, context_id)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_dangling_stored_routing_table_is_model_error():
    context_id, table_a, _ = create_context_tables()
    policy_id, _ = create_policy(table_a)
    missing_id = uuid.uuid4()
    with SessionLocal.begin() as session:
        session.execute(
            text(
                "UPDATE routing_policies SET default_selection = CAST(:payload AS jsonb) WHERE id = :id"
            ),
            {
                "payload": __import__("json").dumps(select_table(missing_id)),
                "id": policy_id,
            },
        )

    response = evaluate(policy_id, context_id)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_duplicate_stored_order_is_model_error():
    context_id, table_a, _ = create_context_tables()
    policy_id, _ = create_policy(
        table_a, rules=((10, {"op": "TRUE"}, table_a),)
    )
    duplicate_id = uuid.uuid4()
    with SessionLocal.begin() as session:
        session.execute(
            text(
                "ALTER TABLE routing_policy_rules DROP CONSTRAINT uq_routing_policy_rules_policy_order"
            )
        )
        session.execute(
            text(
                "INSERT INTO routing_policy_rules (id, policy_id, order_key, predicate, action) "
                "VALUES (:id, :policy_id, 10, CAST(:predicate AS jsonb), CAST(:action AS jsonb))"
            ),
            {
                "id": duplicate_id,
                "policy_id": policy_id,
                "predicate": '{"op":"FALSE"}',
                "action": __import__("json").dumps(select_table(table_a)),
            },
        )

    response = evaluate(policy_id, context_id)

    with SessionLocal.begin() as session:
        session.execute(
            text("DELETE FROM routing_policy_rules WHERE id = :id"),
            {"id": duplicate_id},
        )
        session.execute(
            text(
                "ALTER TABLE routing_policy_rules ADD CONSTRAINT uq_routing_policy_rules_policy_order UNIQUE (policy_id, order_key)"
            )
        )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"


def test_artifact_evidence_is_limited_to_policy_rules_and_selected_tables():
    context_id, table_a, table_b = create_context_tables()
    policy_id, rule_ids = create_policy(
        table_a,
        rules=((10, {"op": "SOURCE_IP_IN", "prefixes": ["10.0.0.0/8"]}, table_b),),
    )

    artifact = evaluate(
        policy_id,
        context_id,
        {"source_ip": "10.1.2.3", "destination_ip": "198.51.100.10"},
    ).json()
    refs = {(ref["entity_type"], ref["entity_id"]) for ref in artifact["evidence_refs"]}

    assert refs == {
        ("RoutingPolicy", str(policy_id)),
        ("RoutingPolicyRule", str(rule_ids[0])),
        ("RoutingTable", str(table_b)),
    }
    assert not {"Route", "RouteNextHop", "SecurityPolicy", "NATPolicy"} & {
        entity_type for entity_type, _ in refs
    }


def test_resolver_is_standalone_and_workspace_agnostic():
    assert "workspace_id" not in RoutingPolicy.__table__.columns
    assert "workspace_id" not in RoutingPolicyRule.__table__.columns
    source = inspect.getsource(routing_policy_resolver)
    lowered = source.lower()
    for forbidden in (
        "sessionlocal",
        "create_engine",
        "workspace",
        "cache",
        "selectedtableroutedecisionresolver",
        "selectedtablenexthopresolver",
        "security",
        "natresolver",
        "l2resolver",
    ):
        assert forbidden not in lowered


def test_routing_policy_evaluation_does_not_create_routes_or_mutate_packet():
    context_id, table_a, _ = create_context_tables()
    policy_id, _ = create_policy(table_a)
    packet = {
        "source_ip": "10.0.0.1",
        "destination_ip": "198.51.100.10",
        "ip_protocol": 6,
    }

    artifact = evaluate(policy_id, context_id, packet).json()

    with SessionLocal() as session:
        assert session.query(Route).count() == 0
    assert artifact["query"]["packet_state"] == {
        **packet,
        "source_port": None,
        "destination_port": None,
        "icmp_type": None,
        "icmp_code": None,
    }


def test_direct_resolver_keeps_the_same_immutable_packet_state():
    context_id, table_a, _ = create_context_tables()
    policy_id, _ = create_policy(table_a)
    packet = PacketState(
        source_ip="10.0.0.1",
        destination_ip="198.51.100.10",
        ip_protocol=6,
    )
    before = packet.model_dump()
    query = RoutingPolicyEvaluationQuery(
        policy_id=policy_id,
        routing_context_id=context_id,
        packet_state=packet,
    )

    with SessionLocal() as session:
        artifact = ConfiguredRoutingPolicyResolver(
            CanonicalRepository(session)
        ).resolve(query, EvaluationView())

    assert artifact.query.packet_state is packet
    assert packet.model_dump() == before
