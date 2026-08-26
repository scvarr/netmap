# 10.1 Реестр находок аудитов

Самодостаточный компактный реестр: каждая запись содержит место, суть, риск и
действие в объёме, достаточном для постановки задачи без обращения к внешним
или прошлым отчётам. Канонические действия и статусы — в
[[10-02-stabilization-backlog|10.2]].

Формат: **ID** · severity · место · суть → риск → действие (→ backlog).

## Concurrency / Correctness

- **CONC-001** · HIGH · `app/blueprint_catalog.py:417-461` (`apply_upgrade`) —
  materialизация новых internal links идёт без `FOR UPDATE` на участвующие
  ConnectionPoint, тогда как `physical_connections.create_endpoint_link`
  блокирует их; пары точек не защищены DB-uniqueness. Параллельный wiring во
  время upgrade может создать второй canonical Connection одной пары → тихая
  двусмысленная топология. → Блокировать точки в `apply_upgrade`. → CONC-001.
- **CONC-002** · LOW · `app/blueprint_catalog.py:231-255` vs `:313-368` —
  `delete_blueprint` держит lock только на `ObjectBlueprint`, `instantiate`
  читает версию без блокировки: гонка даёт IntegrityError/500 вместо чистой
  ошибки. → Lock версии в instantiate и/или API-001 закрывает симптом.
- **CORR-001** · LOW · `app/topology_projection_resolver.py:686-742` —
  рекурсивный `_walk_passive_l1`: глубокая легальная пассивная цепочка может
  упасть RecursionError/500 вместо корректного результата. → Iterative
  traversal без изменения семантики; ограничение глубины с gap-кодом — только
  как отдельное architecture/product решение.
- **CORR-002** · LOW · `app/models.py:376-392` — уникальность unordered-пары
  internal links обеспечена только на уровне приложения; БД пропускает
  (v,A,B)+(v,B,A). → CHECK `slot_a_id < slot_b_id` или functional unique index.

## API contract

- **API-001** · MEDIUM · `app/saved_map_catalog.py:28-59,121-137`; глобально:
  только L2-endpoint маппирует IntegrityError (`app/main.py:845-848`). Гонки
  уникальности (имя карты, placement, первый cable-route) возвращают 500
  `{"detail":…}` вне контракта `{error:{code,message}}`; фронтенд показывает
  безличную ошибку, retry-семантика ломается. → Глобальный handler
  IntegrityError → 409 контрактного вида.
- **API-002** · LOW · все read-endpoints возвращают 422 VALIDATION_ERROR для
  несуществующих ресурсов (`app/main.py:228-230` через `_require_map` и
  аналогично). Согласовано, но нестандартно; затруднит automation-клиентов
  (docs/00 API-first). → Код `NOT_FOUND` + 404; зафиксировать в docs/08.

## Frontend contract

- **FE-001** · MEDIUM · `frontend/src/topology/apiBlueprintUpgradeDataSource.ts:4-16`
  — единственный datasource без runtime-валидации (`body as …`);
  `InfrastructureObjectDetailPage.tsx:262` определяет конфликт подстрокой
  `/status 409/` в тексте чужого сообщения. Malformed ответ крэшит панель
  upgrade; перефразировка сообщения тихо ломает UX конфликта. → Строгий парсер
  + типизированные ошибки {status, code}.
- **FE-002** · LOW · `MapPage.tsx:1178,423-438` — кнопка «Создать» карту не
  блокируется на время запроса: двойной клик = два POST, ложная ошибка после
  успеха. → In-flight guard + disabled.
- **FE-003** · LOW · `frontend/src/topology/layoutStore.ts:19-21,66-68` +
  необъявленно используемый проп `topologyLayoutStore` в MapPage — ключ
  localStorage только layer/detail: потенциальный cross-scene leakage при
  возврате legacy-режима. → Включить sceneKey в ключ или удалить проп.

## Localization

- **LOC-001** · MEDIUM · Десятки RU-литералов вне typed i18n-границы на активных
  поверхностях: `QuickInspector.tsx:240-241,422,432,523,533`,
  `PhysicalObjectDetailsSection.tsx:299-351`, `Inspector.tsx`,
  `Create*/Connect*.tsx`, `MapPage.tsx:1240,1249,1277`, а также русские тексты
  в data-слое `apiPhysicalObjectDeleteDataSource.ts:6-14`. EN-локаль даёт
  смешанный интерфейс. Claim «IMPLEMENTED» в docs/09-01 скорректирован при
  этом проходе. → Перенос строк в `i18n.tsx` (+ тест паритетности ru/en).

## Maintainability / Documentation

