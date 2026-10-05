# 09.6 Hardware templates and object module installations

## Status and authority

**ACCEPTED / AUTHORITATIVE TARGET CONTRACT; 09.6-A IMPLEMENTED, AWAITING
EXTERNAL INSPECTION. 09.6-C/D/E REMAIN OPEN.**

This document supersedes the user concept of `ObjectBlueprint` as a complete
immutable snapshot of one particular equipment configuration in
[09.4](09-04-direct-blueprint-endpoint-authoring.md) and
[09.5](09-05-composable-blueprint-presentation-panels.md). Their implemented
direct endpoint, panel, spatial, copy, naming, and continuity slices remain
implemented. Stable opaque identity, immutable revisions, presentation-only
panels, and canonical L1 materialization remain foundations of this target.
The previous complete-configuration authoring and additive-only upgrade
workflow are superseded where they conflict with this contract.

Manual HV-01 evidence: instances of one base server with small configuration
differences must not require a separate complete assembled template for every
configuration. The accepted answer is a base equipment template plus modules
installed in each concrete object. Phase C is **PAUSED** until bounded
implementation and manual recheck of the same HV-01 step. This document records
the accepted redesign. The bounded implementation below does not close existing
`C-*` findings or replace manual HV-01 rechecking.

## Implemented boundary: 09.6-A

- The library distinguishes `BaseTemplate` / `BaseTemplateRevision` and
  `ModuleTemplate` / `ModuleTemplateRevision`. Creation publishes only their
  first immutable revision. No subsequent published editing API is available.
- Base revisions own presentation panels, built-in endpoint definitions,
  explicit internal links and `ModuleBay` records. Bays have opaque keys and
  numeric panel-local normalized rectangles contained within `[0,1] × [0,1]`.
- `POST /v1/topology/physical-objects` requires a root `base_template_id`;
  the server pins its current published revision. Canonical object, metadata,
  built-in endpoints, ownership/binding and internal L1 Connections are created
  atomically. `ObjectConfiguration` records provenance; it does not make the
  PhysicalObject a child canonical entity of the template.
- Module revisions have exact compatibility and ordered endpoint definitions
  without a canvas. Installation uses a root `module_template_id` and pins its
  current revision. Object/configuration locks and unique
  `(configuration_id, bay_key)` enforce at most one installation per bay.
  Object/bay existence, occupancy and exact case/whitespace-sensitive
  compatibility are checked before any canonical materialization.
- `ModuleInstallation.id` is independent of bay. `ModuleEndpointMapping`
  associates each definition with its canonical endpoints through that ID.
  Two installations have different endpoints; a module is never another
  PhysicalObject. NETWORK_PORT retains point, interface, ownership and binding.
- Horizontal endpoint coordinates are `x = bay.x + bay.width * (i+1)/(N+1)`,
  `y = bay.y + bay.height/2`. Vertical coordinates use centered x and evenly
  spaced y. These are derived for configuration and panel-aware L1/Map
  presentation and never persisted as endpoint identity.
- The existing panel/endpoint/internal-link editor creates bases and edits bay
  geometry numerically. A separate module form creates ordered definitions.
  Object creation selects the root base without a revision picker. `/physical`
  shows free/occupied bays, filters compatible modules and installs the chosen
  module with horizontal/vertical orientation, refreshing canonical details.
- Old ObjectBlueprint/BlueprintInstance persistence, instantiate, additive
  upgrades, published-edit actions and template-less equipment creation API/UI
  are removed. Low-level canonical test builders remain permitted.

Workspace exchange is **v4 only**, explicitly including base templates and
revisions, panels, built-in definitions and internal links, bays, module
templates and revisions, ordered module definitions, configurations,
installations and both endpoint mapping tables. Canonical,
authoring/configuration and map-presentation sections remain separate. v3
import is rejected; v4 round-trip preserves pinned revisions and canonical IDs.

Migration history is replaced by **0001 current schema initialization**,
including the CableLabelSettings singleton. Development databases must be
destroyed and recreated. No old records or revision IDs are translated; this
authorized destructive cutover does not modify an applied historical revision.

