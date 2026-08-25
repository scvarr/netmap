# 09.1 План завершения L1 spatial foundation

## Статус и граница

Короткий рабочий completion plan для оставшегося L1 presentation foundation.
Он не меняет canonical L1 model, не фиксирует таблицы, API endpoints, DTO или
persistence schema. Product invariants — в [[05-presentation|05. Представление]],
история review и уже выполненные remediation — в
[[09-ui-ux-review|09. Рабочем L1 UI/UX review]].

## Порядок выполнения

### L1S.1 — Canvas control

**IMPLEMENTED**

Selection-driven viewport movement removed. Selection changes (including URL
focus and trace highlighting) update presentation state only and never pan,
center or fit the viewport. One initial fit remains allowed for each new scene;
explicit user layout/navigation actions may still change it.

### L1S.2 — Stable placement

**IMPLEMENTED**

#### L1S.2a — per-view placement lock

**IMPLEMENTED**

`MapViewPosition` хранит presentation-only состояние `locked` независимо для
каждого SavedMap placement и view. Зафиксированный node остаётся selectable и
visible, но его нельзя перетащить; смена lock не перемещает node и не
пересобирает scene.

#### L1S.2b — collision-safe placement

**IMPLEMENTED для final drag**

Final drag проверяет presentation footprint размещённых nodes в flow
coordinates. Overlap локально отклоняется без write, а node возвращается к
последней подтверждённой позиции.

#### L1S.2c — collision-safe insertion

**IMPLEMENTED**

- Collision-safe insertion для toolbar, context menu, Object Detail и off-map
  continuation.
- Deterministic nearest-free placement около занятого requested anchor.
- Footprint кандидата берётся только из bounded `PhysicalObject` projection:
  blueprint body или generic layout fallback, без guessed Catalog dimensions.

### L1S.3 — Internal continuity

**IMPLEMENTED**

#### L1S.3a — canonical internal continuity projection

**IMPLEMENTED**

- L1 `PHYSICAL_OBJECT` projection exposes canonical same-object
  `Connection`/`ConnectionMember` evidence in `attributes.internal_l1_links`.

#### L1S.3b — internal continuity presentation

**IMPLEMENTED**

- Blueprint `PhysicalObject` rendering draws each geometry-proven canonical
  internal member as an undirected SVG segment between its exact slot anchors.
- Selection emphasizes every rendered internal segment. Trace emphasizes only
  the segment whose `ConnectionMember` is in the selected branch evidence.
- The same exact-member presentation mechanism is reusable by L1S.4c for a
  wiring-time highlight once wiring interaction state exists; it does not add
  that state now.

### L1S.4a — Cable route presentation contract

**IMPLEMENTED**

- `SavedMap` Physical/L1 presentation route persistence uses canonical cable
  identity, ordered flow-coordinate waypoints and an explicit view key.
- `cable_routes` is returned by the authoritative SavedMap document; no route
  row is distinct from a persisted route with `waypoints=[]`.
- Full-replacement PUT and reset/delete are independent from `MapPlacement` and
  canonical topology.

### L1S.4b — Existing cable route rendering/editing

**IMPLEMENTED**

#### L1S.4b.1 — Authoritative SavedMap route rendering

**IMPLEMENTED**

- Physical collapsed-cable rendering overlays the active SavedMap route after
  topology-derived layout, matching the canonical cable identity exactly.
- Known port anchors remain exact; ordered persisted flow-coordinate waypoints
  are rendered literally. Moving a node changes only its endpoint segment.
- No-route floating/straight fallback is preserved, while an explicit empty
  route remains distinguishable in presentation data.

#### L1S.4b.2 — Waypoint editing and reset

**IMPLEMENTED**

- Edit existing route directly on its segments: visible draggable waypoint
  handles and exact segment insertion preserve ordered draft state, including an
  explicit zero-waypoint route; arbitrary pane clicks do not place waypoints.
- Save performs one full-list PUT; drag performs no writes. Reset deletes only
  the custom record and has a refresh-only retry lifecycle.
- Draft state is local to the exact map/cable and is invalidated on map, view or
  cable selection changes.

**L1S.4b — IMPLEMENTED**

### L1S.4c — Visual port-to-port wiring

**OPEN**

#### L1S.4c.1 — canonical direct wiring baseline

**IMPLEMENTED**

- Direct exact-port source/destination selection through the existing canonical
  `PhysicalEndpointConnection` write boundary.
- Authoritative free cardinality=1 port semantics, confirmation before write,
  and exactly-once creation with refresh-only retry.
- Source/target selection uses a non-modal canvas control panel; modal
  confirmation appears only after both endpoints have been selected.

#### L1S.4c.2 — route-aware wiring

**IMPLEMENTED**

- Route draft during visual wiring, including an explicit zero-waypoint route.
- Route persistence uses the exact returned `cable_ref`; canonical creation is
  exactly-once, route persistence retries do not repeat it, and refresh retries
  do not repeat either write.
- The wiring source highlights only proven canonical same-object
  `internal_l1_links`, including every exact branch.

- Выбрать source port, проложить zero or more waypoints и выбрать destination port.
- Подсвечивать proven internal passive continuity.
- Создать canonical cable ровно один раз и отдельно сохранить presentation route.
- Retry persistence route не повторяет canonical write.

**L1S.4c — IMPLEMENTED**

**L1S.4 — IMPLEMENTED**: route persistence contract, existing route
rendering/editing, visual direct wiring and route-aware create lifecycle are
complete. L1S.5 is not included in this slice.

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
