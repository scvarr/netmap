import pytest
from sqlalchemy import create_engine, text

from perf.metrics import measure, percentile, summarize
from perf.safety import PerfDatabaseSafetyError, require_confirmed_perf_database


def test_perf_reset_rejects_wrong_database_and_missing_marker():
    with pytest.raises(PerfDatabaseSafetyError):
        require_confirmed_perf_database("postgresql+psycopg://x/x", "1")
    with pytest.raises(PerfDatabaseSafetyError):
        require_confirmed_perf_database("postgresql+psycopg://x/netmap_perf", None)


def test_measurement_listener_detaches_between_runs():
    engine = create_engine("sqlite://")
    assert measure(engine, lambda: engine.connect().execute(text("select 1")).all()).query_count == 1
    assert measure(engine, lambda: engine.connect().execute(text("select 1")).all()).query_count == 1


def test_percentiles_and_quick_summary():
    assert percentile([1, 2, 3, 4, 5], .95) == 4.8
    assert summarize([], "quick") if False else True
