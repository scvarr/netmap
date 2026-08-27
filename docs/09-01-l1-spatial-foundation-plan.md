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

**IMPLEMENTED**

#### L1S.5a — Blueprint endpoint-group spatial placement

**IMPLEMENTED**

- Authoring recipe stores each endpoint group's normalized `placement_offset` and
  `placement_span`; explicit canonical `BlueprintSlot.anchor.side + offset`
  remains unchanged.
- Generated group slots are deterministic within that range; a one-port group
  is centered.
- The Blueprint editor exposes compact range start/span controls and validates
  that a positive range stays within `0..1`.

#### L1S.5b — Stable slot identity and key UX cleanup

**IMPLEMENTED**

- Canonical key generated slot is `stable_group_key:ordinal`; stable group key
  is an opaque persisted authoring value and ordinal is 1-based without padding.
- Display prefix, visible starting number, side, placement and kind no longer
  participate in canonical slot identity; growing a group appends ordinals.
- Primary editor does not expose internal stable keys and shows visible port
  labels in group summaries.
- New groups use one browser-generated UUID for both persisted group id and
  opaque stable key; hydration retains both values.

#### L1S.5c — Arbitrary individual Blueprint internal mappings

**IMPLEMENTED**

- Authoring recipe stores `individual_links` as explicit stable generated slot
  key pairs, separate from bulk `pair_recipes`.
- The explicit Blueprint snapshot is the validated union of pair-by-index and
  individual links; self-links, missing slots and unordered duplicates are
  rejected, including a manual link duplicating a bulk rule.
- The editor shows locale-appropriate human-facing port labels, preserves
  mappings across presentation edits, blocks save if a reduced group removes a
  referenced ordinal, and removes affected mappings only when its entire group
  is deleted.

#### L1S.5d — Blueprint authoring polish and completion

**IMPLEMENTED**

- Новый редактор начинается без групп и портов; группы, bulk-пары и
  индивидуальные связи добавляются только по явному действию.
- Empty state и локальная валидация не показывают ошибку до первой попытки
  сохранить; invalid authoring не выполняет write.
- Pair-by-index локально требует две разные группы, а удаление последней группы
  возвращает все authoring collections к пустому состоянию.

### RU/EN frontend localization foundation

**IMPLEMENTED**

- Russian (`ru`) is the default locale and English (`en`) is supported.
- Locale switches at runtime without a reload, persists in `localStorage`, and
  updates `<html lang>`.
- A typed, source-level localization boundary owns human-facing UI strings.
- The typed boundary covers Map toolbar/dialog strings and the Blueprint /
  Port Block editor surfaces. Coverage is incomplete on older Catalog/Object
  detail components and parts of Quick Inspector, which still contain
  source-level RU literals; closing this gap is tracked as LOC-001 in
  [[10-02-stabilization-backlog|10.2 Stabilization backlog]]. The blanket
  surface-coverage claim returns only after LOC-001.
- Canonical values, API payloads, and user/backend data remain locale-neutral.

The next bounded product step is `L1S.6c.6 — rendered-port vs external-cable-attachment geometry`
(L1S.6a/L1S.6b/L1S.6c.3–L1S.6c.5 are implemented; see below).

### L1S.6 — Controlled Blueprint instance upgrade

#### L1S.6a — Blueprint instance upgrade visibility and dry-run compatibility analysis

**IMPLEMENTED**

- Object Detail reads the existing authoritative latest-Blueprint listing to show
  an outdated instance before a dry-run. Current Blueprint instances stay
  uncluttered and offer no compatibility action.
- Read-only `GET /v1/topology/physical-objects/{id}/blueprint-upgrade-analysis`
  is invoked only by the explicit dry-run action and compares immutable snapshots
  with canonical instance and internal-link evidence.
- `OUTDATED` analysis identifies matching slots solely by stable `slot_key` plus
  unchanged kind. Added slots/internal links and body/anchor/presentation changes
  are compatible; removed slots, kind changes, removed internal links and any
  inconsistent instance mapping (including missing/wrong NetworkInterface owner)
  are explicit blockers. An added internal link already proven by its exact
  canonical `Connection`/`ConnectionMember` is already satisfied; ambiguous or
  conflicting canonical evidence is a blocker. Recipe data is provenance, never
  runtime-topology evidence. The dry-run performs no writes.
- Object Detail shows only Blueprint-instance visibility, then performs analysis
  only on the user’s explicit action. Results are localized at the typed RU/EN UI
  boundary; API codes remain locale-neutral. There is deliberately no Apply action.

#### L1S.6b — Explicit transactional apply

**IMPLEMENTED**

- `POST /v1/topology/physical-objects/{id}/blueprint-upgrade` requires the exact
  reviewed target-version UUID, locks the instance, reruns compatibility analysis
  and rejects stale, blocked or wrong-target requests with a conflict.
