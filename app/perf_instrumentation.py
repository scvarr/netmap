"""PERF-001 request-local SQL counting; completely opt-in by environment."""
from __future__ import annotations

import os
from contextvars import ContextVar
from dataclasses import dataclass

from sqlalchemy import event
from sqlalchemy.engine import Engine

PERF_ENV = "NETMAP_PERF_INSTRUMENTATION"
PERF_REQUEST_HEADER = "X-NetMap-Perf-Measure"
PERF_RESPONSE_HEADER = "X-NetMap-Perf-SQL-Queries"


@dataclass
class QueryCounter:
    count: int = 0


_counter: ContextVar[QueryCounter | None] = ContextVar("netmap_perf_query_counter", default=None)
_installed_engines: set[int] = set()


def enabled() -> bool:
    return os.environ.get(PERF_ENV) == "1"


def _before_cursor_execute(*_args: object, **_kwargs: object) -> None:
    # A mutable object survives Starlette's copied sync-worker context.
    counter = _counter.get()
    if counter is not None:
        counter.count += 1


def install_listener(engine: Engine) -> None:
    """Idempotently attach only in an explicitly instrumented backend process."""
    if not enabled() or id(engine) in _installed_engines:
        return
    event.listen(engine, "before_cursor_execute", _before_cursor_execute)
    _installed_engines.add(id(engine))


async def instrument_request(request, call_next):
    if not enabled() or request.headers.get(PERF_REQUEST_HEADER) != "1":
        return await call_next(request)
    counter = QueryCounter()
    token = _counter.set(counter)
    try:
        response = await call_next(request)
        response.headers[PERF_RESPONSE_HEADER] = str(counter.count)
        return response
    finally:
        _counter.reset(token)
