# 09.4 L1 Product UX completion

## Статус и граница

**ACTIVE** — короткий product/UX execution pass после завершения текущих
L1S.1–L1S.6 и до L1S.7. Его цель — сделать существующий L1 workflow надёжным и
понятным перед добавлением spatial hierarchy. Это не implementation
specification: он не фиксирует schema, API, DTO, persistence model или точный
visual design.

Pass сохраняет canonical topology как источник истины; Saved Map и cable route
остаются presentation-only. Blueprint и `PortBlock` остаются authoring/
provenance constructs, а immutable Blueprint history не изменяется. Контекст:
[[plans/09-01-l1-spatial-foundation-plan|09.1 L1 spatial foundation]],
[[reviews/09-ui-ux-review|09. UI/UX review]] и
[[plans/stabilization/10-02-stabilization-backlog|10.2 stabilization backlog]].

## Цели pass

1. **Надёжный cable routing.** Устранить ошибки создания, сохранения и
   повторного редактирования route. Ошибка сохранения presentation route не
   должна повторять уже выполненный canonical cable write.
2. **Видимость в плотной карте.** Выбранный или редактируемый кабель остаётся
   хорошо видимым; мешающие объекты могут становиться полупрозрачными, а
   остальные элементы не должны мешать routing workflow.
3. **Пользовательская терминология.** В UI использовать «Портовый модуль» /
   `Port Module`. Внутренние architecture/code symbols `PortBlock` этим UX
   этапом не переименовываются.
4. **Рабочий список портов объекта.** Natural ordering, компактные строки и
   отсутствие «Технических данных» в primary port list. Основные действия —
   компактные icon-actions с доступными labels/tooltips. Для подключённого
   порта доступен явный разрыв физического соединения с подтверждением.
5. **Lifecycle библиотеки портовых модулей.** Пользователь может удалить
   неиспользуемый Портовый модуль целиком вместе со всеми его versions, только
   если ни одна version не используется ни одной immutable Object Blueprint
   version. Если используется хотя бы одна version, destructive delete
   запрещён, а UI явно сообщает о зависимости; immutable history/provenance не
   разрушается. Archive, soft-delete, deprecated state и другой дополнительный
   lifecycle не вводятся без отдельной будущей необходимости.
6. **Context menus и Inspector.** Context menu — быстрые действия над
   объектом, портом, кабелем или пустым местом; Inspector — информация и
   подробный рабочий контекст; toolbar — глобальные режимы карты. В этот scope
   входят copy/apply object size и применение размера однотипным
   Blueprint-объектам на текущей карте.
7. **Понятные L1 errors.** Primary UI не показывает raw
   Malformed/HTTP/schema сообщения; техническая причина остаётся доступной как
   diagnostic detail.
8. **LOC-001.** После переработки Inspector и context menus завершить typed
   RU/EN localization активных поверхностей согласно
   [[plans/stabilization/10-02-stabilization-backlog|LOC-001]].

### UX.1 — Cable routing reliability

**IMPLEMENTED.** Route `PUT` acknowledgement and authoritative SavedMap read
are separate lifecycle stages. A failed route write may retry only the route;
after acknowledgement, a malformed/read/refresh failure retries only the
authoritative read/refresh and never repeats canonical cable creation or route
write. Primary cable-routing UI reports the stage in user-facing RU/EN text;
raw transport/parser diagnostics remain non-primary technical detail.

## Порядок и exit

Последовательность фиксирована:

```text
09.4 L1 Product UX completion
    -> L1S.7 Regions
    -> L1S.8 MapReference / hierarchical maps
    -> финальный L1 usability / acceptance
    -> обязательные до-L2 stabilization и performance пункты
    -> L2
```

Этот pass не расширяет L1 новыми speculative domain capabilities. L1 acceptance
подтверждает целостный пользовательский путь от Blueprint/Port Module через
object, ports, cabling и Saved Map до L1 trace. L2 начинается только после
acceptance и выполнения обязательных до-L2 пунктов stabilization/performance,
включая LOC-001.

