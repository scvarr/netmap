# Единый backlog

[Текущее состояние](PROJECT_STATE.md) · [Контракты](ARCHITECTURE.md) · [Решения](OPEN_DECISIONS.md)

VERIFIED — контракт реализован и принят; OPEN — отсутствует необходимая реализация; RECHECK PENDING — исправление есть,
нужна проверка; PRODUCT DECISION PENDING — контракт ещё не выбран; BLOCKED —
конкретная зависимость. Приоритет не задан, если явно не указан.
Для ручных проверок зависимость — доступный Docker stand с representative data;
критерий — сценарий в обычном UI, Save/reload и сохранение canonical identity/evidence.
Реализованные соседние milestones не закрывают finding автоматически.

## Последовательность Phase A–I

| Phase | Статус и оставшаяся работа | Зависимость и критерий завершения |
| --- | --- | --- |
| A — known L1 correctness/workflows | Завершена; повторная реализация не нужна | Exact evidence, Cable navigation, Location UX уже реализованы |
| B — bounded L1 families | Spatial/route scope завершён; label работает; будущие metadata отдельно | P-UX-03A–E приняты, MapComposite удалён; не вводить generic scene engine |
| C — representative L1 acceptance | OPEN: применимые проверки ниже и clean acceptance | Обязательные fixes; закрыты findings и пройден representative UI scenario |
| D — promoted semantic gaps | OPEN: C-CAP-01, необходимые классификации | Только доказанные Phase C gaps; truthful authoring/materialization/trace |
| E — shared UI/UX foundation | OPEN | После C/D; audit, primitives/archetypes и bounded migration plan, включая справочники |
| F — application productization | BLOCKED: persisted NetworkWorkspace, auth, ACL, sharing, activity | E и согласованные contracts; практически используемое изолированное multi-user приложение |
| G — controlled UI migration/polish | BLOCKED | E/F surfaces; согласованные forms/tables/dialogs, focus/keyboard/accessibility и task-based checks |
| H — stabilization/performance | OPEN, финальный gate после G | Все «до L2: ДА» и явно promoted blockers закрыты на representative scale |
| I — final product acceptance | BLOCKED | A–H; workspace/login/access/sharing, writes/maps/trace, UI states, accountability и scale приняты |

Только после I допустимо **L1 PRODUCT COMPLETE**, затем продуктовый L2, затем L3.
Phase C и Phase D не завершены. Performance blocker можно исправлять раньше по
зависимости, не меняя порядок gates.

## Обязательность и очередь без изменения Phase A–I

Обязательные условия **L1 PRODUCT COMPLETE**: завершить gates C/D, затем E–I;
Phase F включает persisted NetworkWorkspace, auth/access/sharing/activity;
Phase H — PERF-002/003/004/005 («до L2: ДА»), актуальные измерения и явно
promoted blockers; Phase I — итоговая приёмка. Backend L2/L3 core этого не заменяет.

Необходимая работа C/D: representative L1 acceptance, конкретные остатки
RECHECK ниже, truthful multichannel C-CAP-01; CAT-D сначала требует решения
о минимальном составе. C-CAP-01 один, его строка в C — finding для Phase D.
Для C-UX-03/05/06/09/10, C-VIS-01/02 сохраняются findings, но обязательность каждого
как blocker C и точный bounded scope требуют решения: список применимых C-*
не означает автоматического MUST для любой обсуждавшейся capability.

Необязательные для текущего gate улучшения: performance/maintenance пункты
с «до L2: НЕТ», archive measurement/compression; повышение их обязательности
требует решения. P-UX-21 имеет согласованное направление, но статус обязательного
blocker не установлен. Для P-UX-22, C-UX-16, дополнительных справочников и
будущих slices контракт/обязательность уточняются отдельно. CAT-E остаётся
работой Phase E, CAT-F зависит от Phase F; это не blockers начала Phase C.

## Remaining Phase C

