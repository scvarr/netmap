# 09.1 План завершения L1 spatial foundation

## Статус и граница

Короткий рабочий completion plan для оставшегося L1 presentation foundation.
Он не меняет canonical L1 model, не фиксирует таблицы, API endpoints, DTO или
persistence schema. Product invariants — в [[05-presentation|05. Представление]],
история review и уже выполненные remediation — в
[[09-ui-ux-review|09. Рабочем L1 UI/UX review]].

## Порядок выполнения

### L1S.1 — Canvas control

- Убрать selection-driven viewport movement.
- Selection не делает pan/center/fit.
- Initial scene fit остаётся допустимым.
- Explicit user fit/navigation остаётся допустимым.

### L1S.2 — Stable placement

- Per-view placement lock.
- Locked objects не draggable.
- Collision-free final drag и insertion.
- Nearest-free placement около занятого insertion anchor.

### L1S.3 — Internal continuity

- Расширить L1 projection ровно настолько, чтобы renderer получил canonical
  internal `Connection`/`ConnectionMember` evidence.
- Показывать тонкие internal links внутри объекта при известной endpoint geometry.
- Поддержать selection/trace/wiring highlight.
- Показывать branched continuity без invented preferred path.

### L1S.4a — Cable route presentation contract

- Persisted SavedMap Physical/L1 route geometry и ordered waypoints.
- Определить read/write boundary.
- Сохранить независимость route geometry от canonical topology.

### L1S.4b — Existing cable route rendering/editing

- Exact port anchors, где они известны.
- Отображение сохранённой трассы.
- Добавление, перемещение и удаление waypoint.
- Выпрямление/reset route без topology mutations.

### L1S.4c — Visual port-to-port wiring

- Выбрать source port, проложить zero or more waypoints и выбрать destination port.
- Подсвечивать proven internal passive continuity.
- Создать canonical cable ровно один раз и отдельно сохранить presentation route.
- Retry persistence route не повторяет canonical write.

### L1S.5 — Blueprint authoring completion

- Более точное размещение endpoint groups: position/offset/span или эквивалент.
- Визуально различимые несколько groups на одной стороне.
- Скрыть или генерировать stable keys в primary UX там, где это безопасно.
- Inspect/edit individual arbitrary internal mappings.
- Pair-by-index остаётся bulk generator, но не единственной моделью.

### L1S.6 — Controlled Blueprint instance upgrade

- Показывать instances на старой version и выполнять dry-run compatibility analysis.
- Показывать compatible changes и blockers.
- Сохранять identity `PhysicalObject` и, где возможно, совпадающих generated slots.
- Безопасно materialize additive compatible changes.
- Не применять silently destructive изменения connected/bound slots.
- Делать explicit apply только после устранения blockers; upgrade не является
  delete/recreate `PhysicalObject`.

### L1S.7 — Regions / areas

- Presentation-only spatial regions без topology semantics.

### L1S.8 — MapReference / hierarchical maps

- Presentation object со ссылкой на другую Saved Map.
- Navigation hierarchy без implied connectivity.

### L1S.9 — L1 acceptance

- Выполнить ручной end-to-end проход: template -> object -> ports -> cabling ->
  maps -> cable routing -> internal continuity -> trace.
- Синхронизировать документацию.
- После acceptance перевести основной product/UI track на L2.

## Что не является gate для L2

Следующие вещи не блокируют начало L2 до появления конкретного use case:

- `PointMember`/`member_index` UI refinement;
- полный optical/fiber-member UX;
- ducts/bundles;
- вычисление физической длины кабеля;
- другие speculative L1 extensions.

Принцип «довести L1 foundation» не должен превращаться в бесконечную L1-разработку.
