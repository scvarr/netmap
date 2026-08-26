import pytest
from sqlalchemy import create_engine, text

from perf.metrics import Measurement, measure, percentile, summarize
from perf.safety import PerfDatabaseSafetyError, require_confirmed_perf_database


def test_perf_reset_rejects_wrong_database_and_missing_marker():
    with pytest.raises(PerfDatabaseSafetyError):
        require_confirmed_perf_database("postgresql+psycopg://x/x", "1")
    with pytest.raises(PerfDatabaseSafetyError):
        require_confirmed_perf_database("postgresql+psycopg://x/netmap_perf", "")


def test_measurement_listener_detaches_between_runs():
    engine = create_engine("sqlite://")
    assert measure(engine, lambda: engine.connect().execute(text("select 1")).all()).query_count == 1
    assert measure(engine, lambda: engine.connect().execute(text("select 1")).all()).query_count == 1


def test_percentiles_and_quick_summary():
    measurements = [Measurement(1, 2, 10), Measurement(3, 4, 30), Measurement(5, 6, 50)]
    quick = summarize(measurements, "quick")
    assert quick["median_ms"] == 3
    assert quick["p50_ms"] is None and quick["p95_ms"] is None
    assert quick["query_count_median"] == 4 and quick["response_bytes_median"] == 30
    full = summarize(measurements, "full")
    assert full["p50_ms"] == 3 and full["p95_ms"] == 4.8
