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

### UX.2c — Object identification & map search

**IMPLEMENTED.** Blueprint-backed objects render their display name in a
single-line, width-matched rectangular header directly attached to the
intrinsic body; the header uses a shared compact UI typography and ellipsizes
only when needed. Its full value is available through the native title tooltip.
The nameplate is presentation-only:
it does not change body dimensions, footprint, port/cable attachment, internal
continuity, or Saved Map persistence. Physical Saved Map also provides a
case-insensitive, map-local substring search over placed PhysicalObject display
names. A result selects the existing object selection; selection/search do not
move the viewport.
