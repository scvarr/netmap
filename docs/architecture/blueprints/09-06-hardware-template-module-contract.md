# 09.6 Hardware templates and object module installations

## Status and authority

**ACCEPTED / AUTHORITATIVE TARGET CONTRACT; 09.6-A IMPLEMENTED IN MAIN
(separate external acceptance not verified). 09.6-C, D1 AND D2 IMPLEMENTED,
EXTERNALLY ACCEPTED AND MERGED INTO MAIN; 09.6-E1 IMPLEMENTED ON THE WORKING
BRANCH, EXTERNAL REVIEW PENDING; E2/E3 REMAIN OPEN.**

Status consolidated against main `053e5798bb53d095c1627551ca71a1b2e65aeaff`.
C/D1/D2 external acceptance is confirmed by the status-consolidation task;
repository history contains C through `1e73331`, D1 through `f2206a1`, and D2
through `053e579` (including review corrections). The A implementation and its
corrections are present from `009e4a0` through `bcf8414`; the
[A validation record](09-06-a-validation.md) does not establish a separate final
external acceptance. IMPLEMENTED describes delivered behavior; ACCEPTED here
means external branch review, not manual user acceptance of HV-01 or Phase C.

Current capability boundary: creation and module installation/removal, base
draft/check, BaseTemplateRevision publication and safe PhysicalObject updates
are implemented. The agreed E1 slice adds ModuleTemplate editing, saved drafts
and advisory installation impact checks on the working branch. Publication of
subsequent module revisions and updates of installed modules remain **OPEN
(E2/E3)**; E1 does not implement or accept those slices.

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
  first immutable revision. D1 adds explicit checked-candidate publication.
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
- Users can explicitly remove one installed module by stable installation ID:
  `DELETE /v1/topology/physical-objects/{object_id}/module-installations/{installation_id}`.
  The object/configuration/installation are validated and locked in installation
  lock order. One transaction preflights dependencies and removes only that
  installation's mappings, expected physical bindings/ownership, endpoint aliases,
  materialized interfaces/points and installation, then returns current configuration.
  The bay becomes free; ModuleTemplate/revision and other installations remain.
  Any Connection (including within the same object, and Cable-backed connections),
  L2/L3 binding, upper/lower realization, unexpected physical binding or owner,
  other definition mapping, or external endpoint metadata blocks the operation
  with 409 `MODULE_INSTALLATION_IN_USE` and blocker counts. Supported persisted
  interface references in Security/NAT/processing attachment scopes and routing
  policy predicates also block. Endpoint row locks protect FK references; SHARE
  locks cover those four JSON reference tables through preflight/deletion.
  This does not implement module movement, relocation or template editing.
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

Workspace exchange is **v5 only**, explicitly including base templates and
revisions, panels, built-in definitions and internal links, bays, module
templates and revisions, ordered module definitions, configurations,
installations, both endpoint mapping tables, persisted base drafts and frozen
candidates with their impact results, immutable revision names and publication receipts. Canonical,
authoring/configuration and map-presentation sections remain separate. v3
and v4 imports are rejected; v5 round-trip preserves pinned revisions, canonical
IDs and authoring review snapshots.

The historical 09.6-A cutover introduced **0001 current schema initialization**,
including the CableLabelSettings singleton. 09.6-C adds forward migration
**0002**; D1 adds **0003** for immutable revision names and publication receipts. Both preserve existing databases; applied 0001/0002 remain unchanged.

**D2 implements safe base-revision reconciliation and automatic module relocation.**
Module revision updates and arbitrary user movement remain outside the implemented
boundary (09.6-E). Dense Map LOD and endpoint technology semantics remain
open. C/D1/D2 have passed external inspection; manual HV-01 rechecking and
acceptance are still required. This implementation does not accept or resume Phase C.

## Implemented boundary: 09.6-C

**09.6-C IMPLEMENTED / ACCEPTED / MERGED — persisted drafts, frozen candidates and impact analysis.
09.6-D1 IMPLEMENTED / ACCEPTED / MERGED — publication.
D2 IMPLEMENTED / ACCEPTED / MERGED — safe object reconciliation.**
External acceptance of these slices does not complete Phase C or HV-01.

- Library **«Изменить шаблон»** opens the existing `BaseTemplateEditor`. The
  server initializes one draft from the latest published revision, then restores
  that draft on subsequent visits. A draft contains full properties, panels,
  built-in definitions, unordered internal-link pairs and bays. Existing opaque
  keys are preserved; editor additions generate UUID keys. Panel numbers do not
  determine identity or require retaining an empty original panel.
