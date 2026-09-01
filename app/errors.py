from typing import Any

from sqlalchemy.exc import IntegrityError


EXPECTED_UNIQUENESS_CONSTRAINTS = {
    "uq_saved_maps_name": "SAVED_MAP_NAME_CONFLICT",
    "uq_map_placements_map_object": "MAP_PLACEMENT_CONFLICT",
    "uq_map_cable_routes_map_cable_view": "MAP_CABLE_ROUTE_CONFLICT",
}


def integrity_constraint_name(error: IntegrityError) -> str | None:
    """Return PostgreSQL's structured constraint name, without parsing its text."""
    diagnostic = getattr(error.orig, "diag", None)
    constraint_name = getattr(diagnostic, "constraint_name", None)
    return constraint_name if isinstance(constraint_name, str) else None


def classify_integrity_error(error: IntegrityError) -> "UniquenessConflictError | None":
    constraint_name = integrity_constraint_name(error)
    reason = EXPECTED_UNIQUENESS_CONSTRAINTS.get(constraint_name)
    if reason is None:
        return None
    return UniquenessConflictError(reason=reason, constraint=constraint_name)


class NetMapError(Exception):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class ValidationError(NetMapError):
    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__("VALIDATION_ERROR", message, details)


class ModelError(NetMapError):
    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__("MODEL_ERROR", message, details)


class UniquenessConflictError(NetMapError):
    def __init__(self, *, reason: str, constraint: str) -> None:
        super().__init__(
            "UNIQUENESS_CONFLICT",
            "Concurrent write conflicts with an existing resource",
            {"reason": reason, "constraint": constraint},
        )


class HistoricalCableLabelReuseRequiredError(NetMapError):
    def __init__(self, candidate: str) -> None:
        super().__init__(
            "HISTORICAL_CABLE_LABEL_REUSE_REQUIRED",
            "Cable label was used previously and requires explicit confirmation",
            {"candidate": candidate},
        )


class HistoricalCableLabelReuseConfirmationStaleError(NetMapError):
    def __init__(self) -> None:
        super().__init__(
            "HISTORICAL_CABLE_LABEL_REUSE_CONFIRMATION_STALE",
            "Cable label reuse confirmation is no longer current",
        )
