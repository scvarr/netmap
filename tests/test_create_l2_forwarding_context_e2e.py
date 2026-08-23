import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.database import SessionLocal
from app.main import app
from app.models import L2Binding, L2EgressRule, L2ForwardingContext, L2IngressRule


client = TestClient(app)


def create_two_public_interfaces() -> tuple[str, str]:
    created = client.post("/v1/topology/devices", json={"display_name": "L2-TEST", "initial_interface": {"display_name": "eth0"}})
    assert created.status_code == 201
    device_id = created.json()["device"]["source_ref"]["entity_id"]
    source_id = created.json()["interfaces"][0]["interface_ref"]["entity_id"]
    added = client.post(f"/v1/topology/devices/{device_id}/interfaces", json={"display_name": "eth1"})
    assert added.status_code == 201
    target_id = next(
        item["interface_ref"]["entity_id"]
        for item in added.json()["interfaces"]
        if item["interface_ref"]["entity_id"] != source_id
    )
    return source_id, target_id


def create_context(bindings: list[dict]) -> dict:
    response = client.post("/v1/l2/forwarding-contexts", json={"bindings": bindings})
    assert response.status_code == 201, response.text
    return response.json()


def trace(source_id: str, target_id: str, stack: list[dict]) -> dict:
    response = client.post("/v1/traces/l2/reachability", json={"from": {"interface_id": source_id, "encapsulation_stack": stack}, "to": {"interface_id": target_id, "encapsulation_stack": stack}})
    assert response.status_code == 200, response.text
    return response.json()


def untagged_binding(interface_id: str) -> dict:
    return {"interface_id": interface_id, "ingress_exact_stacks": [[]], "egress_emit_stack": []}


def test_public_operation_creates_two_symmetric_untagged_bindings_and_reachable_trace():
    source_id, target_id = create_two_public_interfaces()
    created = create_context([untagged_binding(source_id), untagged_binding(target_id)])

    assert created["forwarding_context_ref"]["entity_type"] == "L2ForwardingContext"
    assert [binding["interface_ref"]["entity_id"] for binding in created["bindings"]] == [source_id, target_id]
    assert all(len(binding["ingress_rule_refs"]) == 1 for binding in created["bindings"])
    assert all(binding["egress_rule_ref"] is not None for binding in created["bindings"])
    with SessionLocal() as session:
        assert session.get(L2ForwardingContext, uuid.UUID(created["forwarding_context_ref"]["entity_id"])) is not None
        for binding in created["bindings"]:
            assert session.get(L2Binding, uuid.UUID(binding["binding_ref"]["entity_id"])) is not None
            assert session.get(L2IngressRule, uuid.UUID(binding["ingress_rule_refs"][0]["entity_id"])) is not None
            assert session.get(L2EgressRule, uuid.UUID(binding["egress_rule_ref"]["entity_id"])) is not None

    assert trace(source_id, target_id, [])["verdict"] == "REACHABLE"
    assert trace(target_id, source_id, [])["verdict"] == "REACHABLE"


def test_same_numeric_tag_in_separate_contexts_is_not_combined():
    source_id, target_id = create_two_public_interfaces()
    tagged = [{"kind": "dot1q", "value": 100}]
    create_context([{"interface_id": source_id, "ingress_exact_stacks": [tagged], "egress_emit_stack": tagged}])
    create_context([{"interface_id": target_id, "ingress_exact_stacks": [tagged], "egress_emit_stack": tagged}])
    assert trace(source_id, target_id, tagged)["verdict"] == "UNKNOWN"


def test_null_egress_stack_creates_no_egress_rule():
    source_id, _ = create_two_public_interfaces()
    created = create_context([{"interface_id": source_id, "ingress_exact_stacks": [[]], "egress_emit_stack": None}])
    binding = created["bindings"][0]
    assert "egress_rule_ref" not in binding
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(L2EgressRule)) == 0


def test_duplicate_or_missing_interface_is_rejected_without_writes():
    source_id, _ = create_two_public_interfaces()
    duplicate = client.post("/v1/l2/forwarding-contexts", json={"bindings": [untagged_binding(source_id), untagged_binding(source_id)]})
    assert duplicate.status_code == 422
    missing = client.post("/v1/l2/forwarding-contexts", json={"bindings": [untagged_binding(str(uuid.uuid4()))]})
    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "VALIDATION_ERROR"
    with SessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(L2ForwardingContext)) == 0
        assert session.scalar(select(func.count()).select_from(L2Binding)) == 0


def test_invalid_encapsulation_and_failed_binding_roll_back_everything():
    source_id, _ = create_two_public_interfaces()
    malformed = client.post("/v1/l2/forwarding-contexts", json={"bindings": [{"interface_id": source_id, "ingress_exact_stacks": [[{"kind": "", "value": 100}]], "egress_emit_stack": None}]})
    assert malformed.status_code == 422
    failed = client.post("/v1/l2/forwarding-contexts", json={"bindings": [untagged_binding(source_id), untagged_binding(str(uuid.uuid4()))]})
    assert failed.status_code == 422
    with SessionLocal() as session:
        for model in (L2ForwardingContext, L2Binding, L2IngressRule, L2EgressRule):
            assert session.scalar(select(func.count()).select_from(model)) == 0
