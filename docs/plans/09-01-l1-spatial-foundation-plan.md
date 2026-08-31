# 09.1 План завершения L1 spatial foundation

## Статус и граница

Короткий рабочий completion plan для оставшегося L1 presentation foundation.
Он не меняет canonical L1 model, не фиксирует таблицы, API endpoints, DTO или
persistence schema. Product invariants — в [[architecture/presentation/05-presentation|05. Представление]],
история review и уже выполненные remediation — в
[[reviews/09-ui-ux-review|09. Рабочем L1 UI/UX review]].

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
  [[plans/stabilization/10-02-stabilization-backlog|10.2 Stabilization backlog]]. The blanket
  surface-coverage claim returns only after LOC-001.
- Canonical values, API payloads, and user/backend data remain locale-neutral.

L1S.6c.6 — rendered-port vs external-cable-attachment geometry is implemented.

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
[[architecture/blueprints/09-03-port-block-blueprint-architecture|09.3 Port Block Blueprint composition
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
4. **L1S.6c.4 — `FRONT`/`REAR` physical presentation — IMPLEMENTED**: exact Port Block instances persist a face within the complete immutable Blueprint version; historical NULL provenance reads as FRONT. Runtime preserves all slots for topology/cable logic. L1S.6c.6 remains the separate external cable-attachment geometry boundary.
5. **L1S.6c.5 — visual Blueprint composition editor — IMPLEMENTED**: every new
   exact Port Block instance stores an immutable face-local normalized `x`,
   `y`, `width`, `height` rectangle. It is presentation provenance only and
   independent from instance/slot identity, canonical topology and upgrades.
   Historical NULL placement remains readable with deterministic editor-only
   fallback; saving a new version writes explicit placement. The SVG editor has
   independent FRONT/REAR surfaces, drag/resize, snapshot port grids and
   same-face internal-link visibility.
6. **L1S.6c.5a — intrinsic Blueprint geometry and per-map L1 display size — IMPLEMENTED**: immutable Blueprint body `width`/`height` are dimensionless design geometry that define only the body aspect ratio; their absolute values are never map dimensions. Normalized Port Block composition remains intrinsic to that body with unchanged provenance and identity. Optional positive `MapViewPosition.display_width` owns one Saved Map physical-view body width; historical NULL rows use a deterministic presentation default. Runtime derives height from that aspect ratio and persists locked-aspect resize through the position write path. Slot anchors, topology, cable semantics and runtime Port Block rectangles are unchanged.
7. **L1S.6c.5b — simultaneous FRONT/REAR physical presentation — IMPLEMENTED**: the Saved Map runtime renders the actual visible Blueprint faces simultaneously as compact body surfaces inside one React Flow node. There remains exactly one canonical `PhysicalObject`, `MapPlacement`, `MapViewPosition` and `display_width`; both faces move and resize together. Visible faces derive from actual slot presentation (historical missing face is FRONT); Blueprint-editor tabs remain authoring convenience only. Runtime has neither a FRONT/REAR selector nor face captions: one face is one body rectangle, while FRONT plus REAR are directly joined rectangles with FRONT above REAR, one shared divider, and one centered scalable object label. Shared runtime footprint/layout/collision geometry is exactly one intrinsic-aspect face height per visible face, with no header, label, or inter-face gap. Same-face internal continuity remains drawn within its face; cross-face continuity stays canonical and highlightable but has no misleading line. Port Block container rectangles remain editor-only.
8. **L1S.6c.6 — rendered-port vs external-cable-attachment geometry — IMPLEMENTED**: rendered ports derive from immutable PortBlock layout plus instance placement; external cable attachment derives separately with deterministic fan-out on the complete object's outer boundary. The shared FRONT/REAR divider is never an external boundary. Neither geometry affects canonical identity/topology, upgrades, Saved Map membership or routes; obsolete `BlueprintEndpointSlot.anchor` is removed.

This work is not otherwise complete. Every slice must preserve L1S.6 canonical identity,
provenance, upgrade, and runtime-topology invariants; it does not add a
`MapViewKey` or a new Saved Map membership model.

This is a pre-production project. L1S.6c.3 has destructively removed the active
legacy `EndpointGroup`, `placement_offset`, and `placement_span` authoring
contract. No compatibility parser, dual recipe format, or migration machinery
exists solely to preserve development Blueprint authoring data. This exception
does not relax canonical topology, immutable Blueprint snapshot, Saved Map,
provenance, or L1S.6 upgrade invariants.

### L1 Product UX completion context

The separate [[plans/09-04-l1-product-ux-completion|09.4 L1 Product UX completion]]
pass owns reliability and usability work around cable routing, port/module
workflows, Inspector/context menus, error presentation and LOC-001. Its work is
separate from Port Block Blueprint composition and must not be silently treated as
completed merely because Region work has started.

### L1S.7 — Regions / areas

**IMPLEMENTED for the current Region authoring family**

The current `main` branch includes the SavedMap-owned Region model,
persistence/API, rendering, isolated Region mode, draft creation, geometry
editor, assisted geometry, laminar hierarchy, existing Region edit,
properties/style/label drag/delete, arbitrary text annotations and the
consolidated presentation authoring panel. Region hierarchy derives only from
geometry; it does not create Location, object membership or topology semantics.
Global cross-app visual unification remains a separate future UI-polish task.

The focused contract for the four spatial/presentation concepts is
[[architecture/presentation/09-spatial-location-mapreference-contract|Spatial contract: Location, Region, SavedMap и MapReference]].

#### L1S.7a — Saved Map Region model / persistence / API contract

**IMPLEMENTED**

- `MapRegion` is a SavedMap-owned, Physical/L1-only presentation polygon with stable
  UUID identity, non-unique label, optional explicit label position, bounded visual
  style and region-layer z-order.
- The authoritative Saved Map includes `regions[]`; bounded create/replace/delete
  endpoints are independent of MapPlacement and canonical topology. Simple polygon
  validation rejects invalid vertices and self-intersection; Saved Map deletion cascades
  Regions.
- L1S.7a provided the typed Saved Map parsing and bounded Region transport;
  rendering and authoring are implemented by the L1S.7b slices below.

#### L1S.7b — Region drawing and editing UI

**IMPLEMENTED for the listed capabilities**

##### L1S.7b.1 — Region rendering + isolated Region mode

**IMPLEMENTED**

- Persisted Physical Saved Map Regions render as a non-interactive presentation layer
  behind topology objects, ordered by `z_order`, with persisted style and label position.
- The frontend-only `Области` mode clears/suppresses topology interaction, hides cables,
  and defaults to real current object-bound reference outlines with a bounded hide option.

##### L1S.7b.2 — Region polygon draft drawing

**IMPLEMENTED**

- `Области` mode provides an explicit `Новая область` session-local flow-coordinate polygon
  draft. Canvas clicks add vertices; draft points, segments, pointer preview and prospective
  closure remain visibly distinct from persisted `regions[]`.
- `Готово`/`Enter` is available only after three vertices and leaves a completed, explicitly
  unsaved local draft. `Отмена`/`Escape`, map change, leaving Physical view, or leaving Region
  mode discards it. This step performs no Region API write and creates no synthetic `MapRegion`
  identity.

##### L1S.7b.3a — Region draft Shift screen-axis constraint

**IMPLEMENTED**

- While drawing a session-local Region draft, Shift constrains only the current segment endpoint
  to its dominant horizontal or vertical screen-space axis. The constrained screen point is
  converted back to the flow-coordinate draft point, so preview and click agree under pan and
  zoom. Persistence and Region editing are covered by the implemented slices below.

##### L1S.7b.3b — create Region from completed draft

**IMPLEMENTED**

- A completed draft has a bounded label / save / cancel form. Its trimmed non-empty label,
  exact flow-coordinate points, `null` label position, one centralized default presentation
  style, and next Region-layer order are posted through the Saved Map Region create route.
- A successful write is acknowledgement only: the UI reloads the authoritative Saved Map and
  never synthesizes a local Region. A failed write keeps the draft for an explicit save retry;
  an acknowledged write followed by failed refresh offers a refresh-only retry and never repeats
  the POST.

- **L1S.7b.4a — Region spatial relation contract — IMPLEMENTED**: every Saved Map Region
  set is a geometry-derived, never-persisted laminar presentation hierarchy. Regions are
  disjoint or strictly nested; touching, coincident boundaries and partial overlap are rejected
  authoritatively on create/replace. This does not create Location, object-membership, or
  topology semantics.
- **L1S.7b.4b — Region hierarchy tree + selection — IMPLEMENTED**: Physical `Области` mode
  derives a deterministic arbitrary-depth tree only from authoritative `regions[]`, using strict
  geometry containment and never storing or returning a parent field. It has session-only row
  selection and a separate persisted-polygon presentation highlight; selection resets on the
  bounded scene lifecycle and never mutates Region data.
- **L1S.7b.4c — Region draft geometry editor — IMPLEMENTED**: after closing a new local draft,
  compact real vertex and transient midpoint handles support vertex move/insert/delete and whole
  polygon translation in flow coordinates. A pure exact simple-polygon validator keeps invalid
  intermediate geometry editable but blocks save. Persisted Regions remain a passive reference layer;
  create continues to post only the current draft points and reloads authoritative state.
- **L1S.7b.4d — Region assisted geometry — IMPLEMENTED**: new local draft drawing and vertex
  dragging provide transient angle/flow-coordinate length feedback plus magnetic 10° and 10-unit
  assistance. Capture is screen-space, Ctrl bypasses automatic magnets, and Shift keeps its explicit
  screen-axis constraint. This is edit-time presentation only: it creates neither persisted dimensions
  nor CAD/physical-length semantics. Polygon translation remains rigid and unsnapped.
- **L1S.7b.4e — existing Region geometry edit + replace lifecycle — IMPLEMENTED**: explicit
  `Редактировать` starts a local clone of the selected authoritative geometry and reuses the
  vertex/midpoint/delete/rigid-translation editor and its assisted geometry. Persisted Regions stay
  passive; the active target is suppressed beneath the local overlay. A single `replaceRegion` PUT
  carries edited points and preserved label/style/z-order; vertex-only edits preserve explicit
  `label_position`, while rigid translation moves it by the same delta. PUT acknowledgement reloads
  the authoritative Saved Map; failed PUT keeps the editable local geometry, including a localized
  spatial-conflict error, while failed post-acknowledgement refresh retries only that refresh.
- **L1S.7b.4f — Region presentation / properties — IMPLEMENTED**: selected Region has separate
  geometry, properties and deletion actions. Properties are a local-only preview draft for trimmed
  non-unique name, bounded style, automatic label-color fallback and label position; tree selection
  is locked and geometry stays passive. Only the label drags freely in flow coordinates without
  assist/snap; reset makes `label_position` `null`. One PUT preserves points and `z_order`, followed
  by authoritative refresh with refresh-only retry after acknowledgement. A separately confirmed
  DELETE removes only the selected Region and likewise retries only refresh after acknowledgement;
  nested Regions stay intact and hierarchy remains derived.
- **L1S.7b.4g — Map text annotations — IMPLEMENTED**: a text annotation is separate
  SavedMap-owned Physical/L1 presentation content, not `Region.label`. It has stable UUID,
  trimmed non-empty multiline text, free map position, text color and font size; no Region,
  Location, object or topology association. The UI supports click placement, local preview,
  free drag, complete replace and confirmed deletion through the authoritative-reload lifecycle.
  Rich text, callouts, backgrounds, rotation, z-order and generic scene-object work remain out
  of scope. Location association and `MapReference` are separate capability families below.

### Location foundation

**OPEN bounded L1 foundation**

Location remains a separate OPEN capability family. Its current semantic
contract is [[architecture/presentation/09-spatial-location-mapreference-contract|defined here]]:
canonical physical place, arbitrary depth, independent of SavedMap, with no
fundamental Site/Building/Floor/Room/Rack/RackUnit backend types. No Location
implementation is started by this plan update. Any future Region association
is presentation assistance only and cannot make geometry a source of canonical
membership or movement.

### L1S.8 — MapReference / composed SavedMaps

**OPEN future L1 capability; not canonical hierarchy**

`MapReference` is the presentation composition of one SavedMap inside another:
the target is shown as a collapsed/composite object, with drill-down as part of
the same concept. Internal target objects and connections are hidden on the
parent map; external connections are derived from canonical topology and target
SavedMap membership. The external representation creates no new
`Connection`, `PhysicalObject` or topology facts, and does not prove Location or
physical containment. Exact external-port derivation, API and schema remain
OPEN; no implementation plan is introduced here and no separate simple
hyperlink object is defined. See the [[architecture/presentation/09-spatial-location-mapreference-contract|focused spatial contract]].

### Cable.3 — minimal Cable metadata foundation

**OPEN future bounded capability**

Planned minimal descriptive Cable metadata is optional `label`, optional
`transport_category`, and optional `capacity_class`. Candidate transport
categories include `ETHERNET`, `FIBRE_CHANNEL`, `OTHER`, and
`UNSPECIFIED/null`; the enum name and null semantics are implementation-time
decisions. `capacity_class` may use values such as `1G`, `10G`, `25G`, `40G`,
`100G`, `8GFC`, `16GFC`, `32GFC`, and `64GFC`.

This is not a physical material/inventory model. Do not add Cat5e/Cat6/Cat6A,
OM3/OM4/OS2, DAC/AOC, manufacturer, part number, connector inventory, length,
stock state, or splice/member decomposition in this milestone. Rated/nominal
Cable capacity is distinct from interface capability, configured rate,
negotiated operational rate, and observed throughput. Future resolvers must not
interpret Cable metadata as operational state.

### MapCableRoute usability / assisted geometry

**OPEN bounded remaining L1 capability family**

- **ROUTE-001:** overlap-safe trace visualization; exact traced topology has
  visual priority and neighboring coincident/partially coincident routes remain
  distinguishable using presentation-only z-order, halo, outline, or slight
  parallel offset.
- **ROUTE-002:** compact waypoint handles; full handles appear only in explicit
  route edit mode, which is distinct from selection, with small visual radius and
  a potentially larger hitbox.
- **ROUTE-003:** straight-segment authoring with live previous-waypoint → pointer
  preview and ordinary polyline confirmation.
- **ROUTE-004:** initial angular snapping candidate is 10°. Configurable presets
  such as 5°, 10°, 15°, 30°, 45°, and 90° are future scope and are not promised
  by the first milestone.
- **ROUTE-005:** draw/edit feedback shows preview, snapped direction, angle, and
  a subtle snap indicator.
- **ROUTE-006:** future presentation-only magnets may target ConnectionPoints,
  waypoints, segments, H/V axes, an angular grid, and later object edges or
  anchors. None infer topology.

NetMap is a schematic infrastructure editor, not CAD: dimensions, precision
coordinate forms, generic constraints, Bézier/boolean geometry, engineering
drawing standards, and sub-degree precision are out of scope.

### Mandatory stabilization/performance gate

The stabilization backlog remains the canonical backlog. L1 COMPLETE is blocked
by backlog items explicitly marked `До L2: ДА`, plus any new issue explicitly
promoted to an L1 acceptance blocker; items marked `До L2: НЕТ` do not block it
automatically. Thus bounded reads, object details/inventory, projection/N+1 SQL,
repeated object-level trace work, and still-relevant frontend computational
hotspots remain mandatory L1 readiness work when so classified. Real-world
acceptance may identify a new concrete blocker, but does not silently promote
the entire backlog. The measured baseline around 500 objects / 4,000 ports
already showed seconds-level endpoints and thousands of SQL queries.

### Real-world L1 acceptance

This is a final acceptance stage, not another feature milestone. On a real
infrastructure fragment, verify:

```text
Blueprint / Port Module
    → PhysicalObject
    → ConnectionPoints
    → Connections + Cable
    → SavedMaps
    → Regions / Locations
    → Cable Routes
    → internal continuity
    → L1 trace
```

Candidate scope is one server room or dense rack with a switch, patch panel,
several servers, Ethernet, preferably one Fibre Channel path, and several
SavedMaps/Regions. During this acceptance, assess the pain of manually creating
100–500 objects. Import is not a precondition: add only a bounded CSV/JSON
bootstrap importer if manual setup is demonstrated to be a blocking usability
problem. SNMP, LLDP, CMDB sync, and a generic integrations framework are not
prebuilt.

Only after this acceptance is L1 COMPLETE and the main product track moves to
L2.

## Что не является gate для L2

Следующие вещи не блокируют начало L2 до появления конкретного use case:

- detailed optical/fiber-member UX;
- Cat6/OM3/OS2 inventory;
- cable length calculation;
- ducts/bundles;
- warehouse/inventory;
- negotiated link state;
- monitoring;
- transceiver database;
- LLDP/SNMP collectors;
- full rack elevation/DCIM;
- auto-layout;
- multiuser/auth/comments/audit;
- sophisticated import framework;
- perfect polish of every screen.

Принцип «довести L1 foundation» не должен превращаться в бесконечную L1-разработку.
