import uuid
from collections.abc import Callable
from typing import TypeAlias

from app.errors import ModelError, ValidationError


SecurityScope: TypeAlias = dict[str, list[str]]

TRAFFIC_CLASSES = {"TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"}
SCOPE_ENTITY_TYPES = {
    "routing_context_ids": "RoutingContext",
    "ingress_network_interface_ids": "NetworkInterface",
    "egress_network_interface_ids": "NetworkInterface",
    "ingress_l3_binding_ids": "L3Binding",
    "egress_l3_binding_ids": "L3Binding",
}
ALLOWED_SCOPE_KEYS = {"traffic_classes", *SCOPE_ENTITY_TYPES}


def normalize_security_scope(
    scope: object,
    *,
    model_error: bool,
    entity_exists: Callable[[str, uuid.UUID], bool],
    details: dict[str, object] | None = None,
) -> SecurityScope:
    error_type = ModelError if model_error else ValidationError
    error_details = details or {}
    if not isinstance(scope, dict):
        raise error_type("SecurityPolicyAttachment scope must be an object", error_details)
    unknown = set(scope) - ALLOWED_SCOPE_KEYS
    if unknown:
        raise error_type(
            "SecurityPolicyAttachment scope has unsupported dimensions",
            {**error_details, "dimensions": sorted(str(item) for item in unknown)},
        )

    normalized: SecurityScope = {}
    for key, raw_values in scope.items():
        if not isinstance(raw_values, list) or not raw_values:
            raise error_type(
                "SecurityPolicyAttachment scope dimensions must be non-empty arrays",
                {**error_details, "dimension": key},
            )
        if key == "traffic_classes":
            if any(not isinstance(item, str) or item not in TRAFFIC_CLASSES for item in raw_values):
                raise error_type(
                    "SecurityPolicyAttachment traffic class is invalid",
                    {**error_details, "dimension": key},
                )
            values = sorted(set(raw_values))
        else:
            values_set: set[str] = set()
            for item in raw_values:
                try:
                    parsed = uuid.UUID(str(item))
                except (ValueError, TypeError, AttributeError) as exc:
                    raise error_type(
                        "SecurityPolicyAttachment scope ID is invalid",
                        {**error_details, "dimension": key, "value": str(item)},
                    ) from exc
                if not entity_exists(SCOPE_ENTITY_TYPES[key], parsed):
                    raise error_type(
                        "SecurityPolicyAttachment scope refers to a missing canonical entity",
                        {
                            **error_details,
                            "dimension": key,
                            "entity_type": SCOPE_ENTITY_TYPES[key],
                            "entity_id": str(parsed),
                        },
                    )
                values_set.add(str(parsed))
            values = sorted(values_set)
        normalized[key] = values

    normalized = {key: normalized[key] for key in sorted(normalized)}
    if model_error and scope != normalized:
        raise ModelError(
            "SecurityPolicyAttachment scope is not canonical",
            {**error_details, "canonical_scope": normalized},
        )
    return normalized
