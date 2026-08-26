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
