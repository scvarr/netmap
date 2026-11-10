# Единый backlog

[Текущее состояние](PROJECT_STATE.md) · [Контракты](ARCHITECTURE.md) · [Решения](OPEN_DECISIONS.md)

OPEN — отсутствует необходимая реализация; RECHECK PENDING — исправление есть,
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

## Remaining Phase C

| ID | Остаток / критерий завершения | Статус | Зависимости / приоритет |
| --- | --- | --- | --- |
| C-UX-01 | Проверить Location tree/create/reparent произвольной глубины | RECHECK PENDING | P-UX-18 реализован |
| C-UX-02 | Проверить штатное создание из BaseTemplate, отсутствие обычного ручного обхода и initial Location | OPEN | HV-01 покрывает только часть; replacement P-UX-14 |
| C-UX-03 | Понятные FRONT/REAR как физические стороны, без input/output смысла | OPEN | Шаблоны/карта, reload |
| C-UX-04 | Явное переименование объекта во всех представлениях с сохранением IDs/связей | OPEN | P-UX-15 не реализует rename |
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

- P-UX-07: RU terminology; P-UX-08: shared page shell; P-UX-11: bounded editor viewport.
- P-UX-13/14/15: заменяющие BaseTemplate create/picker/initial Location/object tabs
  сценарии. Проверить без восстановления obsolete Blueprint workflow.
- P-UX-19: отдельный пользовательский проход preview/conflicts/atomic Location series.
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

C-CAP-01 — OPEN: template endpoint cardinality/member mapping, материализация и
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
| PERF-011 | OPEN: aggregate library counts/latest | Применить к Base/Module templates; bounded queries с тем же порядком | LOW / НЕТ |
| API-002 | PRODUCT DECISION PENDING: единая NOT_FOUND read семантика | Сначала контракт; не менять HTTP statuses автоматически | LOW / НЕТ |
| FE-002 | RECHECK PENDING: защита create-map от double submit | Проверить один POST и disabled pending; не дублировать существующий guard | LOW / НЕТ |
| FE-003 | RECHECK PENDING: scene keys layout store | Проверить изоляцию active callers; удалённые paths не восстанавливать | LOW / НЕТ |
| MAINT-002 | BLOCKED: разбиение main.py при расширении L2 API | После L1 PRODUCT COMPLETE и конкретного L2 scope; сохранить API | LOW / НЕТ |

Старые CONC-002/CORR-002/MAINT-001/DOC-001 относились к удалённому Blueprint
upgrade/delete/slot API и не являются обязательной реализацией. Безопасность
новых template lifecycle защищена текущим контрактом, не восстановлением старого.
CORR-001 (глубокие passive paths) — RECHECK PENDING: проверить текущий iterative
resolver на глубокой легальной цепи; criteria — без RecursionError и потери evidence;
LOW, не автоматически до L2. CONC-001/API-001/FE-001/LOC-001 завершены и не возвращены.
