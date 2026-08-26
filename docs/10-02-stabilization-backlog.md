# 10.2 Stabilization backlog

Единый канонический список работ по итогам аудитов (источники и детали —
[[10-01-audit-findings|10.1]]). Все пункты в статусе `TODO` на момент фиксации.

Поля пункта: категория · severity · до L2 · behavior-preserving · benchmark ·
зависимости · acceptance criteria · статус.

## НЕ НАРУШАТЬ ПРИ РЕФАКТОРИНГЕ

Архитектурные инварианты проекта (все зафиксированы в docs, не в находках).
Любой пункт backlog обязан сохранять их; конфликт → остановиться и пересмотреть
подход с архитектором.

1. Canonical topology (`PhysicalObject`, `ConnectionPoint`, `Connection`,
   `ConnectionMember`, `Cable`) — единственный source of truth о фактической
   сети (docs/05, docs/09-03).
2. SavedMap: placement/positions/locks/cable-routes — presentation-only;
   resolvers и traces не читают presentation state (docs/05 MAPS).
3. Blueprint recipe / Port Block library — authoring/provenance, не runtime
   topology; internal links материализуются обычными canonical фактами и после
   этого runtime authoritative (docs/09-01 L1S.5–6, docs/09-03).
4. Identity из stable keys и canonical refs: slot_key =
   `stable_group_key:ordinal`, port-block local_id отделён от labels; identity
   никогда не выводится из имён, видимых номеров, координат, порядка (docs/09-03).
5. Версии ObjectBlueprint/PortBlock неизменяемы; изменения — новая версия
   (docs/09-01, docs/09-03).
6. Blueprint upgrade — additive-only: lock instance, повторный analysis,
   blockers отменяют всё; provenance не реконсилирует runtime topology
   (docs/09-01 L1S.6b).
7. Exactly-once canonical writes; после успешного write — refresh-only retry,
   canonical write не повторяется (docs/05 Visual wiring, L1S.4c).
8. `UNKNOWN ≠ UNREACHABLE/BLOCKED`; MODEL_ERROR отделён от сетевых вердиктов;
   повреждённое stored state проявляется как MODEL_ERROR, а не тихий неверный
   результат (docs/00, docs/05).
9. Строгие схемы обеих сторон: backend `extra="forbid"`/`FiniteFloat`;
   frontend — strict runtime-парсеры ответов (docs/08 data-source boundary).
10. Lock discipline canonical агрегатов перед write-проверками (реализация
    W.6/deletion) — поддерживает инвариант 7.
11. RU — язык продукта по умолчанию; локализация не меняет canonical values и
    API payloads (docs/05).
12. Docker-only runtime, миграции до старта, pinned зависимости (docs/00).

Что сознательно НЕ является инвариантом: текущие HTTP-статусы ошибок чтения,
текущее распределение endpoints по файлам, конкретные N+1-паттерны, наличие
ELK-layout в saved-map пути, объём полей в projection DTO. Это реализация,
которую разрешено менять через пункты backlog.

## Concurrency

### CONC-001 — Блокировка ConnectionPoint при blueprint upgrade
- Категория: concurrency · Severity: HIGH · До L2: ДА
- Behavior-preserving: да (только блокировки) · Benchmark: нет
- Зависимости: нет
- Acceptance: двухсессионный тест «apply-upgrade c новым internal link ↔
  параллельный wiring тех же точек» — ровно одна транзакция успешна, вторая
  получает явный конфликт; в БД ≤1 Connection на пару; все существующие e2e
  зелёные.
- Статус: DONE — 2026-08-26, ef5018080bc5ff38bc630f83fd2919dc9f27694e

### CONC-002 — Гонка delete_blueprint ↔ instantiate
- Категория: concurrency · Severity: LOW · До L2: нет
- Behavior-preserving: да · Benchmark: нет
- Зависимости: частично закрывается API-001 (симптом)
- Acceptance: параллельные delete/instantiate дают чистую 409/422, не 500.
- Статус: TODO

## Correctness