### UX.2 — Persistent cable visibility

**IMPLEMENTED.** Physical Saved Map renders every collapsed canonical cable in a
foreground, viewport-aligned presentation layer independently of selection or
editing state. Normal cables remain thin; selection increases emphasis; route
editing and new-wiring drafts have the strongest emphasis. The foreground path
is non-interactive, so normal object and ConnectionPoint interaction continues
through it; only explicit route editing segments and waypoint handles receive
pointer input. Port/ConnectionPoint markers are repainted above foreground cable
paths, allowing route editing through an object body without hiding ports.

### UX.2a — Initial Blueprint placement sizing

**IMPLEMENTED.** New Blueprint-backed Saved Map placements choose the compact
preferred width of 96 through the existing Blueprint clamp, so dense port
layouts automatically receive their larger existing minimum. The selected
width participates in collision preflight and is persisted atomically as the
physical placement's explicit `display_width`; generic objects and historical
placements without that field retain their existing behavior.

### UX.2b — Cross-face internal continuity visibility

**IMPLEMENTED.** Physical Saved Map now renders every visible Blueprint
internal L1 link in an object-level continuity layer. With stacked FRONT and
REAR faces, REAR endpoints are offset by the FRONT-face height, so same-face
and cross-face canonical links use one exact, scalable coordinate system.
Continuity remains behind port markers and keeps normal, selected, trace, and
wiring-highlighted presentation states without introducing routing or
persistence.

### UX.2c — Object identification, selection & map search

**IMPLEMENTED.** Blueprint-backed objects render their display name in a
single-line, width-matched rectangular header directly attached to the
intrinsic body; the header uses a shared compact UI typography and ellipsizes
only when needed. Its full value is available through the native title tooltip.
Nameplate и body — единая визуальная card-composition и единая object hit-area:
обычный click по обоим выбирает тот же `PhysicalObject`; selected state охватывает
всю композицию. Port click сохраняет отдельную wiring interaction и не становится
object selection. Для selected Blueprint-backed объекта canvas показывает только
компактные стилизованные resize handles вместо технического React Flow default;
сохраняются Blueprint-only eligibility, aspect ratio, min/max и persistence
`MapViewPosition.display_width`. Числового ввода размера через Inspector в этот
pass не добавляется. Nameplate остаётся presentation-only: он не меняет canonical
topology, Blueprint, port/cable attachment, internal continuity или Saved Map
persistence model. Physical Saved Map также предоставляет
case-insensitive, map-local substring search over placed PhysicalObject display
names. A result selects the existing object selection; selection/search do not
move the viewport.

### UX.2d — Object port-list workflow completion

**IMPLEMENTED.** The primary PhysicalObject Ports table uses natural
numeric-aware ordering by the user-visible display label only; opaque slot keys,
UUIDs and other identity/provenance values do not decide presentation order.
Rows are compact and omit per-port technical data. Connect and disconnect are
accessible compact icon actions. An occupied cardinality-1 port has an explicit
confirmed disconnect action which deletes exactly its external canonical
relation. For a Cable-backed relation it atomically deletes Cable + Connection;
for a direct relation it deletes only Connection. It does not delete either
participating PhysicalObject or ConnectionPoint. After acknowledgement, the UI
only reloads authoritative details/projection; retry cannot repeat the
destructive write.

### UX.2e — Blueprint Port Module instance removal

**IMPLEMENTED.** В visual Blueprint composition editor выбранный instance
удаляется только из текущей editable composition. Перед сохранением из authoring
state удаляются все internal links, ссылающиеся на slots этого instance; другие
instances и их links сохраняются. Операция не удаляет `Port Module` из library
и не мутирует immutable `PortBlockVersion` или опубликованные
`ObjectBlueprintVersion`. Замена exact version остаётся явным workflow:
удалить старый instance, затем добавить instance нужной immutable version;
автоматический version-upgrade lifecycle не вводится.

## UX follow-up decisions после UX.2c

