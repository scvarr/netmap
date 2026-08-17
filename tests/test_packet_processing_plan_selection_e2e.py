import os
import uuid

import httpx
import pytest
from sqlalchemy import text

from app.database import SessionLocal
from app.errors import ModelError, ValidationError
from app.repository import CanonicalRepository


BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")


def select_plan(context_id, traffic_class="TRANSIT", **runtime):
    return httpx.post(
        f"{BASE_URL}/v1/traces/packet-processing/plan-selection",
        json={
            "routing_context_id": str(context_id),
            "traffic_class": traffic_class,
            **{key: str(value) for key, value in runtime.items()},
        },
        timeout=5,
    )


def add_plan(repository, *traffic_classes, completeness="COMPLETE"):
    plan = repository.add_packet_processing_plan(completeness)
    terminal = repository.add_processing_stage(
        plan.id, "TERMINATE", {"outcome": "UNKNOWN"}
    )
    for traffic_class in traffic_classes or ("TRANSIT",):
        repository.add_processing_entry_point(plan.id, traffic_class, terminal.id)
    return plan


def add_set(repository, context_id, completeness="COMPLETE", traffic_class="TRANSIT"):
    return repository.add_packet_processing_plan_attachment_set(
        context_id, traffic_class, completeness
    )


def test_attachment_set_and_scope_are_canonical_and_plan_entry_compatible():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        interface_a = repository.add_network_interface()
        interface_b = repository.add_network_interface()
        binding = repository.add_l3_binding(interface_a.id, context.id)
        plan = add_plan(repository, "TRANSIT")
        attachment_set = add_set(repository, context.id)
        attachment = repository.add_packet_processing_plan_attachment(
            attachment_set.id,
            plan.id,
            {
                "ingress_network_interface_ids": [
                    str(interface_b.id), str(interface_a.id), str(interface_a.id)
                ],
                "ingress_l3_binding_ids": [str(binding.id), str(binding.id)],
            },
        )
        record = repository.get_packet_processing_plan_attachment_set(
            context.id, "TRANSIT"
        )

    assert attachment.scope == {
        "ingress_l3_binding_ids": [str(binding.id)],
        "ingress_network_interface_ids": sorted(
            [str(interface_a.id), str(interface_b.id)]
        ),
    }
    assert record is not None
    assert record.attachments[0].attachment_id == attachment.id


@pytest.mark.parametrize(
    "scope",
    [
        {"traffic_classes": ["TRANSIT"]},
        {"routing_context_ids": [str(uuid.uuid4())]},
        {"egress_network_interface_ids": [str(uuid.uuid4())]},
        {"egress_l3_binding_ids": [str(uuid.uuid4())]},
    ],
)
def test_attachment_scope_rejects_non_ingress_dimensions(scope):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        plan = add_plan(repository)
        attachment_set = add_set(repository, context.id)
        with pytest.raises(ValidationError):
            repository.add_packet_processing_plan_attachment(
                attachment_set.id, plan.id, scope
            )


def test_attachment_set_unique_domain_and_plan_entry_validation():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        attachment_set = add_set(repository, context.id)
        with pytest.raises(ValidationError):
            add_set(repository, context.id)
        wrong_plan = add_plan(repository, "LOCAL_INPUT")
        with pytest.raises(ValidationError):
            repository.add_packet_processing_plan_attachment(
                attachment_set.id, wrong_plan.id, {}
            )


@pytest.mark.parametrize("completeness", ["PARTIAL", "UNKNOWN"])
def test_incomplete_empty_set_is_unknown(completeness):
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        add_set(repository, context.id, completeness)
        context_id = context.id

    artifact = select_plan(context_id).json()
    assert artifact["result"] == "UNKNOWN"
    assert {gap["code"] for gap in artifact["gaps"]} == {
        "PLAN_ATTACHMENT_COVERAGE_INCOMPLETE"
    }


def test_missing_set_is_unknown_but_complete_empty_set_confirms_no_plan():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        missing_context = repository.add_routing_context()
        complete_context = repository.add_routing_context()
        add_set(repository, complete_context.id)
        missing_id, complete_id = missing_context.id, complete_context.id

    missing = select_plan(missing_id).json()
    complete = select_plan(complete_id).json()
    assert missing["result"] == "UNKNOWN"
    assert missing["gaps"][0]["code"] == "PLAN_ATTACHMENT_SET_UNKNOWN"
    assert complete["result"] == "NO_PLAN_CONFIRMED"
    assert complete["gaps"] == []