**OPEN:** persisted drafts, frozen candidates, impact review, later publication,
safe object/module updates, update-required state and module relocation/movement
remain outside 09.6-A. Dense Map LOD and endpoint technology semantics remain
open. External branch inspection and manual HV-01 acceptance are still required;
this implementation does not accept or resume Phase C.

## Library roles and base equipment template

The user-facing template library has two categories: **базовые шаблоны
оборудования** and **шаблоны модулей**. An internal mechanism may be shared,
but the user roles differ. A base equipment template is mandatory when
creating a `PhysicalObject`. There is no ordinary creation path without one.
Recursive modules within modules are not introduced.

A base template contains `PresentationPanel[]`, built-in endpoint definitions,
and module installation bays. Panels retain the stable panel identity and
composition presentation contract from 09.5. Built-in endpoints retain stable
opaque definition keys, exact names, kinds, and panel-local presentation.
Existing explicit internal continuity remains authoring provenance that
materializes into ordinary canonical L1 links. A `PresentationPanel` remains
presentation state; it is not a canonical component or topology evidence.

## Module installation bay

Each bay has:

- a stable opaque key;
- an exact display name;
- an owning `panel_key`;
- a presentation rectangle `x` / `y` / `width` / `height` within that panel;
- an open user-defined compatibility value;
- capacity for at most one module installation.

Identity never derives from the name, number, rectangle, or order. Rename,
move, and resize preserve the identity of an unchanged logical bay. A new bay
gets a new key. Compatibility is an open matching value shared with module
templates, not a fixed hardware taxonomy. Equal compatibility values identify
interchangeable bays for installation and automatic relocation. Names and
geometry do not imply compatibility.

The bay rectangle describes presentation placement. It does not model PCIe
lanes, generations, power, card dimensions, risers, multi-slot occupancy, or
physical hardware compatibility.

## Module template and presentation

A module template has an exact name, an open compatibility value, and ordered
endpoint definitions with stable opaque keys, exact endpoint names, and endpoint
kind. Future endpoint semantic properties require a separate contract.
Endpoint order is presentation input, never endpoint identity.

The module template needs no absolute geometry of its own. At installation,
the user selects **horizontal** or **vertical** placement. Endpoint positions
are derived deterministically and evenly from endpoint order, orientation,
and the bay rectangle. Moving or resizing that rectangle changes presentation
without changing installation or endpoint identity. No independent module
canvas or hardware geometry model is required by this contract.

## PhysicalObject configuration and canonical endpoints

A `PhysicalObject` is created from a base template. Configuration differences
between instances do not require separate assembled templates. Modules are
installed in the concrete `PhysicalObject` after creation.

A module installation is a configuration fact of its owning object. The
installed module is not a separate `PhysicalObject`. Built-in and installed
module endpoints materialize into ordinary canonical `ConnectionPoint` /
`NetworkInterface` entities: `CONNECTION_POINT` creates a point;
`NETWORK_PORT` creates a point and interface with the existing ownership and
binding semantics. They participate in existing L1 topology and ordinary
Connections/Cables. Runtime topology remains authoritative after materialization.

Each installation has stable identity within its `PhysicalObject`, independent
of its current bay. Module endpoint definition keys are interpreted within that
installation, so two installations of the same template have distinct canonical
endpoints. Moving an installed module to another compatible bay preserves the
installation and all its canonical endpoint identities. Existing Connections
and Cables do not break merely because presentation placement changes.

## Editing, revisions, and persisted review

Versioning is an internal mechanism for safe template updates. The user edits
one template through the ordinary **«Изменить шаблон»** action; the system
creates a new immutable revision internally. Version numbers are not the
primary user workflow. Published revisions and historical snapshots retained
in the product model remain immutable.

Editing uses a **persisted server-side draft**. Checking changes freezes a
candidate revision and produces impact analysis for existing `PhysicalObject`s.
The draft, frozen candidate, analysis, and update workflow survive application
navigation, reload, and returning later. Returning to editing invalidates the
previous analysis; checking the edited draft must freeze a new candidate and
recalculate impact before using that result. Analysis must reflect the objects
being updated; a stale result cannot authorize a data-losing update.

This is a semantic persistence and review contract, not a schema or API design.

## Safe updates of existing objects

