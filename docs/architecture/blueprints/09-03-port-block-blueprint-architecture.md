# 09.3 Port Block Blueprint composition and multi-face physical presentation

## Status, authority and scope

**FIXED architectural decisions. L1S.6c.1–L1S.6c.6 are IMPLEMENTED. C-CAP-02A naming boundary is implemented pending external review and manual recheck.**

This note records the agreed next evolution of Object Blueprints for dense
network equipment. It is an architecture/product boundary only: it does not
define storage, migrations, APIs, DTO fields, editor components, or an
implementation milestone. The current immutable Object Blueprint, L1
materialization, projection, and Saved Map contracts remain authoritative until
a bounded implementation milestone changes them explicitly.

NetMap is a network-understanding and tracing tool. It is not hardware
inventory or rack-visualisation software. A reusable presentation primitive is
therefore specifically a **Port Block**: a reusable arrangement of network
connection points that makes truthful physical presentation usable. This work
must not grow into arbitrary front-panel inventory such as fans, displays,
power supplies, decorative chassis modules, or non-network hardware.

## Fixed model

### Library-owned, versioned Port Blocks

A Port Block is a library-owned reusable structural/layout template. A **Port Block version**
describes an arrangement of network connection point positions, for example:

- one row of 48 endpoint positions;
- two rows of 24 endpoint positions;
- a compact two-position group.

Port Block versions are immutable once created. Changing a Port Block creates a
distinct version and must never silently alter an existing immutable Object
Blueprint version that later references it. L1S.6c.1 persists the library-owned
record, immutable version number, and an exact ordered/layout port snapshot.
The editor deterministically produces that same explicit structural snapshot;
neutral position markers such as `P1` are preview only. Device-specific names
are not persisted in Port Block ports.
L1S.6c.3 composes exact immutable Port Block versions into Object Blueprint
versions; the server expands their slots and persists provenance.

A Port Block is authoring/presentation provenance, not canonical topology. It
is not a `PhysicalObject`, a canonical network entity, or a topology source of
truth. Materializing an Object Blueprint still expands its final endpoint slots
into the existing canonical records:

```text
ConnectionPoint
optional NetworkInterface
owner and direct physical-binding relations
BlueprintInstance / slot provenance
```

Existing canonical identities and the L1S.6 upgrade rules remain valid. In
particular, Port Block provenance must not silently reconcile runtime topology.

### Stable identity is separate from presentation

Each Port Block conceptually owns stable local port identities, such as `p1`
through `p48`. Each placement of that exact Port Block version within an Object
Blueprint has a stable instance key, such as `main`, `uplink`, or `rear`.

Consequently, a final Object Blueprint slot identity is compositionally derived
from stable authoring identities:

```text
SHA-256(uint32be(byte_length(UTF-8(instance_key))) + UTF-8(instance_key) +
        uint32be(byte_length(UTF-8(local_id))) + UTF-8(local_id))
```

The persisted key is `pb_` plus that lowercase SHA-256 digest. The invariant is:
a port identity must never be derived from visible port number, display label,
row position, screen coordinate, or array/UI order. Renumbering a label alone
must not change canonical port identity.

Endpoint numbering belongs to each exact Port Block instance inside an Object
Blueprint version, not to the reusable Port Block. The initial scope supports
one or two rows and these Blueprint-local schemes:

```text
single row:           1 2 3 4 ...
two rows, sequential: top 1 ... 24; bottom 25 ... 48
two rows, odd/even:   top 1 3 5 ... 47; bottom 2 4 6 ... 48
two rows, even/odd:   top 2 4 6 ... 48; bottom 1 3 5 ... 47
```

Each Blueprint instance persists a free-form prefix, non-negative starting
number, mode, and overrides keyed by stable Port Block `local_id`. The server
resolves those values against the exact Port Block version and freezes the
result in `BlueprintEndpointSlot.display_name`. Prefix, number, resolved name,
override, row and layout order never enter slot identity. The same Port Block
version can therefore name positions `Ge1/0/1..2` in one Blueprint and
`fc0..1` in another. Structural left-to-right/right-to-left order remains a
Port Block layout concern. No name implies Ethernet, Fibre Channel, speed,
connector or other technology/capability.

