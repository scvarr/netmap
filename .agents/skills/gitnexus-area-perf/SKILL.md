---
name: gitnexus-area-perf
description: "Skill for the Perf area of netmap. 23 symbols across 7 files."
---

# Perf

23 symbols | 7 files | Cohesion: 86%

## When to Use

- Working with code in `perf/`
- Understanding how create_blueprint, generate, main work
- Modifying perf-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `perf/generate.py` | create_blueprint, generate, main, port_plan, stable_id (+1) |
| `perf/test_backend.py` | _projection, _runs, test_backend_baseline, perf_context |
| `perf/test_tooling.py` | test_measurement_listener_detaches_between_runs, test_percentiles_and_quick_summary, test_perf_reset_rejects_wrong_database_and_missing_marker, test_merge_shards_merges_matching_shards_and_rejects_duplicates |
| `perf/test_generator.py` | test_profile_port_plans_are_exact_and_deterministic, test_seeded_ids_are_stable, test_small_materialization_matches_network_port_runtime_shape |
| `perf/metrics.py` | measure, percentile, summarize |
| `perf/results.py` | main, merge_shards |
| `perf/safety.py` | require_confirmed_perf_database |

## Entry Points

Start here when exploring this area:

- **`create_blueprint`** (Function) — `perf/generate.py:46`
- **`generate`** (Function) — `perf/generate.py:61`
- **`main`** (Function) — `perf/generate.py:155`
- **`port_plan`** (Function) — `perf/generate.py:32`
- **`stable_id`** (Function) — `perf/generate.py:29`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `create_blueprint` | Function | `perf/generate.py` | 46 |
| `generate` | Function | `perf/generate.py` | 61 |
| `main` | Function | `perf/generate.py` | 155 |
| `port_plan` | Function | `perf/generate.py` | 32 |
| `stable_id` | Function | `perf/generate.py` | 29 |
| `test_profile_port_plans_are_exact_and_deterministic` | Function | `perf/test_generator.py` | 3 |
| `test_seeded_ids_are_stable` | Function | `perf/test_generator.py` | 9 |
| `test_small_materialization_matches_network_port_runtime_shape` | Function | `perf/test_generator.py` | 14 |
| `measure` | Function | `perf/metrics.py` | 46 |
| `percentile` | Function | `perf/metrics.py` | 14 |
| `summarize` | Function | `perf/metrics.py` | 55 |
| `test_backend_baseline` | Function | `perf/test_backend.py` | 44 |
| `test_measurement_listener_detaches_between_runs` | Function | `perf/test_tooling.py` | 16 |
| `test_percentiles_and_quick_summary` | Function | `perf/test_tooling.py` | 22 |
| `reset` | Function | `perf/generate.py` | 41 |
| `require_confirmed_perf_database` | Function | `perf/safety.py` | 14 |
| `perf_context` | Function | `perf/test_backend.py` | 24 |
| `test_perf_reset_rejects_wrong_database_and_missing_marker` | Function | `perf/test_tooling.py` | 9 |
| `main` | Function | `perf/results.py` | 23 |
| `merge_shards` | Function | `perf/results.py` | 8 |

## How to Explore

1. `context({name: "create_blueprint"})` — see callers and callees
2. `query({search_query: "perf"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
