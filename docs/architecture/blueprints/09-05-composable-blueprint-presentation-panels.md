# 09.5 Composable Blueprint presentation panels

## Status and authority

**FIXED / ACCEPTED TARGET CONTRACT. SLICE A IMPLEMENTED; SLICES B/C/D PENDING.**

This document supersedes only the binary `FRONT | REAR` presentation model in
[09.4](09-04-direct-blueprint-endpoint-authoring.md). Direct endpoint slots
remain the primary Blueprint-version authoring entities. Persistence, API,
workspace v3, projection, runtime geometry, preview, and the current
single-panel editor use panel composition. Full multi-panel authoring remains
pending in Slice B. Phase C remains **PAUSED** pending bounded editor work. Port
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
at `<panel_number>-1`. This is individual default naming only; ordered bulk
naming remains a later slice.
`slot_key` is identity and `display_name` is the exact persisted name. This is
not a live formula: renaming a panel or changing its number in a future
explicit operation never rewrites an existing name such as `MGMT`. No naming
recipe or semantic inference from names is persisted.

## Copying endpoints and continuity

The editor supports explicit “Копировать в панель → <target panel>” for
selected endpoints. Each copy is a new slot with a new independent `slot_key`,
the source kind, destination `panel_key`, and copied local normalized geometry
when meaningful. Use destination-panel-aware defaults (`1-1` copied to panel 2
becomes `2-1`) rather than blindly reusing source names. For custom source
names, copy behavior must remain explicit and predictable and avoid accidental
duplicate authoring names; no naming DSL is introduced.

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

Runtime Blueprint projection renders all panels together using
their rectangles. Absolute endpoint position is derived from panel rectangle
and panel-local position. External cable attachment derives from the outer
boundary of the complete multi-panel `PhysicalObject` presentation; boundaries
between adjacent panels are internal and are not external attachment edges. No
new cable-routing algorithm is defined. Map runtime Blueprint geometry,
internal L1 continuity geometry, and library/thumbnail preview must all consume
the panel composition; fixed-face geometry cannot remain as an operating
dependency after face removal.

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
2. **PENDING — Multi-panel canvas:** show all panels, active-panel state, add in four
   directions, rename/move/resize, author endpoints inside panels, and scope
   existing spatial selection/layout tools to a panel. This includes the
   simultaneous multi-panel authoring workspace, active-panel UX, add
   above/right/below/left, panel rename/move/resize/delete, and general panel
   management UI.
3. **PENDING — Copy to panel:** selected-slot copy with new keys, destination defaults,
   local geometry, and optional 1:1 links.
4. **PENDING — Ordered bulk authoring:** ordered selection, bulk naming, and general
   pairwise continuity.

Technology/capability remains **OPEN**, separate from these slices. Phase C
remains **PAUSED**; multi-panel redesign is a prerequisite before patch-panel
and internal-link acceptance. Multi-panel implementation, ordered bulk naming,
and general pairwise continuity are **PENDING**. Port Block does not return as
a prerequisite.