- `GET /v1/library/base-templates/{id}/draft` opens/initializes a draft;
  `PUT .../draft?expected_generation=N` saves it. Concurrent stale writes return
  409. **«Сохранить черновик»** confirms success and retains local edits on error.
  These operations never create or change a published revision.
- `POST .../draft/check?expected_generation=N` freezes a separate candidate,
  compares definitions by opaque key (internal links by unordered endpoint keys),
  and persists structural differences and per-object impact results. Candidates
  have no edit API. All objects pinned to any revision of this base are analyzed
  against their own pinned definitions and actual configurations.
- Bay assessment preserves compatible existing placements, then proposes free
  compatible bays in lexicographic installation-ID / bay-key order. Compatibility
  remains exact and case-sensitive. Insufficient capacity requires intervention.
  Proposed placements are evidence only; no installation moves.
- Endpoint removal checks all persisted direct ConnectionPoint/NetworkInterface
  FK references and canonical JSON fields, including Connections, bindings,
  interface realizations and policy references. Only the endpoint's own mapping,
  expected physical owner/binding and unchanged generated aliases are exempt.
  Changed aliases are user data. Endpoint kind changes, missing mappings and
  continuity changes touching Connections conservatively require intervention.
- A candidate records its exact definition, draft generation and SHA-256 of
  canonical/authoring inputs. REPEATABLE READ makes review reads coherent without global SHARE locks.
  Saving advances the generation and invalidates prior review. Reading review
  recomputes input freshness; any canonical/configuration change invalidates it.
  This deliberately conservative workspace-wide fingerprint may also invalidate
  review after unrelated edits. Presentation-only map state is excluded.
- The client suppresses conclusions for local unsaved edits, stale results,
  failed or pending revalidation. It revalidates on focus and every 15 seconds;
  text explicitly describes the last checked state, never a live safety guarantee.
- Workspace v5 stores `BaseTemplateDraft` and `BaseTemplateCandidate` in
  `authoring`. Import validates source ownership, definitions and analysis shape;
  the regular coherent export, transactional import and dependency ordering apply.

At the C boundary, publication, canonical reconciliation, object update status, ModuleTemplate
editing and module revision updates were unimplemented. D1 adds publication and derived status;
D2 adds safe base reconciliation below. See
[09.6-C validation](09-06-c-validation.md).

## Implemented boundary: 09.6-D1

**D1 IMPLEMENTED / ACCEPTED / MERGED. D2 is implemented below.
Phase C PAUSED; HV-01 remains incomplete.**

- Explicit **«Опубликовать»** posts the frozen candidate ID to
  `POST /v1/library/base-templates/{id}/candidates/{candidate_id}/publish`.
  The server revalidates ownership, saved draft generation/definition, latest
  source revision and the exact review fingerprint immediately before writing.
  Stale requests return 409 with a concrete reason and `recheck_required=true`.
- One transaction creates the immutable revision's properties (including its
  own name), panels, built-in definitions, links and bays, preserving opaque
  keys. The highest version number remains the current-revision selector.
  Publication receipts uniquely bind one candidate to one revision; retries
  return the receipt even after further edits, without creating or resetting
  anything. Candidates remain unchanged. The draft advances to the new source
  revision and generation atomically.
- Publication uses READ COMMITTED with SHARE ROW EXCLUSIVE locks on the
  canonical/authoring fingerprint inputs, acquired in dependency order before
  revalidation and held until commit. These locks serialize publishers and
  prevent input writers from committing between fingerprint validation and
  publication. Draft saves/checks serialize through existing template/draft row
  locks. Deadlock/serialization failures have bounded transaction retries.
  Ordinary draft reads/checks retain non-blocking REPEATABLE READ snapshots.
- Existing configurations, built-in/module mappings, installations, canonical
  endpoints, Connections/Cables and user data are never updated. Objects created
  from the base select its current published revision through the existing path.
- Library/editor status derives the count of earlier-revision objects and
  separately shows those awaiting update and those requiring intervention,
  using their actual pinned definitions/configurations and current facts.
  These read results are advisory; D1 introduced no persisted status flag, update
  execution or conflict-resolution mechanism. Published candidate completion
  remains visible on reopening.
- Forward migration **0003** backfills revision names and adds immutable
  publication receipts. Workspace **v5** includes these necessary authoring
  fields/records, validates receipt ownership and candidate/revision equality,
  and preserves receipts, pinned configurations and the rebased draft on
  round-trip. There is no canonical or presentation format cutover.