An update may be applied automatically when NetMap can bring the object to the
new revision **without losing existing user or canonical information**.
Automatic does not mean silently deleting dependencies or recreating identity.
Preserve existing instance data and canonical identities when reconciling
unchanged logical definitions; template presentation edits do not overwrite
unrelated object data.

| Change | Existing-object outcome |
| --- | --- |
| Add endpoint or bay | Automatic addition |
| Rename, move, or resize presentation geometry | Automatic; preserve existing user/canonical information and identity |
| Delete an empty bay | Automatic |
| Delete an occupied bay with a free compatible bay available | Automatic deterministic relocation of the existing installation |
| Delete bays when remaining compatible capacity cannot hold all installations | Object requires attention; retain the previous revision and configuration |
| Delete an unused endpoint with no user/canonical dependencies | Automatic |
| Delete an endpoint with canonical or user-data dependencies | Object requires attention; retain the previous revision and data |

“Unused” requires absence of dependencies, not merely absence of an external
Cable. Existing Connections, bindings, and user data must be considered; no
exhaustive dependency schema is introduced here.

Bays with equal compatibility are interchangeable for automatic relocation.
Preserve placements that remain valid, then use a stable deterministic order
of opaque installation and bay keys to assign displaced installations to free
compatible bays. Do not derive the assignment from labels, numbering,
coordinates, or presentation order. Where all installations can be preserved,
NetMap selects that deterministic placement without asking the user to choose
among equivalent bays. User intervention is required only when all data cannot
be preserved automatically. An insufficient-capacity update does not partially
discard installations or endpoints.

## Publication and objects requiring attention

Problem objects do not block publication of a new revision:

- the published revision becomes current for newly created objects;
- automatically compatible existing objects may be updated safely;
- other objects stay on their previous immutable revision, preserving their
  configuration and data, with explicit **«требуется обновление»** status;
- the persisted update workflow lists those objects and the concrete reasons
  requiring attention, so the user can return and resolve them later.

Publication is not proof that every existing object has been updated. Keeping
an object on an earlier revision is retained product provenance, not a legacy
authoring/runtime compatibility layer.

The same draft, frozen-candidate, impact, publication, and safe-update principles
apply to module templates. A newly published module revision becomes current
for new installations; adding an endpoint can propagate automatically to
existing installations. Deleting an endpoint with dependencies requires repair
of the concrete affected objects. Affected installations retain their previous
revision and canonical endpoints until a safe update is possible; the object
receives the update-required status and appears in the persisted workflow.
Unaffected installations may update without blocking module publication.

## Pre-production cutover and migration history

NetMap is pre-production. Preserving current development `ObjectBlueprint`
records and test configurations is not a requirement. Future implementation
may use a destructive representation cutover and reset the development DB.
Do not design dual representations, compatibility adapters, legacy authoring
parsers, or migration of old Blueprint records solely to preserve test data.
Protection of canonical user/network information and immutable snapshots
retained in the product model does not revive obsolete development contracts.

During that destructive cutover, accumulated migration history may be collapsed
into a current clean schema initialization **if the actual repository and
database deployment state permits it**. This does not authorize editing an
applied Alembic revision and expecting a persistent database to replay it.
Databases that must be retained still require immutable applied revisions and
new forward migrations. Determine that boundary from actual repository state
in the implementation milestone. The implemented 09.6-A boundary uses that
authorized destructive cutover and fresh initialization, as described above.

## OPEN and outside this contract

- Endpoint technology/capability semantics: Ethernet, Fibre Channel, speed,
  connector, and other semantic properties.
- Global endpoint color/shape visual rules.
- Dense runtime Map LOD and endpoint marker presentation.
- Nested modules.
- Hardware inventory such as CPU, RAM, disks, and PSU.
- Exact mechanical compatibility of real equipment.

The module/bay compatibility value does not decide endpoint technology or
physical link compatibility. This redesign adds no speculative capabilities,
closes no old `C-*` findings automatically, and does not expand the pre-L2
roadmap beyond the accepted base-template/module/update redesign. Phase C can
resume only after its bounded implementation, external review/acceptance, and
manual HV-01 recheck; it is neither complete nor PASSED.
