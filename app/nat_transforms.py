from ipaddress import ip_address
from typing import TypeAlias

from app.errors import ModelError, ValidationError
from app.schemas import PacketState


NATTransform: TypeAlias = dict[str, object]

_IP_FIELDS = {"source_ip", "destination_ip"}
_PORT_FIELDS = {"source_port", "destination_port"}
_TRANSFORM_FIELDS = _IP_FIELDS | _PORT_FIELDS


def normalize_nat_transform(
    transform: object,
    *,
    model_error: bool,
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
            if (
                not isinstance(field_transform, dict)
                or set(field_transform) != {"op", "value"}
                or field_transform.get("op") != "REPLACE_EXACT"
            ):
                fail(
                    "NAT field transform must be REPLACE_EXACT with one value",
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
                    fail("NAT port replacement must be an integer from 0 to 65535", field)
                canonical_value = value
            normalized[field] = {
                "op": "REPLACE_EXACT",
                "value": canonical_value,
            }
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
    transform: NATTransform, packet_before: PacketState
) -> PacketState:
    if transform["op"] == "IDENTITY":
        return packet_before
    updates = {
        field: field_transform["value"]
        for field, field_transform in transform.items()
        if field != "op" and isinstance(field_transform, dict)
    }
    return PacketState.model_validate(
        {**packet_before.model_dump(mode="json"), **updates}
    )