def test_complete_selection_same_plan_collapse_and_different_plan_conflict():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        selected_context = repository.add_routing_context()
        conflict_context = repository.add_routing_context()
        plan_p = add_plan(repository)
        plan_q = add_plan(repository)
        selected_set = add_set(repository, selected_context.id)
        conflict_set = add_set(repository, conflict_context.id)
        for _ in range(2):
            repository.add_packet_processing_plan_attachment(
                selected_set.id, plan_p.id, {}
            )
        repository.add_packet_processing_plan_attachment(conflict_set.id, plan_p.id, {})
        repository.add_packet_processing_plan_attachment(conflict_set.id, plan_q.id, {})
        selected_id, conflict_id = selected_context.id, conflict_context.id

    selected = select_plan(selected_id).json()
    conflict = select_plan(conflict_id).json()
    assert selected["result"] == "PLAN_SELECTED"
    assert selected["selected_plan_id"] == str(plan_p.id)
    assert len(selected["attachment_evaluations"]) == 2
    assert conflict["result"] == "CONFLICTING"
    assert conflict["gaps"][0]["code"] == "PLAN_SELECTION_CONFLICT"


def test_unknown_applicability_collapses_only_to_same_definite_plan():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        same_context = repository.add_routing_context()
        different_context = repository.add_routing_context()
        interface = repository.add_network_interface()
        plan_p = add_plan(repository)
        plan_q = add_plan(repository)
        same_set = add_set(repository, same_context.id)
        different_set = add_set(repository, different_context.id)
        for attachment_set, unknown_plan in ((same_set, plan_p), (different_set, plan_q)):
            repository.add_packet_processing_plan_attachment(attachment_set.id, plan_p.id, {})
            repository.add_packet_processing_plan_attachment(
                attachment_set.id,
                unknown_plan.id,
                {"ingress_network_interface_ids": [str(interface.id)]},
            )
        same_id, different_id = same_context.id, different_context.id

    same = select_plan(same_id).json()
    different = select_plan(different_id).json()
    assert same["result"] == "PLAN_SELECTED"
    assert different["result"] == "UNKNOWN"
    assert "PLAN_ATTACHMENT_APPLICABILITY_UNKNOWN" in {
        gap["code"] for gap in different["gaps"]
    }


def test_no_true_with_unknown_is_unknown_and_all_false_confirms_no_plan():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        unknown_context = repository.add_routing_context()
        false_context = repository.add_routing_context()
        interface_a = repository.add_network_interface()
        interface_b = repository.add_network_interface()
        plan = add_plan(repository)
        for context, runtime_interface in (
            (unknown_context, None), (false_context, interface_b.id)
        ):
            attachment_set = add_set(repository, context.id)
            repository.add_packet_processing_plan_attachment(
                attachment_set.id,
                plan.id,
                {"ingress_network_interface_ids": [str(interface_a.id)]},
            )
        unknown_id, false_id = unknown_context.id, false_context.id

    assert select_plan(unknown_id).json()["result"] == "UNKNOWN"
    assert select_plan(
        false_id, ingress_network_interface_id=interface_b.id
    ).json()["result"] == "NO_PLAN_CONFIRMED"


def test_partial_definite_conflict_remains_conflicting_but_single_plan_is_unknown():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        one_context = repository.add_routing_context()
        conflict_context = repository.add_routing_context()
        plan_p = add_plan(repository)
        plan_q = add_plan(repository)
        one_set = add_set(repository, one_context.id, "PARTIAL")
        conflict_set = add_set(repository, conflict_context.id, "PARTIAL")
        repository.add_packet_processing_plan_attachment(one_set.id, plan_p.id, {})
        repository.add_packet_processing_plan_attachment(conflict_set.id, plan_p.id, {})
        repository.add_packet_processing_plan_attachment(conflict_set.id, plan_q.id, {})
        one_id, conflict_id = one_context.id, conflict_context.id

    assert select_plan(one_id).json()["result"] == "UNKNOWN"
    assert select_plan(conflict_id).json()["result"] == "CONFLICTING"