| ID | Остаток / критерий завершения | Статус | Зависимости / приоритет |
| --- | --- | --- | --- |
| C-UX-01 | Проверить Location tree/create/reparent произвольной глубины | RECHECK PENDING | P-UX-18 реализован |
| C-UX-02 | Штатное создание PhysicalObject из BaseTemplate с выбором initial Location, без обходных ручных операций | VERIFIED | Пользователь 10.11.2026 подтвердил неоднократную успешную проверку; только этот контракт |
| C-UX-03 | Явные FRONT/REAR как физические стороны, без input/output смысла | OPEN | Произвольные panel labels есть; отдельная семантика сторон этим не доказана. Уточнить, достаточно ли labels, затем проверить шаблон/карту/reload |
| C-UX-04 | Rename из списка объектов реализован; проверить новое имя в карточке, карте/инспекторе, поиске и trace после переходов и reload; IDs, подключения и placements неизменны | RECHECK PENDING | API и клиентские тесты есть; обновление всех зависимых представлений вручную не подтверждено |
| C-UX-05 | Guides границ/центров и равных интервалов при drag | OPEN | Presentation-only, без auto-layout |
| C-UX-06 | Независимые Width/Height placement через карту/карточку; порты следуют телу | OPEN | Единый presentation contract; не менять template geometry |
| C-UX-09 | Derived preview в компактном выборе BaseTemplate и ручная различимость | OPEN | Таблица есть, preview при создании отсутствует |
| C-UX-10 | Location cable channels, общая направляющая и comb; счётчик и exact trace | OPEN | Решения persistence/UX/geometry; OPEN_DECISIONS |
| C-UX-12 | Проверить массовое именование, spatial order, обнаруживаемость и сохранение | RECHECK PENDING | Исправление реализовано |
| C-UX-13 | Проверить полезную площадь BaseTemplate editor при больших данных | RECHECK PENDING | Компоновка реализована |
| C-UX-14 | Проверить понятность Change Inspector и точность больших сводок impact | RECHECK PENDING | Реализован; HV-01 не заменяет UX recheck |
| C-UX-15 | Natural ordering trace port selector: реальные panel/port labels и модульный контекст при совпадении; «Любой порт» первым, 1,2,…10; дубликаты отдельны | VERIFIED | Техническая реализация прошла external review (c4c04ed); пользователь 10.11.2026 подтвердил успешную ручную проверку |
| C-UX-16 | Undo/Redo draft waypoint operations и delete в панели | PRODUCT DECISION PENDING | История отсутствует; delete через инспектор есть; final toolbar/hotkeys открыты |
| C-COR-02 | Полный manual recheck distribute у границ панели, невозможная операция и reload | VERIFIED | Пользователь 10.11.2026 подтвердил границы панели, атомарное отклонение невозможной операции, сохранение и повторное открытие |
| C-VIS-01 | Trace виден поверх обычных совпадающих/пересекающихся routes, соседний Cable не evidence | OPEN | Плотная карта; channel-specific часть зависит от C-UX-10 |
| C-VIS-02 | Исследовать и устранить различия runtime marker sizes, проверить zoom | OPEN | Низкий приоритет; PT-03 не закрывает |
| C-VIS-03 | Сохранение цветов PortType на физической карте при Cable create/delete, L1 trace и wiring; форма и подсветка независимы от базового цвета | VERIFIED | Foreground SVG перекрывал DeviceNode фиксированной заливкой; теперь читает общий runtime PortType catalog, включая архивные типы. Wiring использует обводку/свечение без замены заливки. Адресные автоматические проверки пройдены: оба слоя, Cable lifecycle, trace/route, wiring, порядок catalog/projection. External review реализации daff76edce19424c6ba72004ee4b41f5b0d8772d и ручная приёмка пройдены 10.11.2026; пользователь подтвердил сохранение цветов после операций с кабелями и в проверенных режимах карты |
| C-CAP-01 | Truthful FANOUT-1x24 от authoring до одного multichannel Cable и member trace | OPEN | Promoted Phase D; не подменять 24 фиктивными входами/кабелями |

C-COR-01/C-UX-08 replacement VERIFIED, C-UX-07/C-UX-11 VERIFIED,
HV-01 PASSED, PT-01/02/03 приняты, P-UX-03E принят и merged — не backlog реализации.

Дополнительное ручное покрытие (RECHECK PENDING):

- P-UX-07: проверить понятность RU terminology в текущих формах и карте;
  P-UX-08: согласованность PageShell/header/loading/error на переходах между страницами;
  P-UX-11: только viewport ModuleTemplate и остальных редакторов, кроме BaseTemplate
  (его большие данные и полезная площадь проверяются один раз в C-UX-13).
- P-UX-13/14/15 не отдельная очередь: create/initial Location закрыты C-UX-02;
  компактный picker preview — C-UX-09; rename — только остаток C-UX-04.
  Остался RECHECK PENDING переходов обзор/физика/интерфейсы карточки: правильный
  объект, данные и возврат после reload. Obsolete Blueprint workflow не восстанавливать.
- P-UX-19: только preview/conflicts/atomic Location series и reload; дерево/create/reparent
  проверяются один раз в C-UX-01. Массовые endpoint naming/order — только C-UX-12;
  viewport BaseTemplate — только C-UX-13; Change Inspector — только C-UX-14.
