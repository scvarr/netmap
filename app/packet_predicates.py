from dataclasses import dataclass
from ipaddress import ip_address, ip_network
from typing import Literal

from app.errors import ModelError, ValidationError
from app.schemas import ConnectionState, PacketState


TruthValue = Literal["TRUE", "FALSE", "UNKNOWN"]
Predicate = dict[str, object]


@dataclass(frozen=True)
class PacketPredicateEvaluationContext:
    packet_state: PacketState
    connection_state: ConnectionState | None = None


_VALUE_LIMITS = {
    "IP_PROTOCOL_IN": 255,
    "ICMP_TYPE_IN": 255,
    "ICMP_CODE_IN": 255,
}
_RANGE_FIELDS = {
    "SOURCE_PORT_IN": "source_port",
    "DESTINATION_PORT_IN": "destination_port",
}
_IP_FIELDS = {
    "SOURCE_IP_IN": "source_ip",
    "DESTINATION_IP_IN": "destination_ip",
}
_VALUE_FIELDS = {
    "IP_PROTOCOL_IN": "ip_protocol",
    "ICMP_TYPE_IN": "icmp_type",
    "ICMP_CODE_IN": "icmp_code",
}
_CONCRETE_CONNECTION_STATES = tuple(
    state.value for state in ConnectionState if state is not ConnectionState.UNKNOWN
)


def normalize_predicate(
    predicate: object,
    *,
    model_error: bool,
    details: dict[str, str] | None = None,
) -> Predicate:
    error_type = ModelError if model_error else ValidationError
    context = details or {}

    def fail(message: str, path: str) -> None:
        raise error_type(message, {**context, "predicate_path": path})

    def normalize(value: object, path: str) -> Predicate:
        if not isinstance(value, dict) or not isinstance(value.get("op"), str):
            fail("Packet predicate must be an object with a string op", path)
        op = value["op"]
        if op in {"TRUE", "FALSE"}:
            if set(value) != {"op"}:
                fail(f"{op} predicate has unexpected fields", path)
            return {"op": op}
        if op in {"ALL", "ANY"}:
            if set(value) != {"op", "children"} or not isinstance(
                value.get("children"), list
            ):
                fail(f"{op} predicate requires a children array", path)
            children = value["children"]
            return {
                "op": op,
                "children": [
                    normalize(child, f"{path}.children[{index}]")
                    for index, child in enumerate(children)
                ],
            }
        if op == "NOT":
            if set(value) != {"op", "child"}:
                fail("NOT predicate requires exactly one child", path)
            return {"op": op, "child": normalize(value["child"], f"{path}.child")}
        if op in _IP_FIELDS:
            if set(value) != {"op", "prefixes"} or not isinstance(
                value.get("prefixes"), list
            ):
                fail(f"{op} predicate requires a prefixes array", path)
            prefixes = value["prefixes"]
            normalized_prefixes: list[str] = []
            for index, prefix in enumerate(prefixes):
                if not isinstance(prefix, str):
                    fail("Packet predicate prefix must be a string", f"{path}.prefixes[{index}]")
                try:
                    normalized_prefixes.append(str(ip_network(prefix, strict=False)))
                except ValueError as exc:
                    raise error_type(
                        "Packet predicate prefix is invalid",
                        {**context, "predicate_path": f"{path}.prefixes[{index}]"},
                    ) from exc
            return {"op": op, "prefixes": normalized_prefixes}
        if op in _VALUE_LIMITS:
            if set(value) != {"op", "values"} or not isinstance(
                value.get("values"), list
            ):
                fail(f"{op} predicate requires a values array", path)
            maximum = _VALUE_LIMITS[op]
            values = value["values"]
            for index, item in enumerate(values):
                if (
                    not isinstance(item, int)
                    or isinstance(item, bool)
                    or not 0 <= item <= maximum
                ):
                    fail(
                        f"{op} value must be an integer from 0 to {maximum}",
                        f"{path}.values[{index}]",
                    )
            return {"op": op, "values": list(values)}
        if op == "CONNECTION_STATE_IN":
            if set(value) != {"op", "values"} or not isinstance(
                value.get("values"), list
            ):
                fail("CONNECTION_STATE_IN predicate requires a values array", path)
            values = value["values"]
            if not values:
                fail("CONNECTION_STATE_IN values must be non-empty", f"{path}.values")
            if any(
                not isinstance(item, str)
                or item not in _CONCRETE_CONNECTION_STATES
                for item in values
            ):
                fail(
                    "CONNECTION_STATE_IN value must be a concrete ConnectionState",
                    f"{path}.values",
                )
            normalized_values = [
                state for state in _CONCRETE_CONNECTION_STATES if state in values
            ]
            return {"op": op, "values": normalized_values}
        if op in _RANGE_FIELDS:
            if set(value) != {"op", "ranges"} or not isinstance(
                value.get("ranges"), list
            ):
                fail(f"{op} predicate requires a ranges array", path)
            ranges = value["ranges"]
            normalized_ranges: list[dict[str, int]] = []
            for index, item in enumerate(ranges):
                range_path = f"{path}.ranges[{index}]"
                if not isinstance(item, dict) or set(item) != {"start", "end"}:
                    fail("Port range requires exactly start and end", range_path)
                start = item["start"]
                end = item["end"]
                if (
                    not isinstance(start, int)
                    or isinstance(start, bool)
                    or not isinstance(end, int)
                    or isinstance(end, bool)
                    or not 0 <= start <= end <= 65535
                ):
                    fail("Port range must satisfy 0 <= start <= end <= 65535", range_path)
                normalized_ranges.append({"start": start, "end": end})
            return {"op": op, "ranges": normalized_ranges}
        fail("Security predicate op is unsupported", path)
        raise AssertionError("unreachable")

    normalized = normalize(predicate, "$")
    if model_error and predicate != normalized:
        raise ModelError(
            "Packet predicate is not canonical",
            {**context, "canonical_predicate": normalized},
        )
    return normalized


