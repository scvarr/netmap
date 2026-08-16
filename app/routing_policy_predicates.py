from app.errors import ModelError, ValidationError
from app.packet_predicates import Predicate, normalize_predicate


_ALLOWED_OPS = {
    "TRUE",
    "FALSE",
    "ALL",
    "ANY",
    "NOT",
    "SOURCE_IP_IN",
    "DESTINATION_IP_IN",
    "IP_PROTOCOL_IN",
    "SOURCE_PORT_IN",
    "DESTINATION_PORT_IN",
    "ICMP_TYPE_IN",
    "ICMP_CODE_IN",
}


def normalize_routing_policy_predicate(
    predicate: object,
    *,
    model_error: bool,
    details: dict[str, str] | None = None,
) -> Predicate:
    normalized = normalize_predicate(
        predicate,
        model_error=model_error,
        details=details,
    )
    error_type = ModelError if model_error else ValidationError

    def validate(value: Predicate, path: str) -> None:
        op = value["op"]
        if op not in _ALLOWED_OPS:
            raise error_type(
                "Packet predicate op is not supported by RoutingPolicy M7.1",
                {**(details or {}), "predicate_path": path, "op": op},
            )
        if op in {"ALL", "ANY"}:
            for index, child in enumerate(value["children"]):  # type: ignore[union-attr]
                validate(child, f"{path}.children[{index}]")
        elif op == "NOT":
            validate(value["child"], f"{path}.child")  # type: ignore[arg-type]

    validate(normalized, "$")
    return normalized