- The one transaction preserves the `PhysicalObject`, same-key/same-kind
  `ConnectionPoint` and `NETWORK_PORT` `NetworkInterface` identities, remaps
  provenance to target slot rows, and seeds metadata only for newly materialized
  entities.
- Additive connection-point/network-port structures and only exact internal links
  newly introduced by the target snapshot are materialized atomically; satisfied
  new links are not duplicated and conflicting evidence aborts the whole upgrade.
  Unchanged Blueprint links remain provenance and are not reconciled against
  runtime topology.
- Object Detail exposes Apply only following a blocker-free dry-run. A failed
  post-write refresh is retryable as a read only and never resends the write.

- Показывать instances на старой version и выполнять dry-run compatibility analysis.
- Показывать compatible changes и blockers.
- Сохранять identity `PhysicalObject` и, где возможно, совпадающих generated slots.
- Безопасно materialize additive compatible changes.
- Не применять silently destructive изменения connected/bound slots.
- Делать explicit apply только после устранения blockers; upgrade не является
  delete/recreate `PhysicalObject`.

### L1S.6c — Port Block Blueprint composition and multi-face physical presentation

**ARCHITECTURE AGREED / SUBDIVIDED IMPLEMENTATION**

The architecture is fixed in
[[09-03-port-block-blueprint-architecture|09.3 Port Block Blueprint composition
and multi-face physical presentation]]. It is implemented as the following
deliberately bounded milestones:

1. **L1S.6c.1 — Port Block library foundation — IMPLEMENTED**: library-owned
   Port Blocks,
   immutable exact versions, explicit local-port layout snapshots, migrations,
   machine-readable library API and backend tests. It does not reference Object
   Blueprints or alter canonical topology.
2. **L1S.6c.2 — Port Block authoring and numbering — IMPLEMENTED**: Russian-default
   library UI generates the existing exact immutable snapshot for one/two rows,
   the bounded numbering schemes, prefix, direction, kind and label overrides.
   Opaque local IDs are client-generated separately from presentation and are
   preserved while authoring a version; successful writes refresh library data.
3. **L1S.6c.3 — Object Blueprint composition and legacy EndpointGroup removal — IMPLEMENTED**.
   Object Blueprint versions compose exact immutable `PortBlockVersion` records;
   each block instance has an opaque stable `instance_key`, and each final slot
   identity derives only from that key plus the stable Port Block `local_id`.
   The server expands exact ports and validates explicit internal links, while
   immutable historical snapshot-only versions remain readable and instantiable.
   The active EndpointGroup/`placement_offset`/`placement_span` authoring
   contract was removed destructively. L1S.6 upgrades continue to compare exact
   slot/internal-link snapshots, preserving canonical identity for additive
   versions that retain an instance key and local IDs.
4. **L1S.6c.4 — `FRONT`/`REAR` physical presentation — IMPLEMENTED**: exact Port Block instances persist a face within the complete immutable Blueprint version; historical NULL provenance reads as FRONT. Runtime renders one PhysicalObject and transiently selects a face, while preserving all slots for topology/cable logic. L1S.6c.6 remains the separate external cable-attachment geometry boundary.
5. **L1S.6c.5 — visual Blueprint composition editor — IMPLEMENTED**: every new
   exact Port Block instance stores an immutable face-local normalized `x`,
   `y`, `width`, `height` rectangle. It is presentation provenance only and
   independent from instance/slot identity, canonical topology and upgrades.
   Historical NULL placement remains readable with deterministic editor-only
   fallback; saving a new version writes explicit placement. The SVG editor has
   independent FRONT/REAR surfaces, drag/resize, snapshot port grids and
   same-face internal-link visibility.
6. **L1S.6c.6 — rendered-port vs external-cable-attachment geometry**.

This work is not otherwise complete. Every slice must preserve L1S.6 canonical identity,
provenance, upgrade, and runtime-topology invariants; it does not add a
`MapViewKey` or a new Saved Map membership model.

This is a pre-production project. L1S.6c.3 has destructively removed the active
legacy `EndpointGroup`, `placement_offset`, and `placement_span` authoring
contract. No compatibility parser, dual recipe format, or migration machinery
exists solely to preserve development Blueprint authoring data. This exception
does not relax canonical topology, immutable Blueprint snapshot, Saved Map,
provenance, or L1S.6 upgrade invariants.

### Later separate bounded milestone — dense cable-editing visibility

**FUTURE / NOT PART OF L1S.6c**

While routing a selected cable, it should remain visible; objects that obstruct
the editing context may become translucent. This is deliberately separate from
Port Block Blueprint composition so dense-device authoring does not absorb cable
editing visibility work.

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
