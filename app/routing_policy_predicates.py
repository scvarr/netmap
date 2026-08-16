import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from app.errors import ModelError, ValidationError
from app.packet_predicates import (
    PacketPredicateEvaluationContext,
    Predicate,
    TruthValue,
    evaluate_predicate,
    normalize_predicate,
)
from app.schemas import PacketState


_PACKET_LEAF_OPS = {
    "TRUE",
    "FALSE",
    "SOURCE_IP_IN",
    "DESTINATION_IP_IN",
    "IP_PROTOCOL_IN",
    "SOURCE_PORT_IN",
    "DESTINATION_PORT_IN",
    "ICMP_TYPE_IN",
    "ICMP_CODE_IN",
}
_CONTEXT_ENTITY_OPS = {
    "ROUTING_CONTEXT_IN": "RoutingContext",
    "INGRESS_NETWORK_INTERFACE_IN": "NetworkInterface",
    "INGRESS_L3_BINDING_IN": "L3Binding",
}
_CONTEXT_FIELDS = {
    "ROUTING_CONTEXT_IN": "routing_context_id",
    "INGRESS_NETWORK_INTERFACE_IN": "ingress_network_interface_id",
    "INGRESS_L3_BINDING_IN": "ingress_l3_binding_id",
}
_TRAFFIC_CLASSES = ("TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT")


@dataclass(frozen=True)
class RoutingPolicyPredicateEvaluationContext:
    packet_state: PacketState
    routing_context_id: uuid.UUID
    traffic_class: Literal["TRANSIT", "LOCAL_INPUT", "LOCAL_OUTPUT"] | None = None
    ingress_network_interface_id: uuid.UUID | None = None
    ingress_l3_binding_id: uuid.UUID | None = None


@dataclass(frozen=True)
class RoutingPolicyPredicateEvaluation:
    result: TruthValue
    canonical_refs: tuple[tuple[str, uuid.UUID], ...]


def normalize_routing_policy_predicate(
    predicate: object,
    *,
    model_error: bool,
    entity_exists: Callable[[str, uuid.UUID], bool],
    details: dict[str, str] | None = None,
) -> Predicate:
    error_type = ModelError if model_error else ValidationError
    context = details or {}

    def fail(message: str, path: str, **extra: object) -> None:
        raise error_type(message, {**context, "predicate_path": path, **extra})

    def normalize(value: object, path: str) -> Predicate:
        if not isinstance(value, dict) or not isinstance(value.get("op"), str):
            fail("RoutingPolicy predicate must be an object with a string op", path)
        op = value["op"]
        if op in _PACKET_LEAF_OPS:
            return normalize_predicate(
                value,
                model_error=model_error,
                details={**context, "routing_policy_predicate_path": path},
            )
        if op in {"ALL", "ANY"}:
            if set(value) != {"op", "children"} or not isinstance(
                value.get("children"), list
            ):
                fail(f"{op} predicate requires a children array", path)
            return {
                "op": op,
                "children": [
                    normalize(child, f"{path}.children[{index}]")
                    for index, child in enumerate(value["children"])
                ],
            }
        if op == "NOT":
            if set(value) != {"op", "child"}:
                fail("NOT predicate requires exactly one child", path)
            return {"op": op, "child": normalize(value["child"], f"{path}.child")}
        if op == "TRAFFIC_CLASS_IN":
            if set(value) != {"op", "values"} or not isinstance(
                value.get("values"), list
            ):
                fail("TRAFFIC_CLASS_IN predicate requires a values array", path)
            values = value["values"]
            if not values:
                fail("TRAFFIC_CLASS_IN values must be non-empty", f"{path}.values")
            if any(
                not isinstance(item, str) or item not in _TRAFFIC_CLASSES
                for item in values
            ):
                fail("TRAFFIC_CLASS_IN value is invalid", f"{path}.values")
            return {
                "op": op,
                "values": [item for item in _TRAFFIC_CLASSES if item in values],
            }
        if op in _CONTEXT_ENTITY_OPS:
            if set(value) != {"op", "ids"} or not isinstance(
                value.get("ids"), list
            ):
                fail(f"{op} predicate requires an ids array", path)
            ids = value["ids"]
            if not ids:
                fail(f"{op} ids must be non-empty", f"{path}.ids")
            normalized_ids: set[str] = set()
            for index, item in enumerate(ids):
                item_path = f"{path}.ids[{index}]"
                try:
                    parsed = uuid.UUID(str(item))
                except (ValueError, TypeError, AttributeError) as exc:
                    raise error_type(
                        f"{op} ID is invalid",
                        {**context, "predicate_path": item_path, "value": item},
                    ) from exc
                entity_type = _CONTEXT_ENTITY_OPS[op]
                if not entity_exists(entity_type, parsed):
                    fail(
                        f"{op} refers to a missing canonical entity",
                        item_path,
                        entity_type=entity_type,
                        entity_id=str(parsed),
                    )
                normalized_ids.add(str(parsed))
            return {"op": op, "ids": sorted(normalized_ids)}
        fail("Predicate op is not supported by RoutingPolicy M7.2", path, op=op)
        raise AssertionError("unreachable")

    normalized = normalize(predicate, "$")
    if model_error and predicate != normalized:
        raise ModelError(
            "RoutingPolicy predicate is not canonical",
            {**context, "canonical_predicate": normalized},
        )
    return normalized


