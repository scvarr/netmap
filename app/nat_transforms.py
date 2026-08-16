import uuid
from collections.abc import Callable
from ipaddress import ip_address
from typing import TypeAlias

from app.errors import ModelError, ValidationError
from app.nat_pools import NATPoolRangeSet
from app.schemas import NATPacketConstraint, NATTransformApplication, PacketState


NATTransform: TypeAlias = dict[str, object]
NATPoolLookup: TypeAlias = Callable[[uuid.UUID], NATPoolRangeSet]

_IP_FIELDS = {"source_ip", "destination_ip"}
_PORT_FIELDS = {"source_port", "destination_port"}
_TRANSFORM_FIELDS = _IP_FIELDS | _PORT_FIELDS


def normalize_nat_transform(
    transform: object,
    *,
    model_error: bool,
    pool_lookup: NATPoolLookup | None = None,
    details: dict[str, object] | None = None,
) -> NATTransform:
    error_type = ModelError if model_error else ValidationError
    context = details or {}

    def fail(message: str, field: str | None = None) -> None:
        extra = {"transform_field": field} if field is not None else {}
        raise error_type(message, {**context, **extra})

    if not isinstance(transform, dict) or not isinstance(transform.get("op"), str):
        fail("NATTransform must be an object with a string op")
    op = transform["op"]
    if op == "IDENTITY":
        if set(transform) != {"op"}:
            fail("IDENTITY NATTransform has unexpected fields")
        normalized: NATTransform = {"op": "IDENTITY"}
    elif op == "TRANSFORM":
        fields = set(transform) - {"op"}
        if not fields:
            fail("TRANSFORM NATTransform must change at least one field")
        unknown = fields - _TRANSFORM_FIELDS
        if unknown:
            fail(
                "TRANSFORM NATTransform has unsupported fields",
                sorted(unknown)[0],
            )
        normalized = {"op": "TRANSFORM"}
        for field in sorted(fields):
            field_transform = transform[field]
            if not isinstance(field_transform, dict):
                fail("NAT field transform must be an object", field)
            field_op = field_transform.get("op")
            if field_op == "REPLACE_EXACT":
                if set(field_transform) != {"op", "value"}:
                    fail(
                        "REPLACE_EXACT NAT field transform requires one value",
                        field,
                    )
                value = field_transform["value"]
                if field in _IP_FIELDS:
                    if not isinstance(value, str):
                        fail("NAT IP replacement must be a string exact address", field)
                    try:
                        canonical_value: str | int = str(ip_address(value))
                    except ValueError as exc:
                        raise error_type(
                            "NAT IP replacement is invalid",
                            {**context, "transform_field": field},
                        ) from exc
                else:
                    if (
                        not isinstance(value, int)
                        or isinstance(value, bool)
                        or not 0 <= value <= 65535
                    ):
                        fail(
                            "NAT port replacement must be an integer from 0 to 65535",
                            field,
                        )
                    canonical_value = value
                normalized[field] = {
                    "op": "REPLACE_EXACT",
                    "value": canonical_value,
                }
            elif field_op == "SELECT_FROM":
                if set(field_transform) != {"op", "pool_id"}:
                    fail(
                        "SELECT_FROM NAT field transform requires one pool_id",
                        field,
                    )
                try:
                    pool_id = uuid.UUID(str(field_transform["pool_id"]))
                except (ValueError, TypeError, AttributeError) as exc:
                    raise error_type(
                        "SELECT_FROM NAT pool_id is invalid",
                        {**context, "transform_field": field},
                    ) from exc
                if pool_lookup is None:
                    fail("SELECT_FROM NAT field transform requires a NATPool lookup", field)
                pool = pool_lookup(pool_id)
                if field in _IP_FIELDS and not pool.address_ranges:
                    fail("SELECT_FROM IP field requires a NATPool with addresses", field)
                if field in _PORT_FIELDS and not pool.port_ranges:
                    fail("SELECT_FROM port field requires a NATPool with ports", field)
                normalized[field] = {
                    "op": "SELECT_FROM",
                    "pool_id": str(pool_id),
                }
            else:
                fail("NAT field transform op is unsupported", field)
    else:
        fail("NATTransform op is unsupported")
        raise AssertionError("unreachable")

    if model_error and transform != normalized:
        raise ModelError(
            "NATTransform is not canonical",
            {**context, "canonical_transform": normalized},
        )
    return normalized


def apply_nat_transform(
    transform: NATTransform,
    packet_before: PacketState,
    *,
    pool_lookup: NATPoolLookup | None = None,
) -> NATTransformApplication:
    if transform["op"] == "IDENTITY":
        return NATTransformApplication(
            result="IDENTITY",
            packet_after=packet_before,
        )

    updates: dict[str, str | int] = {}
    constraints: dict[str, object] = {}
    pool_ids: list[uuid.UUID] = []
    for field, field_transform in transform.items():
        if field == "op" or not isinstance(field_transform, dict):
            continue
        if field_transform["op"] == "REPLACE_EXACT":
            updates[field] = field_transform["value"]  # type: ignore[assignment]
            continue
        if pool_lookup is None:
            raise ModelError(
                "SELECT_FROM transform cannot be applied without NATPool facts",
                {"transform_field": field},
            )
        pool_id = uuid.UUID(str(field_transform["pool_id"]))
        pool = pool_lookup(pool_id)
        if pool_id not in pool_ids:
            pool_ids.append(pool_id)
        ranges = pool.address_ranges if field in _IP_FIELDS else pool.port_ranges
        if len(ranges) == 1 and ranges[0]["start"] == ranges[0]["end"]:
            updates[field] = ranges[0]["start"]  # type: ignore[assignment]
        else:
            constraints[f"{field}_ranges"] = list(ranges)

    packet_base = PacketState.model_validate(
        {**packet_before.model_dump(mode="json"), **updates}
    )
    if constraints:
        return NATTransformApplication(
            result="TRANSFORMED_CONSTRAINED",
            packet_after_constraint=NATPacketConstraint(
                packet_base=packet_base,
                **constraints,
            ),
            nat_pool_ids=pool_ids,
        )
    return NATTransformApplication(
        result="TRANSFORMED_EXACT",
        packet_after=packet_base,
        nat_pool_ids=pool_ids,
    )