def evaluate_predicate(
    predicate: Predicate, context: PacketPredicateEvaluationContext
) -> TruthValue:
    op = predicate["op"]
    if op in {"TRUE", "FALSE"}:
        return op  # type: ignore[return-value]
    if op == "NOT":
        result = evaluate_predicate(predicate["child"], context)  # type: ignore[arg-type]
        return {"TRUE": "FALSE", "FALSE": "TRUE", "UNKNOWN": "UNKNOWN"}[
            result
        ]  # type: ignore[return-value]
    if op == "ALL":
        results = [
            evaluate_predicate(child, context)
            for child in predicate["children"]  # type: ignore[union-attr]
        ]
        if "FALSE" in results:
            return "FALSE"
        if "UNKNOWN" in results:
            return "UNKNOWN"
        return "TRUE"
    if op == "ANY":
        results = [
            evaluate_predicate(child, context)
            for child in predicate["children"]  # type: ignore[union-attr]
        ]
        if "TRUE" in results:
            return "TRUE"
        if "UNKNOWN" in results:
            return "UNKNOWN"
        return "FALSE"
    if op in _IP_FIELDS:
        packet_value = getattr(context.packet_state, _IP_FIELDS[op])
        if packet_value is None:
            return "UNKNOWN"
        address = ip_address(str(packet_value))
        for prefix in predicate["prefixes"]:  # type: ignore[union-attr]
            network = ip_network(prefix)
            if address.version == network.version and address in network:
                return "TRUE"
        return "FALSE"
    if op in _VALUE_FIELDS:
        packet_value = getattr(context.packet_state, _VALUE_FIELDS[op])
        if packet_value is None:
            return "UNKNOWN"
        return "TRUE" if packet_value in predicate["values"] else "FALSE"  # type: ignore[operator]
    if op in _RANGE_FIELDS:
        packet_value = getattr(context.packet_state, _RANGE_FIELDS[op])
        if packet_value is None:
            return "UNKNOWN"
        return (
            "TRUE"
            if any(
                item["start"] <= packet_value <= item["end"]
                for item in predicate["ranges"]  # type: ignore[union-attr]
            )
            else "FALSE"
        )
    if op == "CONNECTION_STATE_IN":
        connection_state = context.connection_state
        if connection_state is None or connection_state is ConnectionState.UNKNOWN:
            return "UNKNOWN"
        return (
            "TRUE"
            if connection_state in predicate["values"]  # type: ignore[operator]
            else "FALSE"
        )
    raise AssertionError(f"validated predicate has unsupported op {op}")