def test_query_context_consistency_is_validation_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context_a = repository.add_routing_context()
        context_b = repository.add_routing_context()
        interface_a = repository.add_network_interface()
        interface_b = repository.add_network_interface()
        binding = repository.add_l3_binding(interface_a.id, context_b.id)
        ids = context_a.id, interface_b.id, binding.id

    response = select_plan(
        ids[0],
        ingress_network_interface_id=ids[1],
        ingress_l3_binding_id=ids[2],
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_corrupt_unrelated_set_is_not_scanned():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        requested = repository.add_routing_context()
        unrelated = repository.add_routing_context()
        add_set(repository, requested.id)
        broken = add_set(repository, unrelated.id)
        interface = repository.add_network_interface()
        plan = add_plan(repository)
        attachment = repository.add_packet_processing_plan_attachment(
            broken.id,
            plan.id,
            {"ingress_network_interface_ids": [str(interface.id)]},
        )
        session.execute(
            text(
                "UPDATE packet_processing_plan_attachments "
                "SET scope=jsonb_build_object('unsupported', jsonb_build_array('x')) "
                "WHERE id=:id"
            ),
            {"id": attachment.id},
        )
        requested_id = requested.id

    assert select_plan(requested_id).json()["result"] == "NO_PLAN_CONFIRMED"


def test_direct_db_noncanonical_scope_is_model_error():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        interface = repository.add_network_interface()
        plan = add_plan(repository)
        attachment_set = add_set(repository, context.id)
        attachment = repository.add_packet_processing_plan_attachment(
            attachment_set.id,
            plan.id,
            {"ingress_network_interface_ids": [str(interface.id)]},
        )
        session.execute(
            text(
                "UPDATE packet_processing_plan_attachments "
                "SET scope=jsonb_build_object('ingress_network_interface_ids', "
                "jsonb_build_array(CAST(:id AS text), CAST(:id AS text))) WHERE id=:attachment"
            ),
            {"id": interface.id, "attachment": attachment.id},
        )
        with pytest.raises(ModelError):
            repository.get_packet_processing_plan_attachment_set(
                context.id, "TRANSIT"
            )


def test_selected_partial_plan_is_allowed_and_not_executed():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        context = repository.add_routing_context()
        plan = add_plan(repository, completeness="PARTIAL")
        attachment_set = add_set(repository, context.id)
        repository.add_packet_processing_plan_attachment(
            attachment_set.id, plan.id, {}
        )
        context_id = context.id

    artifact = select_plan(context_id).json()
    assert artifact["result"] == "PLAN_SELECTED"
    assert artifact["selected_plan_configured_completeness"] == "PARTIAL"
    assert "branches" not in artifact


def test_m9_1_handoff_context_selects_transit_or_local_input_without_execution():
    with SessionLocal.begin() as session:
        repository = CanonicalRepository(session)
        receiving_context = repository.add_routing_context()
        receiving_interface = repository.add_network_interface()
        receiving_binding = repository.add_l3_binding(
            receiving_interface.id, receiving_context.id
        )
        transit_plan = add_plan(repository, "TRANSIT")
        local_plan = add_plan(repository, "LOCAL_INPUT")
        for traffic_class, plan in (
            ("TRANSIT", transit_plan),
            ("LOCAL_INPUT", local_plan),
        ):
            attachment_set = add_set(
                repository, receiving_context.id, traffic_class=traffic_class
            )
            repository.add_packet_processing_plan_attachment(
                attachment_set.id,
                plan.id,
                {"ingress_l3_binding_ids": [str(receiving_binding.id)]},
            )
        ids = receiving_context.id, receiving_interface.id, receiving_binding.id

    common = {
        "ingress_network_interface_id": ids[1],
        "ingress_l3_binding_id": ids[2],
    }
    transit = select_plan(ids[0], "TRANSIT", **common).json()
    local = select_plan(ids[0], "LOCAL_INPUT", **common).json()

    assert transit["result"] == "PLAN_SELECTED"
    assert transit["selected_plan_id"] == str(transit_plan.id)
    assert local["result"] == "PLAN_SELECTED"
    assert local["selected_plan_id"] == str(local_plan.id)
    assert "branches" not in transit and "branches" not in local