- F2b composition; ModuleTemplate endpoint controls и pinned preview; адаптивная
  высота installation table; library faithful preview. HV-01 не доказал все visual cases.
- P-UX-10: применимость async page-chrome сценария к текущей библиотеке проверить;
  удалённый PortBlock catalog не восстанавливать.

### Clean representative L1 acceptance — OPEN

После обязательных fixes пройти с пустой тестовой БД rack-first/service-path
synthetic stand: оборудование/модули -> Locations (rack/room/floor/site) ->
Cables и passive continuity -> SavedMap/variants/collapse/routes -> trace exact
members/evidence -> export/reset/import/reload. Synthetic stand не утверждает
неизвестные факты реальной сети. Двигаться малыми UI-шагами, остановиться на
первом существенном finding, bounded fix/review/merge, повторить тот же шаг на
сохранённом stand. Прямые API/DB writes и fake topology не обходят missing capability.
Закрытие: применимые C-* проверены, обязательные blockers устранены или явно
перенесены по согласованному roadmap, все representative workflows завершены.

## Remaining Phase D и справочники

C-CAP-01 (единый пункт, ссылка из Phase C) — OPEN: template endpoint cardinality/member mapping, материализация и
UI multichannel connect должны выражать один вход с 24 каналами, internal fanout
и точный trace выбранного канала после reload. Не вводить Fanout entity ради формы.

CAT-D — PRODUCT DECISION PENDING: определить bounded состав необходимых
классификаций портов/кабелей; реализовать и проверить reusable user-defined
значения. PT-01/02/03 не переоткрываются. Технические характеристики PortType,
compatibility catalog и immutable-field locking требуют отдельного решения.
CAT-E — OPEN: создание типов непосредственно из форм и единый reusable UX;
зависит от Phase E. CAT-F — BLOCKED: workspace/access scope зависит от Phase F.

## Будущие product slices

P-UX-21 — OPEN: реализовать согласованное расположение секций PhysicalObject;
сначала решить label/cable collisions. Acceptance сохраняет geometry и PT-03.
P-UX-22 — PRODUCT DECISION PENDING: согласовать pan/drag modes/cursors/hotkeys,
затем проверить понятность доступных действий. Оба вне P-UX-03E.

Endpoint-relative route sections, ordered child layout/occupancy, reusable
Location series, selector collapse, arbitrary grouping, MapReference,
media/capability diagnostics, observations/Dynamic Maps — PRODUCT DECISION PENDING.
Их наличие в обсуждениях не делает каждый пункт обязательным до L2.
Workspace archive size/compression — OPEN: измерить текущий v7 по разделам и
ZIP/GZIP; старый размер v5 не является current baseline.

## Stabilization и performance gate

PERF-001 tooling выполнен. Старый baseline около 500 объектов/4000 портов
выявлял seconds-level endpoints и тысячи SQL queries; цифры не являются
измерением текущего HEAD. Перед оптимизацией обновить baseline текущего Docker
runtime, разделяя resolver/SQL/serialization/frontend и SMALL/MEDIUM/PORT_HEAVY/LARGE.
Численные бюджеты требуют калибровки, не выдумываются в DOC-RESET.

| ID | Статус / остаток | Зависимость и критерий | Приоритет / до L2 |
| --- | --- | --- | --- |
| PERF-002 | OPEN: bounded object details/inventory, occupancy и cable reads | Размер чтения от объекта/scope, не всей БД; query-count/latency before/after | HIGH / ДА |
| PERF-003 | OPEN: убрать повторные object-level trace обходы | Semantic/golden equivalence verdict/branches/evidence/conflicts/cycles/order | HIGH / ДА |
| PERF-004 | OPEN: оставшиеся scene computational hotspots и стабильные nodes/edges | Замер selection/drag, memo только где полезно; поведение сохранено | HIGH / ДА |
| PERF-005 | OPEN: устранить eager logical read, подтверждённый эффектом MapPage | Physical view не запускает глобальную logical projection; query-count | MEDIUM / ДА |
| PERF-006 | PRODUCT DECISION PENDING: DOM/LOD/virtualization strategy | PERF-001/004/007 и PORT_HEAVY measurements; anchors корректны | HIGH / НЕТ |
| PERF-007 | RECHECK PENDING: saved physical layout без полного ELK | Проверить текущий authoritative path/fallback и time-to-map, не возвращать ELK | MEDIUM / НЕТ |
| PERF-008 | OPEN: projection scope pushdown/N+1 | PERF-001; rows/parameters масштабируются scope; semantic equivalence | MEDIUM / НЕТ |
| PERF-009 | OPEN: serialization cost/size | PERF-001; measured split, согласованный bounded response без потери evidence | MEDIUM / НЕТ |
| PERF-010 | OPEN: точечные route subscriptions вместо O(N) | Проверить актуальный route component, доказать устранение лишних updates | LOW / НЕТ |
| PERF-011 | OPEN: aggregate BaseTemplate counts/latest и bounded Module endpoint reads | Base list делает per-item queries; Module latest уже scalar subquery, не реализовывать повторно; измерить оставшиеся reads | LOW / НЕТ |
| API-002 | PRODUCT DECISION PENDING: единая NOT_FOUND read семантика | Сначала контракт; не менять HTTP statuses автоматически | LOW / НЕТ |
| FE-002 | OPEN: защита create-map от double submit отсутствует в текущем create handler/dialog | Добавить pending guard и disabled; один POST, refresh retry без повторной mutation | LOW / НЕТ |
| FE-003 | RECHECK PENDING: scene keys layout store | Проверить изоляцию active callers; удалённые paths не восстанавливать | LOW / НЕТ |
| MAINT-002 | BLOCKED: разбиение main.py при расширении L2 API | После L1 PRODUCT COMPLETE и конкретного L2 scope; сохранить API | LOW / НЕТ |

