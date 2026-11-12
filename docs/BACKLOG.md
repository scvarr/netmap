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
C-UX-03 закрыт как NOT REQUIRED. Для C-UX-05/06/09/10, C-VIS-01/02 сохраняются findings, но обязательность каждого
как blocker C и точный bounded scope требуют решения: список применимых C-*
не означает автоматического MUST для любой обсуждавшейся capability.

Необязательные для текущего gate улучшения: performance/maintenance пункты
с «до L2: НЕТ», archive measurement/compression; повышение их обязательности
требует решения. P-UX-21 имеет согласованное направление, но статус обязательного
blocker не установлен. Для P-UX-22, C-UX-16, дополнительных справочников и
будущих slices контракт/обязательность уточняются отдельно. CAT-E остаётся
работой Phase E, CAT-F зависит от Phase F; это не blockers начала Phase C.

## Ближайшая очередь реализации — решение 11.11.2026

BT-DRAFT-01 → BT-COPY-01 → C-CAP-01 → продолжение representative L1 acceptance.
Это очередь реализации, не изменение последовательности gates Phase A–I.
L1 PRODUCT COMPLETE остаётся обязательным до продуктового L2/L3.

### BT-DRAFT-01 — локальное автосохранение BaseTemplate

**IMPLEMENTED / ACCEPTED / MERGED.** Один локальный черновик создания
и отдельный по template ID; localStorage, пауза 350 мс и flush при уходе.
Новый черновик предлагается продолжить; отказ требует подтверждения.
Существующий восстанавливается при совпадении server draft generation;
конфликт блокирует применение и не перезаписывает сервер.
Сохраняются параметры, панели, порты, геометрия, типы, имена, внутренние связи,
модульные места, активная панель, счётчики и порядок/параметры именования.
Выделение и временные состояния взаимодействия не сохраняются.
Очистка только после успешного server save той же версии; ошибки storage
и повреждение данных видимы. API, миграции и draft/candidate/publication без изменений.
Без синхронизации вкладок/устройств; локальные данные зависят от профиля браузера.

### BT-COPY-01 — копирование BaseTemplate

**IMPLEMENTED / external inspection pending.** «Создать копию» в библиотеке из опубликованной ревизии создаёт новый
независимый BaseTemplate. Копируются определения, панели, порты, PortType refs,
геометрия, внутренние связи и модульные места. Не копируются PhysicalObject,
canonical endpoints, подключения и зависимости исходных экземпляров.
Исходный шаблон не изменяется. Источник закреплён template/revision ID в URL;
загрузка с повторной попыткой, штатный create API только при явном сохранении.
Копия использует BT-DRAFT-01; существующий черновик требует выбора и подтверждения
удаления. Архивные PortType сохраняются с предупреждением и ручной заменой.
«Отмена» для создания, копии и редактирования очищает только локальное состояние
после подтверждения; ошибка storage оставляет редактор открытым. Backend lifecycle
не изменён. Адресные component/model tests и Docker build; ручная проверка pending.

## Remaining Phase C

| ID | Остаток / критерий завершения | Статус | Зависимости / приоритет |
| --- | --- | --- | --- |
| C-UX-01 | Проверить Location tree/create/reparent произвольной глубины | RECHECK PENDING | P-UX-18 реализован |
| C-UX-02 | Штатное создание PhysicalObject из BaseTemplate с выбором initial Location, без обходных ручных операций | VERIFIED | Пользователь 10.11.2026 подтвердил неоднократную успешную проверку; только этот контракт |
| C-UX-03 | Отдельная FRONT/REAR-семантика не требуется; произвольных названий панелей достаточно | NOT REQUIRED | Решение 11.11.2026; закрыто без реализации отдельной функции |
| C-UX-04 | Rename оборудования с портами, Cable, Location и SavedMap; новое имя в списке, карточке, карте и инспекторе; поиск и L1 trace; переходы, варианты карты и reload; IDs, подключения и placements сохранены, дубли отсутствуют | VERIFIED | Пользователь прошёл все шесть ручных проверок 11.11.2026 |
| C-UX-05 | Runtime map guides нужны; ориентиры — уже размещённые объекты | OPEN | Точный bounded UX-контракт открыт; presentation-only, отдельно от auto-layout |
| C-UX-06 | Независимые Width/Height пока не реализовывать | OPEN | Повторно оценить необходимость после P-UX-21; не VERIFIED |
| C-UX-09 | Раскрываемый графический preview BaseTemplate непосредственно при выборе шаблона | OPEN | Ориентир — существующий preview библиотеки; реализация открыта |
| C-UX-10 | Location cable channels, общая направляющая и comb; счётчик и exact trace | OPEN | Boundary anchors/snapping уже есть, но не заменяют shared channels/comb; решения persistence/UX/geometry — OPEN_DECISIONS |
| C-UX-12 | Проверить массовое именование, spatial order, обнаруживаемость и сохранение | RECHECK PENDING | Исправление реализовано |
| C-UX-13 | Проверить полезную площадь BaseTemplate editor при больших данных | RECHECK PENDING | Компоновка реализована |
| C-UX-14 | Проверить понятность Change Inspector и точность больших сводок impact | RECHECK PENDING | Реализован; HV-01 не заменяет UX recheck |
| C-UX-15 | Natural ordering trace port selector: реальные panel/port labels и модульный контекст при совпадении; «Любой порт» первым, 1,2,…10; дубликаты отдельны | VERIFIED | Техническая реализация прошла external review (c4c04ed); пользователь 10.11.2026 подтвердил успешную ручную проверку |
| C-UX-16 | Undo/Redo draft waypoint operations и delete в панели | PRODUCT DECISION PENDING | История отсутствует; delete через инспектор есть; final toolbar/hotkeys открыты |
| C-COR-02 | Полный manual recheck distribute у границ панели, невозможная операция и reload | VERIFIED | Пользователь 10.11.2026 подтвердил границы панели, атомарное отклонение невозможной операции, сохранение и повторное открытие |
| C-VIS-01 | Совпадающий общий подсвеченный участок допустим; canonical trace evidence отдельных Cables не смешивается | OPEN | Геометрическое пересечение не доказывает connectivity; реализация не объявляется завершённой |
| C-VIS-02 | Отдельное исправление отложено; повторная проверка после изменения маркеров в P-UX-21 | OPEN | Не закрывается автоматически |
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
  компактный picker preview — C-UX-09; rename — VERIFIED в C-UX-04.
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

