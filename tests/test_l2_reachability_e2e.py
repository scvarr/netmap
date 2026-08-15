import os

import httpx
import pytest

from app.database import SessionLocal
from app.models import L2EgressRule
from app.repository import CanonicalRepository


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def stack(*labels):
    return [{"kind": kind, "value": value} for kind, value in labels]


def trace(source_id, source_stack, target_id, target_stack):
    return httpx.post(
        f"{BASE_URL}/v1/traces/l2/reachability",
        json={
            "from": {
                "interface_id": str(source_id),
                "encapsulation_stack": source_stack,
            },
            "to": {
                "interface_id": str(target_id),
                "encapsulation_stack": target_stack,
            },
        },
        timeout=5,
    )


def configured_path(source_stack, target_stack):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        context = repository.add_l2_forwarding_context()
        source_binding = repository.add_l2_binding(source.id, context.id)
        target_binding = repository.add_l2_binding(target.id, context.id)
        ingress = repository.add_l2_ingress_rule(source_binding.id, source_stack)
        egress = repository.add_l2_egress_rule(target_binding.id, target_stack)
        return {
            "source": source.id,
            "target": target.id,
            "context": context.id,
            "source_binding": source_binding.id,
            "target_binding": target_binding.id,
            "ingress": ingress.id,
            "egress": egress.id,
        }


@pytest.mark.parametrize(
    ("source_stack", "target_stack"),
    [
        ([], []),
        (stack(("dot1q", 100)), stack(("dot1q", 100))),
        (stack(("dot1q", 100)), stack(("dot1q", 200))),
    ],
    ids=["access-like", "tagged-trunk-like", "vlan-translation"],
)
def test_configured_local_l2_path_is_reachable(source_stack, target_stack):
    facts = configured_path(source_stack, target_stack)

    response = trace(facts["source"], source_stack, facts["target"], target_stack)

    assert response.status_code == 200
    artifact = response.json()
    assert artifact["verdict"] == "REACHABLE"
    assert artifact["gaps"] == []
    assert [edge["transition_kind"] for edge in artifact["edges"]] == [
        "INGRESS_DECODE",
        "LOCAL_FORWARD",
        "EGRESS_ENCODE",
    ]
    expected_refs = {
        ("NetworkInterface", str(facts["source"])),
        ("NetworkInterface", str(facts["target"])),
        ("L2ForwardingContext", str(facts["context"])),
        ("L2Binding", str(facts["source_binding"])),
        ("L2Binding", str(facts["target_binding"])),
        ("L2IngressRule", str(facts["ingress"])),
        ("L2EgressRule", str(facts["egress"])),
    }
    assert {
        (ref["entity_type"], ref["entity_id"]) for ref in artifact["evidence_refs"]
    } == expected_refs


def test_same_numeric_vlan_in_different_contexts_does_not_create_reachability():
    tagged = stack(("dot1q", 100))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        source_context = repository.add_l2_forwarding_context()
        target_context = repository.add_l2_forwarding_context()
        source_binding = repository.add_l2_binding(source.id, source_context.id)
        target_binding = repository.add_l2_binding(target.id, target_context.id)
        repository.add_l2_ingress_rule(source_binding.id, tagged)
        repository.add_l2_egress_rule(target_binding.id, tagged)
        source_id, target_id = source.id, target.id

    response = trace(source_id, tagged, target_id, tagged)

    assert response.status_code == 200
    assert response.json()["verdict"] == "UNKNOWN"
    assert response.json()["gaps"][0]["code"] == "L2_TARGET_CONTEXT_PATH_UNKNOWN"


def test_missing_ingress_rule_is_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        source_id, target_id = source.id, target.id

    response = trace(source_id, [], target_id, [])

    assert response.status_code == 200
    assert response.json()["verdict"] == "UNKNOWN"
    assert response.json()["gaps"][0]["code"] == "L2_INGRESS_RULE_UNKNOWN"


def test_missing_egress_rule_is_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        context = repository.add_l2_forwarding_context()
        source_binding = repository.add_l2_binding(source.id, context.id)
        repository.add_l2_binding(target.id, context.id)
        repository.add_l2_ingress_rule(source_binding.id, [])
        source_id, target_id = source.id, target.id

    response = trace(source_id, [], target_id, [])

    assert response.status_code == 200
    assert response.json()["verdict"] == "UNKNOWN"
    assert response.json()["gaps"][0]["code"] == "L2_EGRESS_RULE_UNKNOWN"


def test_ambiguous_exact_ingress_mapping_is_unknown():
    tagged = stack(("dot1q", 100))
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        source = repository.add_network_interface()
        target = repository.add_network_interface()
        for _ in range(2):
            context = repository.add_l2_forwarding_context()
            source_binding = repository.add_l2_binding(source.id, context.id)
            target_binding = repository.add_l2_binding(target.id, context.id)
            repository.add_l2_ingress_rule(source_binding.id, tagged)
            repository.add_l2_egress_rule(target_binding.id, tagged)
        source_id, target_id = source.id, target.id

    response = trace(source_id, tagged, target_id, tagged)

    assert response.status_code == 200
    assert response.json()["verdict"] == "UNKNOWN"
    assert response.json()["gaps"][0]["code"] == "L2_INGRESS_AMBIGUOUS"


def test_requested_egress_stack_mismatch_is_unknown():
    facts = configured_path([], stack(("dot1q", 100)))

    response = trace(facts["source"], [], facts["target"], stack(("dot1q", 200)))

    assert response.status_code == 200
    assert response.json()["verdict"] == "UNKNOWN"
    assert response.json()["gaps"][0]["code"] == "L2_TARGET_CONTEXT_PATH_UNKNOWN"


def test_corrupted_canonical_encapsulation_stack_is_model_error():
    facts = configured_path([], [])
    with SessionLocal.begin() as session:
        rule = session.get(L2EgressRule, facts["egress"])
        assert rule is not None
        rule.emit_stack = [{"kind": "dot1q"}]

    response = trace(facts["source"], [], facts["target"], [])

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MODEL_ERROR"
