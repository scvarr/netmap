"""Hard safety boundary for destructive performance dataset operations."""

import os

from sqlalchemy.engine import make_url

PERF_DATABASE_NAME = "netmap_perf"
PERF_DATABASE_MARKER = "NETMAP_PERF_DATABASE"


class PerfDatabaseSafetyError(RuntimeError):
    pass


def require_confirmed_perf_database(database_url: str | None = None, marker: str | None = None) -> None:
    """Allow destructive PERF work only against the dedicated marked database."""
    if (marker if marker is not None else os.environ.get(PERF_DATABASE_MARKER)) != "1":
        raise PerfDatabaseSafetyError(f"Refusing PERF reset: set {PERF_DATABASE_MARKER}=1.")
    value = database_url if database_url is not None else os.environ.get("DATABASE_URL")
    if not value:
        raise PerfDatabaseSafetyError("Refusing PERF reset: DATABASE_URL is not configured.")
    try:
        database_name = make_url(value).database
    except Exception as error:
        raise PerfDatabaseSafetyError("Refusing PERF reset: DATABASE_URL is invalid.") from error
    if database_name != PERF_DATABASE_NAME:
        raise PerfDatabaseSafetyError(
            f"Refusing PERF reset: DATABASE_URL must target {PERF_DATABASE_NAME!r}, not {database_name!r}."
        )