### CORR-001 — Итеративный пассивный L1-обход
- Категория: correctness · Severity: LOW · До L2: нет
- Behavior-preserving: да · Benchmark: нет · Зависимости: нет
- Acceptance: глубокая легальная пассивная цепочка не вызывает
  RecursionError/500 и даёт корректный результат проекции. Предпочтительное
  решение — iterative traversal без изменения семантики. Вводить ограничение
  глубины с gap-кодом молча запрещено: это отдельное architecture/product
  решение (в случае необходимости — новый пункт backlog).
- Статус: TODO

### CORR-002 — DB-уникальность unordered-пары internal links
- Категория: correctness · Severity: LOW · До L2: нет
- Behavior-preserving: да · Benchmark: нет · Зависимости: новая миграция
- Acceptance: вставка обратной пары (v,B,A) нарушает constraint; существующие
  тесты authoring зелёные.
- Статус: TODO

## API contract

### API-001 — Глобальный IntegrityError → контрактная ошибка
- Категория: API contract · Severity: MEDIUM · До L2: ДА
- Behavior-preserving: да (маппинг ошибок) · Benchmark: нет
- Зависимости: снижает остроту CONC-002
- Acceptance: только ожидаемые constraint/uniqueness races (известные
  ограничения: имя карты, placement pair, cable-route triple) маппятся в 409
  контрактного вида `{error:{code,…}}`. Handler обязан классифицировать
  ошибку/constraint (по имени нарушения); НЕИЗВЕСТНЫЙ IntegrityError не
  маскируется как UNIQUENESS_CONFLICT и остаётся server-side ошибкой с логом.
  Regression-тесты: name-conflict race → 409; неклассифицируемое нарушение →
  не 409/UNIQUENESS_CONFLICT. Фронтенд показывает код ошибки, а не «HTTP 500».
- Статус: DONE — 2026-08-26, 1796a2386be13e79765cd6cce91096b3d1921973
  corrective: 1bc10068b88b06a72e15fb4e5e1de1a29e33636e

### API-002 — NOT_FOUND семантика для отсутствующих ресурсов
- Категория: API contract · Severity: LOW · До L2: нет
- Behavior-preserving: НЕТ (меняет публичные статусы — требует фиксации в docs/08)
  · Benchmark: нет
- Зависимости: нет
- Acceptance: GET несуществующей карты/объекта → 404 `NOT_FOUND`; docs/08
  дополнены; frontend корректно отображает.
- Статус: TODO

## Frontend contract

### FE-001 — Hardening datasource blueprint-upgrade
- Категория: frontend contract · Severity: MEDIUM · До L2: ДА
- Behavior-preserving: да · Benchmark: нет
- Зависимости: нет
- Acceptance: (а) строгий парсер analysis-документа — malformed ответ даёт
  bounded Error и alert, не крэш рендера; (б) конфликт определяется по
  {status, code}, не по подстроке сообщения; vitest на оба случая.
- Статус: TODO

### FE-002 — Guard двойного создания карты
- Категория: frontend contract · Severity: LOW · До L2: нет
- Behavior-preserving: да · Benchmark: нет · Зависимости: нет
- Acceptance: двойной клик «Создать» → один POST; кнопка disabled во время
  запроса; vitest.
- Статус: TODO

### FE-003 — Ключи legacy layout store
- Категория: frontend contract · Severity: LOW · До L2: нет
- Behavior-preserving: да · Benchmark: нет · Зависимости: нет
- Acceptance: ключ storage включает sceneKey ИЛИ неиспользуемый проп удалён;
  unit-тест на отсутствие cross-scene leakage.
- Статус: TODO

## Localization

### LOC-001 — Завершение typed i18n-границы на активных поверхностях
- Категория: localization · Severity: MEDIUM · До L2: ДА
- Behavior-preserving: да (только UI-строки) · Benchmark: нет
- Зависимости: claim в docs/09-01 уже скорректирован этим проходом
- Scope: QuickInspector, PhysicalObjectDetailsSection, Inspector, Create*/
  Connect* формы, MapPage literals, русские тексты в dataSources.
- Acceptance: отсутствие нелокализованных source-level/static RU UI-строк вне
  i18n-границы в перечисленных компонентах (проверка по исходникам/тестом,
  НЕ по отсутствию кириллицы в DOM — пользовательские и backend данные могут
  быть русскими); EN-локаль рендерит эти поверхности словарными строками;
  vitest паритетности ru/en ключей; после завершения вернуть полный
  IMPLEMENTED-claim в docs/09-01.