C-CAP-02A is a pre-production destructive transition: the obsolete Port Block
`display_label` persisted contract is removed. Old development authoring
records and workspace format v1 snapshots need not be converted or imported;
recreate the testbed as needed. Immutable resolved Blueprint slot names and
canonical identities remain their respective source of truth. Technology and
physical compatibility stay OPEN for C-CAP-02B; C-CAP-02 as a whole is not
closed.

### One Object Blueprint, multiple physical faces

One canonical `PhysicalObject` may have more than one physical presentation
face. The initial required faces are `FRONT` and `REAR`. A server with front
management ports and rear Ethernet ports is still one `PhysicalObject`.

Face is presentation geometry within an L1 object presentation. It is not a
second `PhysicalObject`, a separate Object Blueprint, a separate Saved Map
membership, or a replacement for existing network-map views. The dimensions
are orthogonal:

```text
Map/network view:                    Physical face within one L1 object:
L1 / PHYSICAL_OBJECT                 FRONT
L2 / DEVICE                          REAR
```

No new `MapViewKey` is implied. Existing Saved Map view keys remain
`L1/PHYSICAL_OBJECT` and `L2/DEVICE`; `MapPlacement` continues to mean that
one canonical object belongs to one Saved Map, with positions per network view.

An Object Blueprint version is the complete-device version boundary. It
conceptually contains its body presentation, one or more faces, instances of
exact immutable Port Block versions placed on those faces, stable block-instance
keys, expanded endpoint slots, and internal links between final endpoint slots.
Front and rear are parts of that one version, not separately versioned device
templates. This prevents invalid independent state such as “front v3 + rear
v2”.

### Intrinsic body geometry and Saved Map display size

Blueprint body `width` and `height` are dimensionless intrinsic/design
coordinates: they define body shape and aspect ratio only, not physical units or
map-node size. `8×1` and `480×60` are therefore equivalent aspect ratios.
Face-local normalized Port Block composition remains intrinsic to this body and
keeps its existing provenance and identity boundary. A positive optional
`MapViewPosition.display_width` is the per-Saved-Map L1 presentation width;
runtime height is `display_width × body.height / body.width`. Historical NULL
positions use a deterministic default independent of absolute body dimensions.
This preserves `BlueprintEndpointSlot.anchor`, canonical connection-point
identity and cable behavior; rendered-port and external attachment geometry are
still exclusively future L1S.6c.6 work.

### Internal links and runtime topology

Existing Blueprint internal-link semantics remain valid. For example, a front
and rear patch-panel block may be internally connected one-to-one, and
device-internal continuity can connect slots on different faces. On
materialization those links remain ordinary canonical topology; runtime
canonical topology remains authoritative thereafter.

This rule applies only to the `PhysicalObject` and its owned
`ConnectionPoint`s. `Cable` is not a Blueprint/Port Block target: it is an
optional entity attached to one canonical `Connection`, with no Cable-owned
points, internal Connection, or Blueprint provenance.

Port Block composition changes neither the L1S.6 rule that blueprint provenance
must not silently reconcile runtime topology nor the existing additive upgrade
contract: same-key/same-kind slots preserve their canonical endpoint identity;
destructive or inconsistent changes remain blockers.

## Intended product behavior

### Visual authoring

L1S.6c.5 persists an immutable, face-local normalized rectangle (`x`, `y`,
`width`, `height`) on each exact Port Block instance and provides visual
composition by drag/resize on independent FRONT/REAR surfaces. The rectangle
is strictly presentation/provenance: it never contributes to `instance_key`,
composed `slot_key`, ConnectionPoint identity, canonical topology, or upgrade
matching. Historical immutable rows may have NULL placement; readers use a
deterministic temporary editor layout and a newly saved Blueprint version writes
explicit placement. It does not repurpose `BlueprintEndpointSlot.anchor`, whose
deterministic right-edge fallback remains runtime cable/topology presentation.

### Drawn-port geometry and cable attachment geometry

Dense Port Blocks need two distinct future presentation values for a port:

```text
rendered port position
external cable attachment position
```