See [D1 validation](09-06-d1-validation.md). Publication alone neither updates
objects, resumes Phase C nor completes HV-01.

### Workspace v5 archive compatibility (D1 corrective)

Exports always use the current explicit v5 shape: every BaseTemplateRevision
has its immutable `name`, and `BaseTemplatePublication` is present, including
when empty. Import additionally accepts exactly the historical 09.6-C shape
exported by main `1e733319`: that collection is absent, every base revision
lacks `name`, and only initial (`version_number=1`) base revisions exist.
For that profile alone, revision names are restored from each owning
BaseTemplate's name and publications are empty. Draft/candidate definitions,
fingerprints, IDs, configurations, canonical facts, SavedMaps and other data
are preserved as recorded. Import does not rewrite the supplied archive.

The two shape changes must occur together; mixed/partial shapes, unknown or
other missing fields/collections remain errors. Later base revisions cannot
be disguised as C archives by stripping receipts and names. In the current
shape, every noninitial base revision requires exactly one receipt, and all
existing receipt FK/ownership/source/candidate-content checks remain strict.
This is a bounded v5 archive compatibility contract, not a general version
migration framework or an obsolete runtime/authoring API. Applied migrations
0001/0002/0003 remain unchanged; no database migration or reset is required.

## Implemented boundary: 09.6-D2

**D2 IMPLEMENTED / ACCEPTED / MERGED. Phase C PAUSED;
HV-01 remains incomplete, not PASSED.**

- Explicit **«Обновить совместимые объекты»** in the base editor calls
  `POST /v1/library/base-templates/{id}/reconcile`. Each object returns
  `updated`, `already_current`, or `requires_intervention` with concrete reasons.
  Every object commits independently; an error or busy object cannot roll back
  successful peers. The batch targets the published revision selected at start;
  if another publication intervenes, remaining objects refuse and can be retried.
- Reconciliation compares the actual pinned revision directly to that target by
  opaque keys, including skipped revisions. Surviving built-in mappings retain
  their IDs and change only `definition_id`; points, interfaces, Connections,
  ownership/bindings, realizations, policies and all aliases/user data survive.
  Definition renames never infer alias provenance or overwrite existing values.
  New endpoints receive the usual point/interface/owner/binding/mapping rows.
  Kind changes, foreign/missing mappings and ambiguous identity refuse the object.
- Removing an endpoint requires the full current direct-FK and canonical-JSON
  dependency check. Only its own mapping, expected physical binding/owner and
  unchanged default alias materialization are exempt, as in C's preflight.
  Modified aliases and all other metadata/dependencies block deletion. Unknown
  JSON references (including keys and embedded/case-varied UUID strings) fail
  closed. Existing Connections are never deleted by reconciliation.
- Valid module placements remain. Displaced installations receive free bays of
  exact compatibility in stable installation-ID/bay-key order; insufficient
  capacity refuses the whole object. Swaps use transaction-private temporary
  bay keys to satisfy the immediate unique constraint. Only the final necessary
  `bay_key` changes persist; installation IDs, pinned module revisions,
  orientations, mappings and canonical endpoints/data stay intact.
- Changed internal links touching existing Connections conservatively refuse
  the object: materialized Connections have no retained link provenance.
  Additions require free cardinality=1 canonical points and valid member pairs;
  ordinary repository creation enforces the existing connection constraints.
  Unchanged links never trigger rematerialization or speculative provenance.
- READ COMMITTED preflight occurs after locks, independently of C/D1 review.
  Lock order is base root SHARE, object/configuration/installation/mapping rows,
  then interfaces and points in stable ID order. Object/configuration locks
  serialize install/uninstall. Endpoint UPDATE locks stop new FK dependents;
  current direct dependency row locks also stop alias/binding/owner edits that
  do not change a FK. Only endpoint deletion takes SHARE locks on every canonical
  JSON table, in workspace dependency order, because JSON references have no FK.
  Additive/presentation updates take no global writer locks. A 1500ms lock timeout
  or deadlock/serialization conflict rolls back that object and returns a retry
  reason; no partial materialization/relocation can commit. Session identity state
  is discarded between object transactions so retained ORM rows cannot authorize
  a later object's writes. Success is returned only after commit.
- Current/waiting/intervention state is derived afresh from ObjectConfiguration
  and current dependencies, including after reload. The editor shows object
  outcomes and localized reasons; unsaved authoring edits survive an update or
  failed request. No status column, workflow schema or migration is introduced.
  Workspace v5 and the bounded C archive compatibility stay unchanged; updated
  and blocked objects, modules and canonical data round-trip together.

