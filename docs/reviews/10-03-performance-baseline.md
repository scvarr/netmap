# 10.3 Performance baseline и бюджеты

Целевые уровни (вывод performance-аудита):

- **NORMAL target**: примерно до ~500 объектов / ~4–5 тыс. отображаемых
  портов — штатный рабочий диапазон продукта;
- **PORT_HEAVY** (~500 объектов / ~20 тыс. портов) — отдельный тяжёлый профиль
  benchmark'а, а НЕ штатный product target; повышение его до штатного требует
  отдельного architecture/product решения;
- **LARGE/STRESS** (~1000 объектов / ~40 тыс. портов) — стресс-профиль.

Значения бюджетов ниже — **стартовые гипотезы**: до прогона PERF-001 они не
измерены и не являются обязательствами.

## Профили данных

Все профили детерминированы (seeded generator, PERF-001). Состав:
blueprint-инстансы (switch 24/48 NETWORK_PORT, patch-panel 24 CONNECTION_POINT
с внутренними парами), детерминированные связи кольцо+звёзды, SavedMap с
авторитарными позициями.

| Профиль | Объекты | Порты (CP) | Connections | Edges (L1) | Карты |
|---|---|---|---|---|---|
| SMALL | ~100 | ~800 | ~150 | ~150 | 2 |
| MEDIUM | ~500 | ~4 000 | ~700 | ~700–900 | 3 |
| PORT_HEAVY | ~500 | ~20 000 | ~1 500 | ~1 000 | 2 |
| LARGE/STRESS | ~1 000 | ~40 000 | ~3 000 | ~2 500 | 4 |

Восстановление: генерация в изолированную `netmap_perf` БД + опциональный
`pg_dump`-снапшот для повторяемости; guard-паттерн как в `tests/conftest.py`.

## Метрики

Протокол измерений (устраняет смешивание median/p95):

- quick/local прогон: warmup + **5–10 runs, median** — для smoke и до/после
  сравнений одного изменения;
- full benchmark: достаточное число прогонов (ориентир **30–50+**) для
  устойчивых **p50/p95**; p95-цели из раздела «Бюджеты» фиксируются только в
  full-режиме.

Backend (pytest-марка `perf`, отдельно от unit-CI):

- latency `POST /v1/topology/projection` (L1 scoped+interstitial; L2 unscoped) —
  e2e через uvicorn/httpx по протоколу выше;
- resolver-only время (прямой вызов резолвера, без HTTP/Pydantic);
- SQL query count (event-listener `before_cursor_execute`);
- non-resolver overhead = e2e − resolver; называть это «serialization time»
  нельзя, пока serialization не измерена отдельно;
- размер JSON ответа;
- память процесса: tracemalloc-пик вокруг resolve + RSS (оценочно);
- отдельно: `GET /v1/maps/{id}`, `GET /v1/catalog/inventory`,
  `GET /v1/topology/physical-objects/{id}` (один объект!),
  `POST /v1/traces/physical-objects/l1` (с портом и «любой порт»).

Frontend (Playwright + Chromium против compose-стека; jsdom непригоден для
render-perf):

- time-to-map: получение document → интерактивная карта (sentinel/`perf.mark`);
- layout-time отдельно (обёртка вокруг layout engine);
- render/commit: PerformanceObserver longtask; event→rAF на интеракциях;
- DOM elements: `document.getElementsByTagName('*').length`;
- интеракции скриптом: selection, pan×20, zoom-серия, drag-stop, включение
  trace, вход/выход wiring, редактирование маршрута кабеля;
- вариации: MiniMap вкл/выкл; LOD-скрытие портов вкл/выкл; 100/500/1000 нод.

## Бюджеты (стартовые гипотезы — калибруются PERF-001)

p95-значения контролируются в full-benchmark режиме; в quick/local прогоне
контролируется median тех же метрик.

| Метрика | SMALL | MEDIUM | PORT_HEAVY |
|---|---|---|---|
| Projection API p95 | ≤300 мс | ≤1.5 с | ≤4 с до PERF-008/009; цель ≤1.5 с |
| Детали одного объекта p95 | ≤100 мс | ≤200 мс | ≤300 мс (требует PERF-002) |
| JSON проекции | ≤1 МБ | ≤4 МБ | ≤10 МБ (после PERF-009) |
| Time-to-map | ≤1.5 с | ≤3 с | ≤8 с до PERF-006/007; цель ≤5 с |
| Selection p95 | ≤50 мс | ≤100 мс | ≤150 мс |
| Pan/zoom | — | ≥45 FPS | ≥30 FPS |

## Требуют эмпирического определения (сознательно без цифр)

- Доля ELK-layout в time-to-map на каждом профиле (решение по PERF-007).
- Фактический сплит resolver / Pydantic / JSON-parse на PORT_HEAVY
  (приоритет PERF-008 vs PERF-009).
- Порог зума и порог нод для LOD портов; влияние MiniMap на FPS.
- Сравнение стратегий anti-DOM (`onlyRenderVisibleElements` vs zoom-LOD vs
  MiniMap-cap).
- Query-count базлайны всех перечисленных endpoint'ов на всех профилях.
- Реальная латентность any-port trace на MEDIUM/LARGE (подтверждение HIGH-
  severity PERF-003).

## CI

- Per-PR: только дешёвые ассерты — SQL query-count на фиксированном fixture и
  SMALL DOM-count sanity.
- Nightly: MEDIUM latency-smoke с щедрым порогом (×3 локальной медианы).
- PORT_HEAVY/LARGE: вручную или ночью; в per-PR CI не включать.

