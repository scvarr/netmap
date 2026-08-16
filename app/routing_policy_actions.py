import uuid
from collections.abc import Callable
from typing import TypeAlias

from app.errors import ModelError, ValidationError


RoutingTableSelection: TypeAlias = dict[str, str]


def normalize_routing_table_selection(
    selection: object,
    *,
    model_error: bool,
    table_lookup: Callable[[uuid.UUID], object],
    details: dict[str, str] | None = None,
) -> RoutingTableSelection:
    error_type = ModelError if model_error else ValidationError
    context = details or {}
    if not isinstance(selection, dict) or set(selection) != {
        "op",
        "routing_table_id",
    }:
        raise error_type(
            "RoutingPolicy selection requires exactly op and routing_table_id",
            context,
        )
    if selection.get("op") != "SELECT_TABLE":
        raise error_type(
            "RoutingPolicy selection op is unsupported",
            {**context, "op": selection.get("op")},
        )
    raw_table_id = selection.get("routing_table_id")
    if not isinstance(raw_table_id, str):
        raise error_type(
            "RoutingPolicy routing_table_id must be a canonical UUID string",
            context,
        )
    try:
        table_id = uuid.UUID(raw_table_id)
    except ValueError as exc:
        raise error_type(
            "RoutingPolicy routing_table_id is invalid",
            {**context, "routing_table_id": raw_table_id},
        ) from exc
    normalized = {"op": "SELECT_TABLE", "routing_table_id": str(table_id)}
    if raw_table_id != normalized["routing_table_id"]:
        raise error_type(
            "RoutingPolicy routing_table_id is not canonical",
            {
                **context,
                "routing_table_id": raw_table_id,
                "canonical_routing_table_id": str(table_id),
            },
        )
    table_lookup(table_id)
    if model_error and selection != normalized:
        raise ModelError(
            "RoutingPolicy selection is not canonical",
            {**context, "canonical_selection": normalized},
        )
    return normalized