Старые CONC-002/CORR-002/MAINT-001/DOC-001 относились к удалённому Blueprint
upgrade/delete/slot API и не являются обязательной реализацией. Безопасность
новых template lifecycle защищена текущим контрактом, не восстановлением старого.
CORR-001 (глубокие passive paths) — RECHECK PENDING: проверить текущий iterative
resolver на глубокой легальной цепи; criteria — без RecursionError и потери evidence;
LOW, не автоматически до L2. CONC-001/API-001/FE-001/LOC-001 завершены и не возвращены.

## Основания DOC-RECON-02 (10.11.2026)

Сверка с base `a0f9b8d522121668ae6bdc0b489cc02352a0be3d`; тесты только прочитаны,
не запускались. Ручная приёмка в этой сверке добавлена только для C-UX-02.

- C-UX-02/09: `frontend/src/pages/NewInfrastructureObjectPage.tsx`,
  `frontend/src/topology/apiBaseTemplateDataSource.ts`, `app/main.py`:
  выбор BaseTemplate и Location, create API; таблица выбора без derived preview.
- C-UX-04: `frontend/src/pages/InfrastructureObjectsPage.tsx` и `.test.tsx`
  (rename, authoritative inventory refresh включая cable endpoint labels, ошибки);
  `frontend/src/topology/apiPhysicalObjectDisplayNameWriteDataSource.ts` и `.test.ts`;
  `PUT /v1/topology/physical-objects/{physical_object_id}/display-name`,
  `app/device_catalog.py`, `tests/test_physical_object_display_name_e2e.py`
  (alias update, неизменность point/connection/placement IDs, validation).
  Эти проверки не доказывают обновление всех открытых UI views.
- Location tree/series: `app/location_catalog.py`, `tests/test_locations_e2e.py`;
  naming/viewport/impact: `frontend/src/pages/BaseTemplateEditor.tsx`,
  `BaseTemplateChangeInspector.tsx`, `app/base_template_review.py`.
  Визуальные остатки HV-01 сохраняются отдельно от lifecycle acceptance.
- PERF-005: `MapPage.tsx` запускает logical projection effect и в physical view;
  PERF-010: `FloatingTopologyEdge.tsx` использует `useNodes`; PERF-011:
  `app/hardware_catalog.py` — Base per-item counts/latest, Module latest уже aggregate.
- FE-002: в `MapPage.tsx` create не имеет pending guard, кнопка создания не disabled
  на время POST; guard variant creation не закрывает map creation.
- PERF-007/FE-003: `TopologyCanvas.tsx`, `topology/layout.ts`, `layoutStore.ts`
  содержат authoritative positions и scene scope; остаются isolation/fallback/time-to-map.

Остальные OPEN performance — задачи измерения и устранения оставшейся стоимости,
а не заявление об отсутствии всей оптимизации. Сначала текущий baseline для
PERF-002/003/004/008/009; только затем bounded fix по выявленному hotspot.
C-UX-05: guides в composition editor уже есть, остаток — runtime drag и равные
интервалы; не повторять editor guides. C-UX-06 — именно независимая placement
Height, не отсутствие template/body geometry. C-UX-10 — shared channel/comb,
не существующие boundary anchors/snapping. C-VIS-01/02 — проверяемые visual findings,
не доказанная причина дефекта и не повод переоткрыть PT-03/C-VIS-03.