## FINAL PERF-001 baseline

### Measured fact

Product/base main SHA: `a98353273c99d9c1e994e03905bf3adb62b231a9`.
Final benchmark tooling SHA: `f92b1f2df72c8e2e576820098b6cc75d457be847`.
The recorded environment was Docker Compose on this local host: Python 3.13.7
and PostgreSQL 17.6. Seed: `20260826`.

Backend quick protocol was **one unmeasured warmup plus seven measured runs per
case, reporting median only**. Each logical case creates its own deterministic
`netmap_perf` dataset; generator time is outside endpoint latency. The L1 shard
contains both the HTTP projection and the direct resolver-only measurement.
No quick result below is p50 or p95.

| Profile | Objects | CP | NI | Connections | Maps | Memberships | Generation duration |
|---|---:|---:|---:|---:|---:|---:|---:|
| SMALL | 100 | 800 | 680 | 150 | 2 | 100 | 0.285 s |
| MEDIUM | 500 | 4,000 | 3,880 | 700 | 3 | 500 | 1.333 s |
| PORT_HEAVY | 500 | 20,000 | 19,880 | 1,500 | 2 | 500 | 6.245 s |
| LARGE/STRESS | 1,000 | 40,000 | 39,880 | 3,000 | 4 | 1,000 | 13.916 s |

All four profiles completed generation and structural validation. This includes
exact profile counts, runtime-shaped NETWORK_PORT rows (NI + owner + physical
binding), cross-object external links, at most one external attachment per CP
member, and non-patch NETWORK_PORT trace anchors with a real cross-object path.

HTTP SQL counts are request-local measurements: `perf-backend` enables the
ContextVar counter only under `NETMAP_PERF_INSTRUMENTATION=1`, and only requests
with `X-NetMap-Perf-Measure: 1` receive `X-NetMap-Perf-SQL-Queries`.

| Backend metric | SMALL: HTTP median ms / SQL / bytes | MEDIUM: HTTP median ms / SQL / bytes |
|---|---:|---:|
| L1 scoped + interstitial projection | 584.3 / 2,172 / 37,698 | 3,147.5 / 11,772 / 38,437 |
| L1 resolver only | 588.1 ms / 2,172 / 39,876 | 3,193.7 ms / 11,772 / 40,651 |
| L1 non-resolver overhead | -3.9 ms | -46.2 ms |
| L2 unscoped projection | 1,682.4 / 3,852 / 366,780 | 10,108.9 / 22,627 / 2,206,905 |
| saved map | 5.1 / 4 / 13,100 | 8.4 / 4 / 43,369 |
| catalog inventory | 236.8 / 809 / 37,139 | 1,303.3 / 4,009 / 185,799 |
| physical object detail | 571.4 / 2,174 / 34,405 | 3,108.1 / 11,774 / 36,363 |
| L1 trace, specific port | 13.7 / 15 / 2,891 | 22.5 / 23 / 3,255 |
| L1 trace, any port | 13.7 / 15 / 2,857 | 108.1 / 108 / 5,439 |

`non-resolver overhead` is HTTP median minus resolver median from independent
distributions. The negative values are measurement noise, not negative real
time and not serialization time.

PORT_HEAVY and LARGE completed generator validation but did not receive endpoint
latency runs in this local pass; they remain manual/stress benchmark profiles.

Chromium was available against `http://127.0.0.1:5174`; these are real-browser
single-smoke measurements, not jsdom substitutes:

| Frontend metric | SMALL | MEDIUM |
|---|---:|---:|
| layout duration | 96.1 ms | 133.5 ms |
| document to interactive map | 116.9 ms | 173.8 ms |
| DOM elements | 1,040 | 3,478 |
| selection to next animation frame | 61.5 ms | 66.2 ms |
| pan sequence | 360.0 ms | 376.3 ms |
| zoom sequence | 49.2 ms | 42.9 ms |
| drag-stop to next animation frame | 12.6 ms | 13.7 ms |

### Interpretation

The current generator makes the L2 unscoped endpoint materially non-empty, so
its results are a control for the present runtime shape; they are not a promise
that future configured-L2 scaling is represented exhaustively. The largest
observed backend costs in this baseline are unscoped L2 projection and the
high SQL counts for projection/object-detail/inventory. MEDIUM any-port tracing
also has a higher query count than specific-port tracing. These are findings for
later PERF work only: **no production query, API, React, DOM, LOD, ELK, or lazy
loading optimization was made by PERF-001**.

### Budget hypothesis

The budgets above remain hypotheses, not an acceptance contract or a regression
verdict from one local machine. A full run (40 measured samples in this tooling)
is required before reporting p50/p95.

### Reproduction

Start the isolated stack with
`docker compose -f compose.perf.yaml up -d --build`. Run one shard, for example:

`docker compose -f compose.perf.yaml exec -T -e PERF_COMMIT_SHA=$(git rev-parse HEAD) perf-backend pytest -m perf perf/test_backend.py --perf-mode quick --perf-profile medium --perf-seed 20260826 --perf-case projection_l1 --perf-results /tmp/perf-results/medium-projection-l1.json`

Run the seven logical cases separately (`projection_l1`, `projection_l2`,
`saved_map`, `catalog_inventory`, `physical_object`, `trace_specific_port`,
`trace_any_port`) and merge them with `python -m perf.results <shards...>
--output <profile-result.json>`. The merge rejects inconsistent profile/seed/
mode/count metadata and duplicate metric names.
