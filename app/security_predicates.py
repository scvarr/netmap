"""Backward-compatible imports for the shared packet predicate core."""

from app.packet_predicates import (
    PacketPredicateEvaluationContext,
    Predicate,
    TruthValue,
    evaluate_predicate,
    normalize_predicate,
)

SecurityPredicateEvaluationContext = PacketPredicateEvaluationContext

__all__ = [
    "PacketPredicateEvaluationContext",
    "Predicate",
    "SecurityPredicateEvaluationContext",
    "TruthValue",
    "evaluate_predicate",
    "normalize_predicate",
]