def evaluate_routing_policy_predicate(
    predicate: Predicate,
    context: RoutingPolicyPredicateEvaluationContext,
) -> RoutingPolicyPredicateEvaluation:
    op = predicate["op"]
    if op in _PACKET_LEAF_OPS:
        return RoutingPolicyPredicateEvaluation(
            evaluate_predicate(
                predicate,
                PacketPredicateEvaluationContext(packet_state=context.packet_state),
            ),
            (),
        )
    if op == "NOT":
        evaluated = evaluate_routing_policy_predicate(
            predicate["child"], context  # type: ignore[arg-type]
        )
        return RoutingPolicyPredicateEvaluation(
            {"TRUE": "FALSE", "FALSE": "TRUE", "UNKNOWN": "UNKNOWN"}[
                evaluated.result
            ],  # type: ignore[arg-type]
            evaluated.canonical_refs,
        )
    if op in {"ALL", "ANY"}:
        evaluated_children = [
            evaluate_routing_policy_predicate(child, context)
            for child in predicate["children"]  # type: ignore[union-attr]
        ]
        results = [item.result for item in evaluated_children]
        if op == "ALL":
            result: TruthValue = (
                "FALSE"
                if "FALSE" in results
                else "UNKNOWN" if "UNKNOWN" in results else "TRUE"
            )
        else:
            result = (
                "TRUE"
                if "TRUE" in results
                else "UNKNOWN" if "UNKNOWN" in results else "FALSE"
            )
        return RoutingPolicyPredicateEvaluation(
            result,
            tuple(
                _dedupe_refs(
                    [
                        ref
                        for evaluated in evaluated_children
                        for ref in evaluated.canonical_refs
                    ]
                )
            ),
        )
    if op == "TRAFFIC_CLASS_IN":
        if context.traffic_class is None:
            return RoutingPolicyPredicateEvaluation("UNKNOWN", ())
        return RoutingPolicyPredicateEvaluation(
            "TRUE" if context.traffic_class in predicate["values"] else "FALSE",  # type: ignore[operator]
            (),
        )
    if op in _CONTEXT_ENTITY_OPS:
        runtime_value = getattr(context, _CONTEXT_FIELDS[op])
        if runtime_value is None:
            return RoutingPolicyPredicateEvaluation("UNKNOWN", ())
        return RoutingPolicyPredicateEvaluation(
            "TRUE" if str(runtime_value) in predicate["ids"] else "FALSE",  # type: ignore[operator]
            ((_CONTEXT_ENTITY_OPS[op], runtime_value),),
        )
    raise AssertionError(f"validated RoutingPolicy predicate has unsupported op {op}")


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