At the D2 boundary, module authoring/publication, installation revision upgrades,
a manual conflict editor and arbitrary movement remain outside D2. See
[D2 validation](09-06-d2-validation.md). No next milestone or Phase C resumption
is included.

## Implemented boundary: 09.6-E1 (external review pending)

- Library **«Изменить шаблон»** opens the module editor for name, exact open
  compatibility and ordered endpoints. Rename/reorder preserve opaque keys;
  additions receive new UUID keys. No module canvas is introduced.
- `GET /v1/library/module-templates/{id}/draft` initializes/restores one server
  draft from the current revision. `PUT .../draft?expected_generation=N` saves
  the definition and advances generation. Stale saves/checks return 409
  `DRAFT_CONFLICT`; failed saves retain local input.
- `POST .../draft/check?expected_generation=N` appends an immutable candidate
  containing definition, source revision, draft generation, SHA-256 input
  fingerprint, structural changes and one impact entry per ModuleInstallation.
  All installations of the root template are included, even on older revisions.
  Each entry identifies its PhysicalObject, installation, pinned source revision
  and current bay, with concrete reasons for intervention.
- Endpoints match only by `definition_key`. Rename/reorder/addition are
  potentially safe. Kind changes require intervention. Removal reuses D2's
  direct FK and canonical JSON dependency inspection, exempting only the own
  mapping, expected materialization and unchanged generated aliases. Missing or
  invalid materialization requires intervention. Compatibility must equal the
  current bay value exactly, including case and whitespace. E1 proposes no move.
- Review uses C's coherent REPEATABLE READ snapshot/retry and conservative
  workspace-wide canonical/authoring fingerprint. Save invalidates the previous
  generation; canonical/configuration/installation changes invalidate the
  fingerprint. Both base and module draft/candidate tables are excluded from
  review inputs and base publication input locks, so module authoring alone does
  not invalidate BaseTemplate checks. Map presentation remains excluded.
- The client revalidates on focus and every 15 seconds. Unsaved edits, pending
  or failed revalidation, generation conflicts and stale server results suppress
  conclusions. The visible result describes the last verified snapshot.
- Forward migration **0004** adds ModuleTemplateDraft/ModuleTemplateCandidate;
  applied 0001–0003 are unchanged. Workspace remains **format_version=5** and
  exports both new collections explicitly under `authoring`. Import accepts
  earlier v5 archives only with both module review collections absent; a missing
  single collection, unknown fields or malformed definitions/results are rejected.
  Historical 09.6-C revision-name/publication handling remains supported. Review
  ownership, generation, fingerprints and nested analysis shapes are validated;
  canonical IDs, pinned revisions and frozen review snapshots round-trip.

E1 never publishes a ModuleTemplateRevision, updates an installation or changes
canonical endpoints, Connections or user data. E2/E3, manual conflict resolution,
Phase C, HV-01 and spatial presentation remain outside this slice. See
[E1 validation](09-06-e1-validation.md).

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

## Installed endpoint names (09.6-A)

`ModuleEndpointDefinition.display_name` is the local endpoint name within a
module revision. It does not need to be unique across the owning PhysicalObject.
Spatial object/blueprint presentation labels use this local name.

Detached lists, physical object cards, interface bindings, endpoint pickers and
connection details use the derived name `Panel / Bay / Endpoint`, with the exact
current display names of PresentationPanel, ModuleBay and ModuleEndpointDefinition.
One server read resolver follows ModuleEndpointMapping → ModuleInstallation →
the configuration's current ModuleBay → PresentationPanel and the definition.
It batches these joins and exposes installation ID, panel/bay keys and names,
local/contextual names and canonical ConnectionPoint/NetworkInterface IDs.

The configuration document's installed endpoints explicitly expose
`local_display_name` and `contextual_display_name`; the ambiguous installed
endpoint `display_name` field is removed. Template definitions and graphical
presentation slots retain `display_name` with local semantics.

Contextual names are derived read context, never canonical identity, installation
identity, persisted columns or EntityMetadata aliases. Existing materialization
may retain the local definition name as a canonical display alias. Renaming a
panel/bay in read state recalculates the path without changing endpoint IDs.
There is no global numbering, naming-template editor or installation movement
in this correction; later C/D1/D2 delivery is recorded above.

## OPEN and outside this contract

- Publication of subsequent ModuleTemplateRevision records and updates of
  installed modules (09.6-E2/E3). E1 editing/review is implemented on the working
  branch and awaits external inspection.
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
