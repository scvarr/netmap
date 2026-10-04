# 09.5 Composable Blueprint presentation panels

## Status and authority

**FIXED / ACCEPTED TARGET CONTRACT. SLICES A, B, C AND D IMPLEMENTED; D2 IMPLEMENTED.**

This document supersedes only the binary `FRONT | REAR` presentation model in
[09.4](09-04-direct-blueprint-endpoint-authoring.md). Direct endpoint slots
remain the primary Blueprint-version authoring entities. Persistence, API,
workspace v3, projection, runtime geometry, preview, and the current
multi-panel editor use panel composition. Slice B2 adds panel move and resize
with transient screen-space snapping and guides. Phase C is **READY TO RESUME** with manual HV-01 / Phase C acceptance next. Port
Block remains removed and is not a prerequisite.

An immutable `ObjectBlueprintVersion` owns body/overall presentation,
`PresentationPanel` records, direct `BlueprintEndpointSlots`, and
`BlueprintInternalLinks`. A panel is authoring, provenance, and presentation
inside that immutable snapshot. It is not canonical topology, a
`PhysicalObject` component, a `SavedMap` entity/view, or a reusable library
entity. Canonical topology remains the runtime source of truth.

## Panel identity, number, and name

Each persisted `PresentationPanel` has an opaque stable `panel_key`, a stable
positive integer `panel_number`, an exact open-string `display_name`, and
rectangle `x`, `y`, `width`, `height` in composition coordinate space. The key
is stable within the Blueprint lineage and is never
derived from name, number, geometry, ordering, or layout. An unchanged logical
panel preserves its key across versions and rename/move/resize; deletion removes
it; a new or later duplicated panel gets an independent key. No panel key
becomes canonical identity.

Numbers provide compact user context and default endpoint names. The first
panel normally has number 1; a new panel receives the next unused monotonic
number. Number persists across versions and does not change on rename, move, or
resize. Deletion does not renumber remaining panels. Names are user strings
such as `Передняя`, `Задняя`, `Контроллер A`, `Верхняя`, or `IO Module 1`;
there is no persisted fixed panel taxonomy. “Add above/below/left/right” is an
editor placement operation, not panel meaning.

A new Blueprint starts with exactly one neutral initial panel, with
`panel_number = 1` and a neutral exact name such as `Панель 1`, not an implicit
semantic FRONT panel. The user can rename it.

## Composition geometry and editor

The Blueprint composition coordinate space contains one or more panel
rectangles. Panel geometry is exact immutable snapshot geometry in that space;
endpoint `x`/`y` are normalized local coordinates within the owning panel.
Moving a panel leaves its endpoints' local coordinates unchanged. Resizing it
changes rendered absolute endpoint positions through those normalized local
coordinates. Geometry never determines endpoint identity.

The authoring workspace shows all panels simultaneously; one may be active for
endpoint creation/editing. Active selection is transient editor state, not a
separate map or snapshot entity. “Добавить панель” offers above, right, below,
or left placement relative to the active panel. Above/below initially inherit
its width and are adjacent; left/right inherit its height and are adjacent.
Any reasonable gap is an editor concern. Persist only the resulting rectangle,
not the placement operation or a relation to another panel.
Spatial endpoint authoring also accepts exact numeric panel-local X/Y positioning:
one selected endpoint uses its local coordinate; a multi-selection uses the
bounding-box center and translates the group while preserving its layout.

## Endpoint slots and default names

Each direct endpoint slot has an opaque stable `slot_key`, belongs to exactly
one panel through `panel_key`, has exact open-string `display_name`, kind, and
panel-local normalized `x`/`y` in `[0,1]`. Persisted endpoint `face` is
removed. Future semantic endpoint properties remain a separate
contract. Moving a slot within a panel changes only local position. Moving it
between panels requires an explicit editor operation; geometry does not infer
ownership. Identity is independent of name, panel number, and geometry.

For a newly created slot, the exact initial name is
`<panel_number>-<local_number>` (`1-1`, `1-2`; `2-1`, `2-2`). Local number is a
positive per-panel authoring helper, not identity. Allocate the next available
number and avoid immediate duplicate defaults. Partial deletion does not
compact numbering or rename remaining endpoints (for example, after `1-1`,
`1-2`, `1-4`, the next may be `1-5`). Once a panel has zero endpoints of either
kind, its local default-name helper resets to 1; the next new endpoint starts
at `<panel_number>-1`. Bulk naming preserves the current per-panel high-water allocator; renaming
existing endpoints does not compact or reset default numbering.
`slot_key` is identity and `display_name` is the exact persisted name. This is
not a live formula: renaming a panel or changing its number in a future
explicit operation never rewrites an existing name such as `MGMT`. No naming
recipe or semantic inference from names is persisted.

## Copying endpoints and continuity

