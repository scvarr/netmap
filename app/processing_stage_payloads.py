import uuid
from collections.abc import Callable
from typing import TypeAlias

from app.errors import ModelError, ValidationError


ProcessingStagePayload: TypeAlias = dict[str, str]

SUPPORTED_STAGE_KINDS = (
    "ROUTING_POLICY",
    "ROUTE_DECISION",
    "SECURITY",
    "NAT",
    "ADJACENCY_L2",
    "TERMINATE",
)

STAGE_OUTCOMES: dict[str, tuple[str, ...]] = {
    "ROUTING_POLICY": ("TABLE_SELECTED", "TABLE_SELECTION_UNKNOWN"),
    "ROUTE_DECISION": (
        "FORWARD",
        "LOCAL",
        "DISCARD",
        "NO_ROUTE",
        "UNKNOWN",
        "CONFLICTING",
    ),
    "SECURITY": ("PASS", "BLOCKED", "UNKNOWN"),
    "NAT": (
        "IDENTITY",
        "TRANSFORMED_EXACT",
        "TRANSFORMED_CONSTRAINED",
        "UNKNOWN",
    ),
    "ADJACENCY_L2": (
        "NEXT_PROCESSING_POINT",
        "TARGET_ATTACHMENT_REACHED",
        "L2_UNREACHABLE",
        "UNKNOWN",
    ),
    "TERMINATE": (),
}

TERMINATE_OUTCOMES = (
    "CONTINUE_TO_NEXT_HOP",
    "NETWORK_DELIVERY",
    "NOT_DELIVERED",
    "UNKNOWN",
)

_REFERENCE_PAYLOADS = {
    "ROUTING_POLICY": ("policy_id", "RoutingPolicy"),
    "SECURITY": ("attachment_id", "SecurityPolicyAttachment"),
    "NAT": ("attachment_id", "NATPolicyAttachment"),
}


def normalize_processing_stage_payload(
    kind: object,
    payload: object,
    *,
    model_error: bool,
    reference_exists: Callable[[str, uuid.UUID], bool],
    details: dict[str, object] | None = None,
) -> ProcessingStagePayload:
    error_type = ModelError if model_error else ValidationError
    context = details or {}
    if kind not in SUPPORTED_STAGE_KINDS:
        raise error_type(
            "ProcessingStage kind is unsupported in M8.1",
            {**context, "kind": kind},
        )
    if not isinstance(payload, dict):
        raise error_type("ProcessingStage payload must be an object", context)

    if kind in {"ROUTE_DECISION", "ADJACENCY_L2"}:
        if payload:
            raise error_type(
                f"{kind} payload must be empty",
                {**context, "payload_keys": sorted(str(key) for key in payload)},
            )
        return {}

    if kind == "TERMINATE":
        if set(payload) != {"outcome"} or payload.get("outcome") not in TERMINATE_OUTCOMES:
            raise error_type(
                "TERMINATE payload requires exactly one supported outcome",
                {**context, "outcome": payload.get("outcome")},
            )
        return {"outcome": payload["outcome"]}  # type: ignore[dict-item]

    key, entity_type = _REFERENCE_PAYLOADS[kind]
    if set(payload) != {key}:
        raise error_type(
            f"{kind} payload requires exactly {key}",
            {**context, "payload_keys": sorted(str(item) for item in payload)},
        )
    raw_id = payload.get(key)
    if not isinstance(raw_id, str):
        raise error_type(
            f"{kind} {key} must be a canonical UUID string",
            context,
        )
    try:
        entity_id = uuid.UUID(raw_id)
    except ValueError as exc:
        raise error_type(
            f"{kind} {key} is invalid",
            {**context, key: raw_id},
        ) from exc
    if raw_id != str(entity_id):
        raise error_type(
            f"{kind} {key} is not canonical",
            {**context, key: raw_id, f"canonical_{key}": str(entity_id)},
        )
    if not reference_exists(entity_type, entity_id):
        raise error_type(
            f"{kind} payload refers to a missing canonical entity",
            {**context, "entity_type": entity_type, "entity_id": str(entity_id)},
        )
    normalized = {key: str(entity_id)}
    if model_error and payload != normalized:
        raise ModelError(
            "ProcessingStage payload is not canonical",
            {**context, "canonical_payload": normalized},
        )
    return normalized


def processing_stage_payload_reference(
    kind: str, payload: ProcessingStagePayload
) -> tuple[str, uuid.UUID] | None:
    reference = _REFERENCE_PAYLOADS.get(kind)
    if reference is None:
        return None
    key, entity_type = reference
    return entity_type, uuid.UUID(payload[key])