Следующие пункты зафиксированы как bounded future presentation work, а не как
уже реализованные части L1. Они сохраняют canonical topology как источник
истины; Saved Map placement/view остаётся map-local presentation state.

### UX.3 — Presentation controls для объекта (future)

- **Размер через Inspector.** Для выбранного Blueprint-backed объекта Inspector
  в будущем принимает числовой размер на текущей Saved Map. Это существующий
  `MapViewPosition.display_width`, не новый size contract: aspect ratio и
  derived height сохраняются. Применяются те же min/max, collision и
  persistence rules, что и при resize на canvas. Copy/apply size и
  apply-to-same-Blueprint остаются частью этого же направления.
- **Поворот.** Future bounded capability: placement/view можно повернуть только
  на 0/90/180/270 градусов; основной UX-кандидат — context menu объекта.
  Rotation принадлежит конкретному Saved Map placement/view и является
  presentation-only: она не меняет Blueprint, identity `PhysicalObject` или
  canonical topology. Поворачиваются body, rendered ports, internal
  continuity, external cable attachment geometry и фактический collision
  footprint. `display_width` сохраняет семантику intrinsic/unrotated body
  width; при 90/270 меняется ориентация экранного footprint. Nameplate не
  вращается, остаётся горизонтальным сверху относительно экрана и получает
  ширину по экранной ширине повёрнутого объекта.

### UX.4 — Multi-selection (future bounded interaction)

Обычный click сохраняет текущий single-selection behavior. `Shift+click`
добавляет или убирает `PhysicalObject` из текущего selection. Rectangle/lasso
selection пока не входит в scope. Selection — UI/presentation state, не
topology; это foundation для безопасных batch presentation actions, включая
size, rotation и group movement. Точная модель Inspector для multi-selection
остаётся OPEN.

### UX.5 — «Кабельный жгут» / Cable Bundle (future idea)

Map-local Cable Bundle — presentation-only visual grouping нескольких
независимых canonical Cable, не физическая сущность и не topology object.
Кабели сходятся визуальной «расчёской» в общий trunk и расходятся обратно;
редактирование общего trunk не требует ручного редактирования route каждого
кабеля, но выбор конкретного Cable всё равно выделяет именно его путь через
bundle. Bundle не создаёт connectivity между кабелями; canonical cables,
endpoints, identity и trace остаются независимыми. RU product term —
«Кабельный жгут», EN — `Cable Bundle`. Материальная inventory-модель Cable,
размеры, vendor/construction и подобные свойства не моделируются. Exact
persistence/API shape
остаётся OPEN.

### UX.6 — Global map presentation settings (future settings milestone)

Будущая Settings surface может задавать общие чисто визуальные map
preferences, например единую typography для object nameplates, font family,
font size и другие подобные настройки. Это не свойства `PhysicalObject` или
Blueprint; точная persistence/user/workspace model сейчас не проектируется.
До отдельного settings milestone единый nameplate font остаётся hard-coded
product default.

## Наблюдения для будущего L1 Product UX work

Следующие наблюдения зафиксированы для будущей UX-работы и не являются
implementation specification или расширением текущего scope.

- **Object Blueprint catalog/list compaction.** Текущая таблица каталога
  перегружена по ширине. «Состав портов» / port composition следует разложить
  на отдельные компактные числовые колонки как минимум для количества точек
  подключения и количества сетевых портов; в ячейках показываются только
  количества, без длинных текстовых префиксов. «Действия» следует упростить до
  компактных icon-actions с понятностью через tooltip и accessible labels.
  Цель — уменьшить горизонтальную перегрузку и сделать строки компактнее.

- **Port Module version selection in Blueprint authoring.** Immutable версии
  `Port Module` / `Port Block` сохраняются и остаются частью исторической
  provenance. Однако в обычном authoring flow устаревшие версии не должны
  предлагаться пользователю как равноправные default options: стандартный
  add-to-Blueprint flow должен ориентироваться на latest/current published
  version. Это упрощение product UX, а не отмена immutable version history;
  advanced legacy-version workflow пока не вводится.