- Статус: TODO

## Maintainability

### MAINT-001 — Публичный доступ к состоянию canonical link
- Категория: maintainability · Severity: LOW · До L2: нет
- Behavior-preserving: да · Benchmark: нет · Зависимости: нет
- Acceptance: `apply_upgrade` использует публичный метод анализатора; приватный
  доступ из чужого модуля устранён.
- Статус: TODO

### MAINT-002 — Разбиение main.py (watch-item)
- Категория: maintainability · Severity: LOW · До L2: нет — сделать при
  добавлении первых L2-endpoints
- Behavior-preserving: да (роутеры без смены путей) · Benchmark: нет
- Зависимости: старт L2 API work
- Acceptance: endpoints сгруппированы по доменам; пути и контракты не изменены.
- Статус: TODO

## Documentation

### DOC-001 — Семантика alias'ов слотов при upgrade (product decision)
- Категория: documentation · Severity: LOW · До L2: нет
- Behavior-preserving: n/a (сначала только docs) · Benchmark: нет
- Зависимости: решение product/architecture владельца
- Acceptance: docs/09-01 явно фиксируют, обновляются ли display aliases
  существующих CP/NI при upgrade; при решении «обновлять» — отдельный пункт
  backlog с миграцией ожиданий UI.
- Статус: TODO

## Performance

Формат «до L2»: ДА = обязательно; НЕТ = можно после старта L2 по данным
benchmark. Профили и бюджеты — [[10-03-performance-baseline|10.3]].

### PERF-001 — Performance benchmark foundation (PERF.0)
- Категория: performance (+ tooling/docs) · Severity: HIGH (enabler) · До L2: ДА
- Behavior-preserving: добавляет только tooling · Benchmark: сам является им
- Зависимости: none; разблокирует PERF-006…009
- Acceptance: детерминированный генератор 4 профилей (SMALL/MEDIUM/
  PORT_HEAVY/LARGE); pytest-марки считают query-count/latency/JSON-size;
  Playwright-каркас меряет time-to-map/layout/DOM/interactions; baseline
  записан в [[10-03-performance-baseline|10.3]].
- Статус: TODO

### PERF-002 — Bounded reads деталей/инвентаря (PERF.2)
- Категория: performance · Severity: HIGH · До L2: ДА
- Behavior-preserving: да (DTO не меняются; cable-endpoints — новый additive read)
  · Benchmark: желательно до/после на MEDIUM
- Зависимости: нет
- Acceptance: детали объекта стоят константного числа запросов от размера
  объекта (не БД); выбор кабеля не вызывает полный inventory; `_occupancy`
  однопроходная; e2e каталога/инспектора зелёные.
- Статус: TODO

### PERF-003 — Устранение повторных обходов в object-level L1 trace (PERF.3)
- Категория: performance · Severity: HIGH · До L2: ДА
- Behavior-preserving: да при semantic/golden equivalence артефактов
  · Benchmark: нет (golden обязателен)
- Зависимости: нет
- Acceptance: устранены S×T повторных полных обходов и query-per-hop чтения
  при сохранении semantic/golden equivalence trace artifact: verdict, source
  identity, branches, evidence, ambiguity/conflict-семантика, cycles, ordering.
  Конкретный алгоритм (multi-target BFS, общий predecessors-обход или иной)
  сознательно НЕ зафиксирован — выбирается и обосновывается в implementation
  milestone. Any-port trace на MEDIUM укладывается в budget [[10-03]].
- Статус: TODO

### PERF-004 — Мемоизация сцены (PERF.1)
- Категория: performance / frontend contract · Severity: HIGH · До L2: ДА
- Behavior-preserving: да (чистый refactor) · Benchmark: замер до/после желателен
- Зависимости: нет
- Acceptance: overlay/cablePresentation мемоизированы; nodes/edges в
  TopologyCanvas пересоздаются только при изменении входов; DeviceNode и edge-
  компоненты под React.memo со стабильными data; все MapPage/Canvas тесты
  зелёные; selection/dragstop p95 ≤ budget на MEDIUM.
- Статус: TODO

