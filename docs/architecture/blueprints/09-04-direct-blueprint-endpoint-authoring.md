# 09.4 Direct Blueprint endpoint authoring

## Status and authority

**FIXED / ACCEPTED DIRECT-SLOT FOUNDATION AND SPATIAL
MULTI-SELECTION AND ORDERED BULK AUTHORING IMPLEMENTED.**

The destructive foundation cutover removed Port Block application models,
tables, APIs, library and editor surfaces. Immutable Blueprint versions now
own direct slots with exact names, kinds, faces, normalized positions, opaque
stable keys, and individual internal links. The minimal editor supports bulk
add, single selection, rename, kind/face edit, move, delete, and individual
links. Transient multi-selection, marquee, group move, spatial alignment,
distribution, one/two-row layout, multi-delete, and temporary drag alignment
guides with snapping are **IMPLEMENTED**. Panel copy is **IMPLEMENTED** in 09.5 Slice C. Ordered selection and bulk
naming are **IMPLEMENTED** in Slice D1; pairwise bulk continuity is **IMPLEMENTED**
in Slice D2. The ordered bulk authoring slice is complete.
Endpoint technology/capability
remains **OPEN**. Editor prerequisites are implemented; Phase C is **READY TO
RESUME** with manual HV-01 recheck / Phase C acceptance next, not complete or PASSED.

The direct-slot authoring foundation, identity, immutable snapshots, and
materialization in this document remain authoritative. Its binary
FRONT/REAR-specific presentation contract is superseded by [09.5 Composable
Blueprint presentation panels](09-05-composable-blueprint-presentation-panels.md).
The
former L1S.6c Port Block model in
[09.3](09-03-port-block-blueprint-architecture.md) has been removed from the
application. It remains historical context only.

The Phase C HV-01 authoring walkthrough exposed the cost of the intermediate
`PortBlock -> PortBlockVersion -> PortBlockPort ->
BlueprintPortBlockInstance -> BlueprintEndpointSlot` lifecycle: one device
needs independently named and presented endpoint sets, which users naturally
author on that device's Blueprint canvas. Reusable layout does not justify a
separate persisted library/version lifecycle; bulk creation, copy, alignment,
distribution, and naming are editor operations. NetMap is pre-production and
preserving development Port Block records is not a target requirement.

## Direct endpoint snapshot

An immutable `ObjectBlueprintVersion` directly owns the complete device
snapshot: body geometry, endpoint slots, exact names and rendered positions,
presentation facts needed for truthful rendering, and explicit internal
links. The current physical-face representation is superseded by panels in
09.5. Port Block is absent from the target model.

In the current implementation each endpoint slot has a stable opaque
`slot_key`, kind (`CONNECTION_POINT` or `NETWORK_PORT`), face (`FRONT` or
`REAR`), exact user-facing `display_name`, and intrinsic face-local normalized
rendered position. This binary face representation is historical/current
implementation state; the accepted target representation is panel ownership
and panel-local coordinates in 09.5. Future endpoint-specific semantic
properties remain a separate contract. The version stores exact final names;
a naming recipe is not needed to reproduce the snapshot.

Workspace portability must round-trip the complete immutable Blueprint
snapshot, including direct endpoint keys, exact names, kinds, rendered
positions, and internal links. The target panel fields are defined in 09.5;
the current face field is implementation state. Port Block library records and composition
provenance are not required authoring payloads in the target exchange format;
an incompatible format may be version-bumped.

Create a new `slot_key` when an endpoint is added. It is not derived from name,
position, face, selection order, or UI index. When making a new Blueprint
version, preserve the key for an unchanged logical endpoint across rename,
reposition, or property edits. Delete removes the endpoint from the new
version; additions and duplicate/copy operations create independent new keys.
Position is immutable presentation geometry within a saved version and never
participates in identity. The current face-local coordinate contract is
superseded by panel-local coordinates in 09.5.

This identity preserves the existing additive Blueprint upgrade meaning:
same-key/same-kind endpoints match and retain their canonical endpoint
identity; new keys describe additions. A new Blueprint version does not
silently alter already materialized topology.

## Materialization and canonical topology

Materialization continues to expand each endpoint slot to a `ConnectionPoint`.
`NETWORK_PORT` additionally materializes a `NetworkInterface` and its existing
physical owner/binding relations; `CONNECTION_POINT` materializes only the
point. The exact endpoint `display_name` becomes the existing user-facing
`ConnectionPoint` alias and, for `NETWORK_PORT`, the `NetworkInterface` alias.
Blueprint remains authoring provenance, not runtime canonical topology.

An explicit internal link between two Blueprint endpoint slots still
materializes as an ordinary canonical internal `Connection`. Runtime topology
remains authoritative after materialization. `FRONT` and `REAR` remain
presentation faces of one `PhysicalObject`, not topology direction, separate
objects, or Saved Map views. Simultaneous runtime presentation of visible faces
remains the target behavior.

## Canvas authoring contract

The Blueprint canvas is the primary authoring surface. The current
implementation adds slots on a FRONT or REAR surface; the target canvas and
panel-scoped endpoint authoring are defined in 09.5. The user can add `N`
network ports or connection points. The
slots appear with new keys at deterministic temporary/default positions and
are immediately editable. Bulk creation creates no persisted group.