They may differ. For a two-row block, this prevents external cables from
visually passing through the other row merely because the exact port is drawn
there. Canonical connectivity still attaches to the exact same
`ConnectionPoint`; neither value changes topology. This boundary is explicit
because the current single `anchor` presentation model cannot represent it
cleanly. L1S.6c.6 derives rendered ports from immutable PortBlock layout plus
face-local placement and separately derives external cable attachment on the
complete object's outer boundary with deterministic per-block fan-out. The
shared FRONT/REAR divider is visual only, never an external boundary. Neither
geometry affects canonical identity/topology, upgrades, Saved Map membership,
or routes; the obsolete `BlueprintEndpointSlot.anchor` contract is removed.

## Deliberately separate future concern: composite network devices

**One physical device with multiple faces** means one `PhysicalObject`.

**Several physical boxes operating as one logical network device** (for
example, a switch stack) is different. Each box retains its own exact canonical
`PhysicalObject` identity so NetMap can answer where a cable is physically
connected. A future composition/aggregation layer may, when network semantics
justify it, present several physical objects as one logical L2/L3 device. It
must not collapse those boxes into one canonical `PhysicalObject`, and it is
not part of Port Block implementation.

## Deliberately out of scope

- `FRONT`/`REAR`, visual Object Blueprint composition, rendered-port/cable
  attachment geometry, projection changes, cable geometry, composite devices,
  and dense-cable editing visibility;
- arbitrary front-panel hardware inventory or rack visualization;
- arbitrary dense grids, more than initial one/two-row numbering scope, or a
  numbering expression language;
- a new Saved Map view or `MapViewKey`;
- changes to canonical topology, identity, resolver, tracing, or L1S.6 upgrade
  semantics;
- composite logical-device aggregation;
- dense-cable editing visibility. That is a separate later bounded milestone:
  a selected cable stays visible while routing and obstructing objects may
  become translucent. It must not be combined with Port Block composition.

## Implementation hand-off

L1S.6c is intentionally subdivided as follows:

1. **L1S.6c.1 — Port Block library foundation**.
2. **L1S.6c.2 — Port Block authoring and numbering — IMPLEMENTED**.
3. **L1S.6c.3 — Object Blueprint composition and legacy EndpointGroup removal — IMPLEMENTED**.
   Exact immutable Port Block versions, stable block-instance keys and local IDs
   produce server-expanded slots and explicit internal-link endpoints. Historical
   snapshot-only versions remain readable/instantiable; additive L1S.6 upgrades
   retain canonical identity through unchanged slot snapshots.
4. **L1S.6c.4 — `FRONT`/`REAR` physical presentation — IMPLEMENTED**. Face is persisted on exact Port Block instances; historical NULL reads as FRONT, and runtime filtering is presentation-only.
5. **L1S.6c.5 — visual Blueprint composition editor — IMPLEMENTED**.
6. **L1S.6c.5a — intrinsic Blueprint geometry and per-map L1 display size — IMPLEMENTED**.
7. **L1S.6c.5b — simultaneous runtime faces — IMPLEMENTED**. The L1 map is one
   object presentation with zero, one or two visible face surfaces derived from
   actual slot presentation; it is not a runtime FRONT/REAR selector and has
   no runtime face captions. One face is one body rectangle; FRONT plus REAR
   are directly joined body rectangles (FRONT above REAR) under one centered,
   scalable object label. One `display_width` controls every face and the
   complete footprint with no header, label, or inter-face gap geometry.
   The Blueprint editor may retain its FRONT/REAR tabs because they are an
   authoring convenience only. Internal continuity is rendered in one
   object-level presentation coordinate system behind the ports: a FRONT slot
   uses its `rendered_position`, and a REAR slot is offset by the rendered
   FRONT-face height when both faces are stacked. Every canonical internal L1
   link whose two endpoints are visible is a direct segment between those exact
   positions, including cross-face links. This is presentation-only geometry:
   it adds no routing, bends, or persistence.
8. **L1S.6c.6 — rendered-port vs external-cable-attachment geometry — IMPLEMENTED**.

L1S.6c.3 destructively removed the active legacy `EndpointGroup`,
`placement_offset`, and `placement_span` authoring contract. NetMap is
pre-production, so no compatibility parser, dual recipe format, or migration
machinery exists solely to preserve development Blueprint authoring records.
This does not change any canonical topology, immutable Blueprint snapshot,
Saved Map, provenance, or L1S.6 upgrade rule.

Every future slice must preserve the current authoritative runtime facts,
immutable snapshot behavior, exact slot-to-canonical mappings, and the Saved
Map separation between membership, network view, and presentation geometry.
