import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol, TypeAlias

from app.errors import ModelError, ValidationError


ProcessingScope: TypeAlias = dict[str, list[str]]

TRAFFIC_CLASSES = {"TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"}
SCOPE_ENTITY_TYPES = {
    "routing_context_ids": "RoutingContext",
    "ingress_network_interface_ids": "NetworkInterface",
    "egress_network_interface_ids": "NetworkInterface",
    "ingress_l3_binding_ids": "L3Binding",
    "egress_l3_binding_ids": "L3Binding",
}
SCOPE_CONTEXT_FIELDS = {
    "traffic_classes": "traffic_class",
    "routing_context_ids": "routing_context_id",
    "ingress_network_interface_ids": "ingress_network_interface_id",
    "egress_network_interface_ids": "egress_network_interface_id",
    "ingress_l3_binding_ids": "ingress_l3_binding_id",
    "egress_l3_binding_ids": "egress_l3_binding_id",
}
ALLOWED_SCOPE_KEYS = set(SCOPE_CONTEXT_FIELDS)


class ProcessingScopeContext(Protocol):
    traffic_class: str
    routing_context_id: uuid.UUID | None
    ingress_network_interface_id: uuid.UUID | None
    egress_network_interface_id: uuid.UUID | None
    ingress_l3_binding_id: uuid.UUID | None
    egress_l3_binding_id: uuid.UUID | None


@dataclass(frozen=True)
class ProcessingScopeEvaluation:
    applicability: str
    canonical_refs: tuple[tuple[str, uuid.UUID], ...]


def normalize_processing_scope(
    scope: object,
    *,
    model_error: bool,
    entity_exists: Callable[[str, uuid.UUID], bool],
    attachment_type: str,
    details: dict[str, object] | None = None,
) -> ProcessingScope:
    error_type = ModelError if model_error else ValidationError
    error_details = details or {}
    if not isinstance(scope, dict):
        raise error_type(f"{attachment_type} scope must be an object", error_details)
    unknown = set(scope) - ALLOWED_SCOPE_KEYS
    if unknown:
        raise error_type(
            f"{attachment_type} scope has unsupported dimensions",
            {**error_details, "dimensions": sorted(str(item) for item in unknown)},
        )

    normalized: ProcessingScope = {}
    for key, raw_values in scope.items():
        if not isinstance(raw_values, list) or not raw_values:
            raise error_type(
                f"{attachment_type} scope dimensions must be non-empty arrays",
                {**error_details, "dimension": key},
            )
        if key == "traffic_classes":
            if any(
                not isinstance(item, str) or item not in TRAFFIC_CLASSES
                for item in raw_values
            ):
                raise error_type(
                    f"{attachment_type} traffic class is invalid",
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
                        f"{attachment_type} scope ID is invalid",
                        {**error_details, "dimension": key, "value": str(item)},
                    ) from exc
                entity_type = SCOPE_ENTITY_TYPES[key]
                if not entity_exists(entity_type, parsed):
                    raise error_type(
                        f"{attachment_type} scope refers to a missing canonical entity",
                        {
                            **error_details,
                            "dimension": key,
                            "entity_type": entity_type,
                            "entity_id": str(parsed),
                        },
                    )
                values_set.add(str(parsed))
            values = sorted(values_set)
        normalized[key] = values

    normalized = {key: normalized[key] for key in sorted(normalized)}
    if model_error and scope != normalized:
        raise ModelError(
            f"{attachment_type} scope is not canonical",
            {**error_details, "canonical_scope": normalized},
        )
    return normalized


def evaluate_processing_scope(
    scope: ProcessingScope, context: ProcessingScopeContext
) -> ProcessingScopeEvaluation:
    has_unknown = False
    refs: list[tuple[str, uuid.UUID]] = []
    for dimension, allowed in scope.items():
        runtime_value = getattr(context, SCOPE_CONTEXT_FIELDS[dimension])
        if runtime_value is None:
            has_unknown = True
            continue
        if dimension in SCOPE_ENTITY_TYPES:
            refs.append((SCOPE_ENTITY_TYPES[dimension], runtime_value))
        if str(runtime_value) not in allowed:
            return ProcessingScopeEvaluation("FALSE", tuple(_dedupe_refs(refs)))
    return ProcessingScopeEvaluation(
        "UNKNOWN" if has_unknown else "TRUE", tuple(_dedupe_refs(refs))
    )


def _dedupe_refs(
    refs: list[tuple[str, uuid.UUID]],
) -> list[tuple[str, uuid.UUID]]:
    result: list[tuple[str, uuid.UUID]] = []
    seen: set[tuple[str, uuid.UUID]] = set()
    for ref in refs:
        if ref not in seen:
            seen.add(ref)
            result.append(ref)
    return result