The editor supports explicit “Копировать в панель → <target panel>” for
selected endpoints. Each copy is a new slot with a new independent `slot_key`,
the source kind, destination `panel_key`, and exactly preserved panel-local
normalized geometry, regardless of destination size or aspect ratio. Use destination-panel-aware defaults (`1-1` copied to panel 2
becomes `2-1`) rather than blindly reusing source names. Custom source names
are not inherited: every copy uses the ordinary destination endpoint-name allocator. No existing endpoint is renamed or renumbered.

During the operation the editor may hold transient
`source_slot_key -> copied_slot_key` correspondence. Do not persist copy
provenance. An optional “Создать внутренние связи 1:1” operation uses that
correspondence to create one exact `BlueprintInternalLink` per pair. Persist
only those ordinary links, not a pairing recipe or group. This copy-assisted
case remains distinct from general ordered pairwise continuity, where a user
explicitly selects ordered sets A and B. Both produce exact internal links.

Internal-link endpoint choices expose panel context, for example
`1-1 · Передняя` / `2-1 · Задняя` or `MGMT · Контроллер A` /
`MGMT · Контроллер B`. This is UI disambiguation; link identity remains based
on slot keys.

## Materialization, runtime presentation, and upgrades

Panels never materialize as canonical entities. `CONNECTION_POINT` produces a
`ConnectionPoint`; `NETWORK_PORT` produces a `ConnectionPoint` and
`NetworkInterface` with existing ownership/binding. Panel data remains
Blueprint presentation provenance. A panel named “Контроллер A” does not imply
a canonical controller component. Separate lifecycle, identity, serial number,
replaceability, relationships, or nested ownership would require a distinct
future component/domain contract and are outside this one.

**IMPLEMENTED — runtime semantic/geometry contract.** Runtime Blueprint
projection renders all panels together using
their rectangles. Absolute endpoint position is derived from panel rectangle
and panel-local position. External cable attachment derives from the outer
boundary of the complete multi-panel `PhysicalObject` presentation; boundaries
between adjacent panels are internal and are not external attachment edges. No
new cable-routing algorithm is defined. Map runtime Blueprint geometry,
internal L1 continuity geometry, and library/thumbnail preview must all consume
the panel composition; fixed-face geometry cannot remain as an operating
dependency after face removal.

**OPEN / DEFERRED — dense runtime Map presentation follow-up.** Manual B2
inspection found that generic Map endpoint glyphs can dominate a dense 24/48-port
Blueprint-derived `PhysicalObject`: authored panel/device silhouette becomes
less readable than in the Blueprint editor, and endpoint marker density is
disproportionate to object scale. This is a runtime Map presentation/object UX
finding; Blueprint persistence, materialization, canonical endpoints, and
topology semantics remain correct.

Map representation need not literally reuse editor endpoint glyphs. A dense
Blueprint-derived object should preserve a readable overall equipment silhouette
and recognizable panel composition without endpoint glyphs visually suppressing
the object. Exact runtime treatment remains **OPEN** until object creation and
manual acceptance. Acceptance concerns include smaller or screen-space endpoint
markers, zoom-dependent detail / LOD, hover/selection emphasis instead of
permanently heavy glyphs, distinguishable `NETWORK_PORT` and `CONNECTION_POINT`
without excessive size, and readable object nameplate and panel silhouette.
These are solution dimensions for acceptance, not a selected implementation:
no concrete CSS size or final design is fixed, and visual correction must not
change canonical endpoint topology. The deferred check belongs to the
[Phase C rack-first walkthrough](../../plans/11-04-phase-c-representative-l1-testbed.md)
and does not block completion of the B2 editor milestone.

Panel identity is `panel_key`; endpoint upgrade matching and materialization
remain `slot_key`-based. Panel membership/name/geometry and local endpoint
geometry are presentation changes. Moving a same-key endpoint to another
panel does not create a canonical endpoint; a copied slot later has a new key
and materializes as a new endpoint. Panels never become canonical topology or
`PhysicalObject` components. Do not broaden upgrade semantics. Workspace
exchange format must incompatibly bump from current v2 to v3 and include each
panel's key, number, name, and rectangle, and each slot's panel key,
panel-local position, and existing exact fields. Compatibility with old v2
development snapshots is not required.

## Representative cases

### Simple network device

One panel, `1 — Передняя`, contains `1-1` through `1-N`. A second panel is not
required.

### Passive patch panel

Panel 1, `Передняя`, has 24 `ConnectionPoint` slots. Add panel 2, `Задняя`,
below; copy the 24 slots with destination-aware names and optionally create
1:1 continuity. The resulting ordinary links are `1-1 ↔ 2-1` through
`1-24 ↔ 2-24`. No `NetworkInterface` is required.

### Storage shelf / dual controller

Panel 1, `Контроллер A`, and panel 2, `Контроллер B`, sit side-by-side and each
has its own `NetworkPort` slots. Both panels belong to one `PhysicalObject`;
they do not imply separate canonical controllers.

## Superseded assumptions and implementation sequence

The following 09.4 target assumptions are superseded: fixed `FRONT | REAR`
enum; exactly two faces; separate FRONT/REAR authoring toggle as target UX;
endpoint `face` as target representation; cable geometry tied specifically to
two faces. These are now historical facts, not application presentation
contracts.

