from __future__ import annotations

import statistics
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

from sqlalchemy import event
from sqlalchemy.engine import Engine

T = TypeVar("T")


def percentile(values: list[float], fraction: float) -> float:
    """Linear percentile; intended for full mode only (not five-run p95)."""
    if not values:
        raise ValueError("percentile requires at least one value")
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower, upper = int(position), min(int(position) + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


@dataclass(frozen=True)
class Measurement:
    latency_ms: float
    query_count: int
    response_bytes: int | None = None


class SqlQueryCounter:
    def __init__(self, engine: Engine):
        self.engine, self.count = engine, 0

    def _listener(self, *_args: object, **_kwargs: object) -> None:
        self.count += 1

    def __enter__(self) -> "SqlQueryCounter":
        event.listen(self.engine, "before_cursor_execute", self._listener)
        return self

    def __exit__(self, *_args: object) -> None:
        event.remove(self.engine, "before_cursor_execute", self._listener)


def measure(engine: Engine, operation: Callable[[], T], response_bytes: Callable[[T], int] | None = None) -> Measurement:
    """Count only SQL executed during operation; listener always detaches."""
    with SqlQueryCounter(engine) as counter:
        started = time.perf_counter()
        result = operation()
        elapsed = (time.perf_counter() - started) * 1000
    return Measurement(elapsed, counter.count, response_bytes(result) if response_bytes else None)


def summarize(values: list[Measurement], mode: str) -> dict[str, float | int | None]:
    latencies = [item.latency_ms for item in values]
    payload = {"runs": len(values), "median_ms": statistics.median(latencies), "p50_ms": None, "p95_ms": None,
               "query_count_median": statistics.median(item.query_count for item in values),
               "response_bytes_median": statistics.median(item.response_bytes for item in values if item.response_bytes is not None) if any(item.response_bytes is not None for item in values) else None}
    if mode == "full":
        payload.update({"p50_ms": percentile(latencies, 0.5), "p95_ms": percentile(latencies, 0.95)})
    return payload
