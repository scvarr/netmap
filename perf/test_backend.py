"""Run explicitly: pytest -m perf perf/test_backend.py --perf-mode quick.

The compose PERF stack supplies DATABASE_URL/NETMAP_PERF_DATABASE and must be
seeded first. It intentionally lives outside tests/ so normal pytest ignores it.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import httpx
import pytest
from app.database import SessionLocal, engine
from app.schemas import TopologyProjectionRequest
from app.repository import CanonicalRepository
from app.schemas import EvaluationView
from app.topology_projection_resolver import ConfiguredTopologyProjectionResolver
from perf.metrics import Measurement, measure, summarize
from app.perf_instrumentation import PERF_REQUEST_HEADER, PERF_RESPONSE_HEADER
from perf.safety import require_confirmed_perf_database


@pytest.fixture(scope="module")
def perf_context(request: pytest.FixtureRequest):
    require_confirmed_perf_database()
    mode = request.config.getoption("--perf-mode"); profile = request.config.getoption("--perf-profile"); seed = request.config.getoption("--perf-seed")
    from perf.generate import generate
    counts = generate(profile, seed)
    with SessionLocal() as session:
        from app.models import SavedMap
        map_id = session.query(SavedMap.id).order_by(SavedMap.id).first()[0]
    anchors = counts["anchors"]
    return {"mode": mode, "profile": profile, "seed": seed, "counts": counts, "object_ids": anchors["projection_object_ids"], "point_id": anchors["specific_source_connection_point_id"], "map_id": str(map_id), "trace_source": anchors["trace_source_physical_object_id"], "trace_target": anchors["trace_target_physical_object_id"]}


def _runs(mode: str) -> int: return 7 if mode == "quick" else 40


def _projection(layer: str, ids: list[str] | None = None, interstitial: bool = False) -> dict:
    return {"layer": layer, "detail_level": "PHYSICAL_OBJECT" if layer == "L1" else "DEVICE", "scope": {"include_location_subtrees": [], "include_entities": [{"ref_type": "CANONICAL_FACT", "entity_type": "PhysicalObject", "entity_id": item} for item in (ids or [])]}, "include_interstitial_cables": interstitial}


@pytest.mark.perf
def test_backend_baseline(perf_context, request):
    base_url = os.environ.get("PERF_BASE_URL", "http://127.0.0.1:8000")
    cases = {
        "projection_l1_scoped_interstitial": ("POST", "/v1/topology/projection", _projection("L1", perf_context["object_ids"], True)),
        "projection_l2_unscoped": ("POST", "/v1/topology/projection", _projection("L2")),
        "saved_map": ("GET", f"/v1/maps/{perf_context['map_id']}", None),
        "catalog_inventory": ("GET", "/v1/catalog/inventory", None),
        "physical_object": ("GET", f"/v1/topology/physical-objects/{perf_context['object_ids'][0]}", None),
        "trace_specific_port": ("POST", "/v1/traces/physical-objects/l1", {"from_physical_object_id": perf_context["trace_source"], "to_physical_object_id": perf_context["trace_target"], "from_connection_point_id": perf_context["point_id"]}),
        "trace_any_port": ("POST", "/v1/traces/physical-objects/l1", {"from_physical_object_id": perf_context["trace_source"], "to_physical_object_id": perf_context["trace_target"]}),
    }
    results = []
    with httpx.Client(base_url=base_url, timeout=120) as client:
        for name, (method, url, body) in cases.items():
            # warmup is intentionally outside all measurement counters.
            response = client.request(method, url, json=body); assert response.status_code == 200, response.text
            measurements = []
            for _ in range(_runs(perf_context["mode"])):
                from time import perf_counter
                started = perf_counter(); item = client.request(method, url, json=body, headers={PERF_REQUEST_HEADER: "1"})
                assert item.status_code == 200, item.text
                measurements.append(Measurement((perf_counter() - started) * 1000, int(item.headers[PERF_RESPONSE_HEADER]), len(item.content)))
            summary = summarize(measurements, perf_context["mode"])
            results.append({"metric": name, "http_e2e_ms": summary["median_ms"], "sql_query_count": summary["query_count_median"], "response_bytes": summary["response_bytes_median"], "runs": summary["runs"], "p50_ms": summary["p50_ms"], "p95_ms": summary["p95_ms"]})
        # Resolver-only has its own direct boundary; HTTP e2e remains separately measured above.
        query = TopologyProjectionRequest.model_validate(_projection("L1", perf_context["object_ids"], True))
        resolver_runs = []
        for _ in range(_runs(perf_context["mode"])):
            with SessionLocal() as session:
                resolver_runs.append(measure(engine, lambda: ConfiguredTopologyProjectionResolver(CanonicalRepository(session)).resolve(query, EvaluationView()), lambda item: len(json.dumps(item.model_dump(mode="json")).encode())))
        resolver = summarize(resolver_runs, perf_context["mode"]); http_projection = next(item for item in results if item["metric"] == "projection_l1_scoped_interstitial")
        results.append({"metric": "projection_l1_resolver_only", "resolver_ms": resolver["median_ms"], "sql_query_count": resolver["query_count_median"], "response_bytes": resolver["response_bytes_median"], "runs": resolver["runs"], "non_resolver_overhead_ms": http_projection["http_e2e_ms"] - resolver["median_ms"]})
    sha = os.environ.get("PERF_COMMIT_SHA", "unknown-container-build")
    output = {"commit_sha": sha, "profile": perf_context["profile"], "seed": perf_context["seed"], "mode": perf_context["mode"], "dataset_counts": perf_context["counts"], "environment": {"python": os.sys.version, "base_url": base_url}, "metrics": results}
    destination = Path(request.config.getoption("--perf-results")); destination.parent.mkdir(parents=True, exist_ok=True); destination.write_text(json.dumps(output, indent=2), encoding="utf-8")