- **MAINT-001** · LOW · `blueprint_catalog.py:453` — вызов приватного
  `_canonical_link_state` анализатора. → Публичный метод анализатора.
- **MAINT-002** · LOW · `app/main.py` (~60 endpoints одним файлом) — риск
  скрытия разных transaction boundaries при росте L2. Watch-item: разбить при
  добавлении первых L2-endpoints.
- **DOC-001** · LOW · Display-name слота, изменённый в новой версии шаблона,
  не распространяется на уже материализованные CP/NI при upgrade
  (`blueprint_catalog.py:418-433` сеет metadata только новым сущностям).
  Соответствует букве L1S.6b, но является product-вопросом. → Зафиксировать
  семантику явно в docs/09-01 (product decision), код не менять до решения.

## Performance

Канонические пункты PERF-001…PERF-011 (см. 10.2); краткая сводка находок:

- **PERF-002** · HIGH · детали одного объекта грузят глобальные
  точки/members (`physical_object_details_resolver.py:20-23`); выбор кабеля в
  инспекторе тянет полный inventory (`QuickInspector.tsx:122-131`);
  `_occupancy` O(N·M) (`catalog_inventory_resolver.py:76-88`). Стоимость
  выбора растёт с размером всей БД.
- **PERF-003** · HIGH · object-level L1-trace: S×T полных BFS + полный
  обход циклов на каждый source (`physical_object_l1_resolver.py:41-62,87-119`),
  query-per-hop binding-lookup'ов.
- **PERF-004** · HIGH · нет мемоизации: overlay/cablePresentation
  считаются inline каждый рендер (`MapPage.tsx:1310-1314,212-214`), массивы
  nodes/edges пересоздаются (`TopologyCanvas.tsx:232-288`), нода/ребро без
  React.memo → полная перестройка сцены на каждую интеракцию.
- **PERF-005** · MEDIUM · логическая проекция всей БД грузится eagerly
  даже в physical view (`MapPage.tsx:372-394`).
- **PERF-006** · HIGH@PORT_HEAVY · нет виртуализации/LOD
  (`TopologyCanvas.tsx:372-408`, `DeviceNode.tsx:36,53-60`, MiniMap): 20k+
  портов ≈ 100k+ DOM-элементов.
- **PERF-007** · MEDIUM · ELK выполняется полностью и в SavedMap-режиме,
  результат перекрывается авторитарными позициями (`layout.ts:132-168`,
  `TopologyCanvas.tsx:132-167`).
- **PERF-008** · MEDIUM · scoped проекция читает
  все точки/связи БД (`topology_projection_resolver.py:170-171`,
  `repository.py:1301-1306`), гигантские IN-списки aliases (`:193-195`), ORM-
  churn в member-join (`repository.py:1308-1366`).
- **PERF-009** · MEDIUM · двойная стоимость сериализации/парсинга
  больших документов (Pydantic strict + 15–30 МБ JSON + полный frontend-
  валидатор `apiTopologyDataSource.ts:66-89`).
- **PERF-010** · LOW · `WiringRoute` подписан на весь nodes-store с
  O(N)-поисками в рендере (`FloatingTopologyEdge.tsx:105-107`).
- **PERF-011** · LOW · N+1 в списках библиотек
  (`blueprint_catalog.py:146-179`, `port_block_catalog.py:65-93`).
- Микро (без отдельных пунктов backlog): линейный slot-find на конец ребра
  (`FloatingTopologyEdge.tsx:82`), sort точек generic-нод в edge-render,
  worst-case ring-search вставки (`nodeFootprint.ts:74-89`) — оставить,
  пересмотреть только после PERF-004.

## Проверено и подтверждено чистым (не пере-аудировать без изменений)

- Миграции 0001→0026 линейны и соответствуют `models.py` (включая split
  x/y → view_positions в 0023); downgrade-цепочки корректны.
- SavedMap изоляция: presentation-таблицы читаются только maps-API,
  catalog-аннотациями и deletion-cleanup; ни один resolver их не читает;
  resolver-модули не пишут в сессию.
- Identity-гигиена: slot_key/local_id отделены от labels/номеров; фронтенд
  берёт identity только из canonical refs.
- Version numbering под `FOR UPDATE` родительской строки + DB unique.
- Индексы горячих read-путей покрывают запросы (alias-lookup'ы покрыты
  unique-constraint индексами); критичных отсутствующих индексов нет.
- Инфраструктура: nginx `/api` → backend соответствует фронтенд-путям;
  миграции применяются до старта (Dockerfile CMD); тестовая БД защищена
  guard'ом conftest.
