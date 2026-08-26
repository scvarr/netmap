# 09.3 Port Block Blueprint composition and multi-face physical presentation

## Status, authority and scope

**FIXED architectural decisions. Implementation is FUTURE.**

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

A Port Block is a library-owned reusable template. A **Port Block version**
describes an arrangement of network connection points, for example:

- 48 × RJ45;
- 4 × SFP+;
- management ports;
- patch-panel rows.

Port Block versions are immutable once an Object Blueprint version references
them. Changing a Port Block later creates a distinct version and must never
silently alter an existing immutable Object Blueprint version. The exact
library ownership, persistence shape, and serialized references are future
implementation decisions.

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

Consequently, a final Object Blueprint slot identity may be compositionally
derived from stable authoring identities:

```text
main:p1
main:p2
uplink:p1
```

The exact serialized slot-key format is deliberately open. The invariant is
not: a port identity must never be derived from visible port number, display
label, row position, screen coordinate, or array/UI order. Renumbering a label
alone must not change canonical port identity.

Port numbering is a type-safe/common authoring convenience, not identity. The
initial scope supports one or two rows and at least these automatic schemes:

```text
single row:           1 2 3 4 ...
two rows, sequential: top 1 ... 24; bottom 25 ... 48
two rows, odd/even:   top 1 3 5 ... 47; bottom 2 4 6 ... 48
two rows, even/odd:   top 2 4 6 ... 48; bottom 1 3 5 ... 47
```

Authoring also needs a configurable starting number, optional display prefix,
left-to-right or right-to-left ordering where required, and manual display-label
overrides for exceptional vendor layouts. This does not introduce a general
numbering expression language or an arbitrary dense-grid system.

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

### Internal links and runtime topology

Existing Blueprint internal-link semantics remain valid. For example, a front
and rear patch-panel block may be internally connected one-to-one, and
device-internal continuity can connect slots on different faces. On
materialization those links remain ordinary canonical topology; runtime
canonical topology remains authoritative thereafter.

Port Block composition changes neither the L1S.6 rule that blueprint provenance
must not silently reconcile runtime topology nor the existing additive upgrade
contract: same-key/same-kind slots preserve their canonical endpoint identity;
destructive or inconsistent changes remain blockers.

## Intended product behavior

### Visual authoring

The Object Blueprint editor should evolve from numeric `side` plus
`offset`/`span` placement to a visual composition surface. An author places
Port Block instances on a device face by visual placement/dragging rather than
calculating normalized ranges manually. This is a future editor direction, not
an implementation request for the current editor.

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
cleanly. No new geometry contract is implemented by this note.

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

- implementation, persistence/schema, migrations, API endpoints, projection
  DTO changes, UI components, and tests;
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

Future implementation may need subdivision, but must start from this note and
the existing L1S.6 contracts. It must preserve the current authoritative
runtime facts, immutable snapshot behavior, exact slot-to-canonical mappings,
and the Saved Map separation between membership, network view, and presentation
geometry.