### PERF-005 — Ленивая загрузка logical-проекции
- Категория: performance · Severity: MEDIUM · До L2: ДА (дёшево)
- Behavior-preserving: да (данные появляются позже) · Benchmark: query-count до/после
- Зависимости: нет
- Acceptance: logical-документ грузится при первом входе в Logical view (или
  scoped картой); физический view не триггерит unscoped проекцию БД.
- Статус: TODO

### PERF-006 — Anti-DOM стратегия (виртуализация/LOD/MiniMap)
- Категория: performance · Severity: HIGH (на PORT_HEAVY) · До L2: НЕТ —
  решить по данным после PERF-001/004/007
- Behavior-preserving: частично (визуальные изменения LOD — осознанные)
  · Benchmark: ОБЯЗАТЕЛЕН
- Зависимости: PERF-001, PERF-004, PERF-007
- Acceptance: выбранная стратегия подтверждена цифрами; pan-FPS/DOM-count/time-
  to-map достигают целей 10.3 на PORT_HEAVY; поведение edge-якорей у границ
  viewport проверено тестами.
- Статус: TODO

### PERF-007 — Skip-ELK для авторитарных SavedMap сцен
- Категория: performance · Severity: MEDIUM · До L2: НЕТ (сильно желательно до
  L2-overlay работ)
- Behavior-preserving: почти — deterministic fallback координат для нод без
  авторитарной позиции (interstitial cables) может визуально отличаться
  · Benchmark: сначала замер доли ELK в time-to-map
- Зависимости: PERF-001 (измерение)
- Acceptance: saved-map physical путь строит позиции без полного ELK; ELK
  остаётся в legacy/auto-layout/fallback-ветках; визуальная приёмка fallback;
  time-to-map улучшение зафиксировано в 10.3.
- Статус: TODO

### PERF-008 — Scope-pushdown проекции
- Категория: performance · Severity: MEDIUM · До L2: НЕТ (по данным)
- Behavior-preserving: да (read-time валидации и gaps сохраняются)
  · Benchmark: ОБЯЗАТЕЛЕН (query-count/latency на PORT_HEAVY)
- Зависимости: PERF-001; включает устранение per-hop/per-interface чтений
  логического слоя проекции
- Acceptance: число строк/параметров проекции масштабируется scope'ом карты, а
  не размером БД; IN(все id) устранены; результаты e2e проекций идентичны.
- Статус: TODO

### PERF-009 — Сокращение стоимости сериализации больших документов
- Категория: performance · Severity: MEDIUM · До L2: НЕТ (по данным)
- Behavior-preserving: да (аддитивный opt-out флаг дефолтно выключен)
  · Benchmark: ОБЯЗАТЕЛЕН (сплит resolver/pydantic/json)
- Зависимости: PERF-001
- Acceptance: измеренный сплит зафиксирован; при включённом флаге map-сцена
  получает документ ≤ budget размера без потери контракта для остальных
  потребителей.
- Статус: TODO

### PERF-010 — Точечные подписки WiringRoute
- Категория: performance / frontend contract · Severity: LOW · До L2: нет
- Behavior-preserving: да · Benchmark: нет · Зависимости: нет
- Acceptance: WiringRoute не подписан на всю коллекцию nodes; O(N)-поиски
  заменены memo-id + useInternalNode.
- Статус: TODO

### PERF-011 — Агрегация списков библиотек
- Категория: performance · Severity: LOW · До L2: нет
- Behavior-preserving: да · Benchmark: нет · Зависимости: нет
- Acceptance: counts/latest-version одним групповым запросом; ответы списков
  байт-в-байт эквивалентны (порядок сохранён).
- Статус: TODO

## Сводка: обязательные до L2

CONC-001 · API-001 · FE-001 · LOC-001 · PERF-001 · PERF-002 · PERF-003 ·
PERF-004 · PERF-005.

Рекомендуемый порядок — correctness/contracts перед performance tooling:
CONC-001 → API-001 → FE-001 → PERF-001 → PERF-004 → PERF-002 → PERF-003 →
PERF-005 … LOC-001 параллелится с любым пунктом. PERF-001 — первый именно
внутри performance-направления; measure-first пункты (PERF-006…009) начинаются
только после его завершения и фиксации baseline ([[10-03]]).