Bounded implementation slices:

1. **IMPLEMENTED — Persistence, API, and operability cutover:** persist `PresentationPanel`
   on `ObjectBlueprintVersion` with stable opaque `panel_key`, stable positive
   `panel_number`, exact open `display_name`, and composition-space rectangle;
   assign every endpoint exactly one `panel_key`, retain normalized panel-local
   `x`/`y`, and remove persisted endpoint face. The version API includes
   panels and endpoint API uses `panel_key`; target API schemas expose no
   FRONT/REAR compatibility taxonomy. This incompatible pre-production
   cutover may destructively reset current development data: no FRONT/REAR
   compatibility layer, dual representation, or legacy backfill/fallback is
   required. Bump workspace exchange v2 to v3 with panel and endpoint
   composition state. Keep materialization and upgrade matching
   `slot_key`-based. To leave the application operable, this slice also cuts
   over Blueprint projection to panel-aware geometry, derives absolute
   endpoints from panel rectangles and local positions, derives external
   attachment from the complete composition's outer boundary (adjacent-panel
   boundaries are internal), and updates Map Blueprint geometry, internal L1
   continuity geometry, library/thumbnail preview, and the minimal frontend
   editor state/API consumers from face to `panel_key`. This is a bounded
   representation and geometry cutover; it defines no new cable-routing
   algorithm. Initial authoring uses exactly the neutral panel 1 and defaults
   endpoint names individually to `1-1`, `1-2`, and so on; names are exact,
   are not live formulas, and are not compacted after deletion. Before Slice B,
   FRONT/REAR selector UX is removed. If a multi-panel snapshot is encountered
   before full panel editing exists, the editor must not silently flatten,
   discard, remap, or overwrite its panels. Slice A does not deliver the
   multi-panel authoring workspace.
2. **B1 IMPLEMENTED — Multi-panel lifecycle and active-panel authoring:** show all
   panels simultaneously in composition coordinates; select one transient active
   panel; add adjacent panels above/right/below/left with zero gap; rename and
   delete empty panels; author endpoints and use spatial selection/layout tools
   only within the active panel. The version detail supplies a derived
   `next_panel_number` from the lineage history. The editor keeps transient
   panel and per-panel endpoint name allocators, and save derives body dimensions
   from the composition bounding box while preserving exact panel rectangles.
   **B2 IMPLEMENTED — Panel geometry editing:** move the active panel from its
   border and resize it with eight transient handles. Multi-panel compositions
   also support exact numeric width/height editing of the active panel, keeping
   its top-left corner fixed. Pointer geometry remains
   stable during a gesture; snapping to other panel edges and visual guides are
   transient. Endpoint local coordinates remain unchanged. Slice B is complete.
3. **Slice C IMPLEMENTED — Copy to panel:** selected-slot copy from the active panel
   to another existing panel, with new opaque slot keys, destination panel membership,
   destination-aware default naming, exactly preserved local normalized geometry,
   and optional ordinary 1:1 internal links. No copy relation is persisted.
   Capacity is checked for the entire selection before changes; overflow leaves
   state unchanged. Successful copy activates the destination and selects the copies,
   without auto-layout. The compact copy controls sit below the canvas beside
   selection tools.
4. **Slice D1 IMPLEMENTED — Ordered selection and bulk naming:** explicit transient,
   active-panel-scoped click order with compact screen-space sequence badges;
   clicking an existing member removes it and compacts numbering. A one-click
   inactive endpoint activates its panel and starts a fresh order at 1. Panel
   switches clear the order; endpoint drag and marquee do not form or move it.
   A bounded dialog supports up/down/remove and exact naming preview from an
   open prefix, integer start, and nonzero integer step. Apply atomically changes
   only selected exact `display_name` values, retaining order for verification.
   No order, group, or naming recipe is persisted; geometry, keys, kinds,
   internal links, and the default-name allocator are unchanged.
5. **Slice D2 IMPLEMENTED — General pairwise continuity:** capture copies the
   current ordered slot keys as transient session snapshots A/B. They survive
   order clearing, panel switches, dialog close/reopen, and ordered-mode exit;
   explicit clear/recapture replaces them, while reload/navigation discards them.
   A bounded on-demand dialog previews exact endpoint names with panel context.
   Default pairing uses A[i] and B[i]; transient reverse B changes only derived
   preview/apply order, never the snapshots. Shared preflight rejects empty or
   unequal sets, missing/duplicate keys, self-links, duplicate undirected batch
   pairs, and any existing ordinary link conflict. Apply is atomic and persists
   only ordinary `BlueprintInternalLink` records, then clears A/B and reverse.
   No pairing recipe, group, or new entity is introduced. Slice D is complete.

Technology/capability remains **OPEN**, separate from these slices. Dense runtime
Map presentation remains **OPEN / DEFERRED**. Editor prerequisites are implemented;
Phase C is **READY TO RESUME** at the same HV-01 step with manual acceptance next.
This does not mark Phase C complete or PASSED. Port Block does not return as a
prerequisite.