Selection is transient editor state and supports single selection,
modifier-based add/remove, marquee selection, multi-selection, and moving a
selected set together. Editor operations cover move, delete, duplicate/copy,
horizontal/vertical alignment, alignment to relevant edges or centers, and
equal horizontal/vertical distribution. A convenient row layout may be offered
for dense authoring. These operations change exact endpoint positions or
endpoint records; they do not create persisted groups or recipes.

**IMPLEMENTED (D1)** — For order-dependent bulk actions, users explicitly form an ordered selection.
The editor shows transient sequence numbers and provides a clear way to set or
reorder processing order. Those numbers are neither identity nor persisted
grouping. Bulk naming supports a prefix, starting number, step, exact-name
preview, and apply. For example, prefix `Ge0/`, start `1`, step `1` applied to
four ordered endpoints yields `Ge0/1` through `Ge0/4`. After apply, persist
only the exact names. Odd/even labels can be authored with separate selections
and steps of two; no persisted odd/even scheme or arbitrary naming DSL is
introduced. A single endpoint remains individually renameable. Names are open
user strings; neither fixed interface-name taxonomy nor technology inference
from a name is introduced.

Future technology/capability editing may apply to selected endpoint slots.
Selection remains a bulk editing mechanism, not a domain group. This document
does not define those properties or close the Phase C probe on the separation
between physical `ConnectionPoint` compatibility and `NetworkInterface`
technology/capability. That question remains **OPEN**.

## Internal links and dense authoring

The editor retains individual endpoint-to-endpoint internal links. For dense
one-to-one continuity, the **IMPLEMENTED (D2)** editor supports capturing ordered sets A and B, previewing
pairing, and applying the links. A patch panel can pair FRONT 1..24 with REAR
1..24. Persist only the resulting exact Blueprint internal links; temporary
pairing sets and named link groups are not domain entities. Reverse pairing is
a transient editor convenience. Captures copy slot-key snapshots; apply is atomic
and rejects self-links, missing endpoints, duplicate undirected pairs, and existing
link conflicts. Only ordinary `BlueprintInternalLink` records persist.

## Endpoint and cable presentation geometry

The current endpoint rendered position is direct and face-local. The target
derivation from panel rectangle and panel-local position, plus external
attachment at the outer boundary of the complete multi-panel object, is
defined in 09.5. The shared FRONT/REAR divider in the current implementation
is not an external boundary. Attachment geometry affects neither identity nor
canonical topology. No full cable-routing algorithm is specified here, and
there is no Port Block geometry dependency.

## Editor conveniences are not persisted domain entities

Current selection, ordered selection numbers, alignment/distribution/row
commands, post-apply naming parameters, temporary pairwise sets, and
copy/duplicate operations are editor-only. Persisted named endpoint sets such
as “MGMT” or “SAN-A” require a separate workflow finding and semantic contract;
they are not introduced here.

## Representative authoring cases

- **HV-01:** create one management port, four ordinary network ports, two
  further network ports, and storage-side ports; arrange and bulk-name each
  selected set; leave the editor model ready for future endpoint-level
  technology/capability edits. No library prerequisite.
- **Dense switch:** create 48 slots, lay them out in one or two rows, align or
  distribute them, apply ordered bulk names, and later bulk-edit properties.
  No reusable Port Block entity is needed.
- **Passive patch panel:** author FRONT and REAR connection points, lay them
  out, select ordered sets, and apply pairwise internal continuity. No
  `NetworkInterface` or Port Block is required.

## Pre-production data policy

The foundation cutover destructively removed `PortBlock`,
`PortBlockVersion`, `PortBlockPort`, `BlueprintPortBlockInstance`, associated
API/DTO/UI/routes, library/editor pages, and obsolete persisted provenance.
Preserving the development database and old Port Block authoring records is
not required; no compatibility migration for them is provided. Workspace
exchange format version 2 carries direct slots and rejects version 1.

## Bounded implementation sequence

1. **Domain/storage/API simplification:** persist direct slots and exact
   internal links on immutable Blueprint versions; remove Port Block
   persistence, composition provenance, and associated API/library surfaces.
   This first establishes the new storage and write contract.
2. **Direct endpoint visual editor:** add, select, move, delete, duplicate,
   align, distribute, and place endpoints using direct slot identity and
   positions. Its current FRONT/REAR surfaces are superseded by 09.5.
3. **Ordered bulk authoring:** transient ordered selection, naming preview
   and apply are **IMPLEMENTED (D1)**; pairwise internal continuity authoring
   is **IMPLEMENTED (D2)**. Ordered bulk authoring is complete.
4. **Runtime/projection geometry adaptation:** read direct slot rendered
   positions and derive external cable attachment from the complete object
   boundary without Port Block geometry; preserve canonical topology,
   materialization, and upgrade semantics.

These are bounded slices of one redesign; technology/capability implementation
is excluded. If implementation discovery shows storage and projection must
move together to keep the application operable, keep the sequence bounded and
state that dependency explicitly rather than preserving a Port Block
compatibility layer.