C-CAP-01 (единый пункт, ссылка из Phase C) — OPEN, обязательный semantic gap Phase D.
Canonical ConnectionPoint/Connection/ConnectionMember foundation существует, но
BaseTemplate authoring, materialization и обычный Cable UI ограничены cardinality=1.
Обязательный сценарий стенда: один задний многоканальный вход патч-панели,
24 независимо адресуемых канала, 24 отдельных передних порта, exact internal
member mapping 1..24, один физический многоканальный Cable и точный L1 trace
отдельного канала после reload. Не создавать Fanout entity, фиктивные порты
или 24 искусственных Cable для подмены одного физического.
Точные DTO/API, редактирование member mappings, lifecycle/reconcile и UX — OPEN;
foundation не означает IMPLEMENTED.

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

Контракт [L1-CONTRACT-02](L1_CONNECTIVITY.md) закрепляет L1-O1–L1-O10 как DECIDED.
C-CAP-01 остаётся OPEN Phase D, L1 PRODUCT COMPLETE обязателен до L2/L3.
Решения не объявляют текущий core полным multichannel продуктом.

## Последовательность C-CAP-01 — OPEN implementation milestones

Каждый этап требует отдельного implementation contract до выбора DTO, таблиц и
миграций. Порядок 01 → 02 → 03 → 04 сохраняет небольшой scope каждого этапа.

| Этап / цель | Границы | Зависимости | Инварианты | Минимальная приёмка |
|---|---|---|---|---|
| C-CAP-01-01: multichannel definitions/materialization | BaseTemplate capacity и internal mapping; ModuleTemplate continuity отдельная задача | L1-O1–O10; контракт provenance и безопасного reconcile | Stable IDs, immutable revisions, без instance overrides и потери dependencies | Data-driven N, rear-N → N front, permutation/subset после materialization и reload; конфликт reconcile атомарно отклоняется |
| C-CAP-01-02: внешний write/occupancy/lifecycle | Один двухточечный multichannel Cable; create/edit/disconnect | 01; контракт internal/external roles | Одна Cable identity, occupancy по member, internal и external независимы; без автоматического удаления | N:N, permutation/subset; занятый member отклоняет всю операцию; свободный member того же point доступен; disconnect сохраняет internal continuity; reload |
| C-CAP-01-03: пользовательский authoring | Общий механизм internal/external mappings и согласованный UI | 01 и 02; существующие UI patterns | Preview обязателен, сохранение атомарно, presentation не evidence | Прямой/обратный/заданный порядок, ручная коррекция, subset, conflict feedback и reload; без фиктивных портов/Cables |
| C-CAP-01-04: exact trace и групповая приёмка | Member path/evidence, independent group evaluation; интеграционный цикл | 01–03; контракт ожидаемых соответствий | Нет неявного active transit, нет смешения members; REACHABLE не измерение | Rear-24/front-24 с одним внешним trunk, permutation, partial mapping, passive chain и active boundary после reload; резерв не ошибка, пропуск ожидаемой пары виден |

Многоконцевые Cable, PON splitter и специфическая active conversion остаются
отдельными будущими этапами с собственными контрактами, не входят в C-CAP-01.
ModuleTemplate internal continuity также требует отдельного bounded implementation
contract; её готовность не выводится из BaseTemplate и не закрывается этим планом.


## C-CAP-01-01 — definitions и materialization

Реализованы cardinality и exact internal member mappings BaseTemplate,
атомарная materialization и запрет публикации изменения физической конструкции.
Контракт хранения и границы: [ARCHITECTURE](ARCHITECTURE.md#c-cap-01-01--definitions-и-materialization).
Графический multichannel edit/copy блокируется без потери данных; API доступен.
C-CAP-01 остаётся **OPEN Phase D**; C-CAP-01-02/03/04 не реализованы.

## L1-REFERENCE-01 — принятый target, будущая реализация

[Контракт и синтетический стенд](L1_REFERENCE_NETWORK.md): независимые карты,
CableType, переносимые файлы определений и demo initialization — DECIDED TARGET,
не IMPLEMENTED. Map isolation требует отдельного bounded milestone до demo loader.
Portability требует собственного implementation contract отдельно от workspace v7.
C-CAP-01 остаётся OPEN Phase D; C-CAP-01-02/03/04 не закрыты; Phase A–I без изменений.
CAT-D: CableType как пользовательский справочник принят; состав технических полей
и реализация остаются OPEN, остальные классификации этим решением не утверждены.
