import pytest
import json
from sqlalchemy import create_engine, text

from perf.metrics import Measurement, measure, percentile, summarize
from perf.safety import PerfDatabaseSafetyError, require_confirmed_perf_database
from perf.results import merge_shards


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


def test_merge_shards_merges_matching_shards_and_rejects_duplicates(tmp_path):
    base = {"commit_sha": "x", "profile": "small", "seed": 1, "mode": "quick", "dataset_counts": {}, "environment": {}, "metrics": [{"metric": "one"}]}
    first, second = tmp_path / "a.json", tmp_path / "b.json"
    first.write_text(json.dumps(base))
    second.write_text(json.dumps({**base, "metrics": [{"metric": "two"}]}))
    merged = merge_shards([first, second])
    assert [metric["metric"] for metric in merged["metrics"]] == ["one", "two"]
    second.write_text(json.dumps(base))
    with pytest.raises(ValueError, match="duplicate"):
        merge_shards([first, second])
