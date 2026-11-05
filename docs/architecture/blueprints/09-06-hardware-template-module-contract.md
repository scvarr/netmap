# 09.6 Hardware templates and object module installations

## Status and authority

**ACCEPTED / AUTHORITATIVE TARGET CONTRACT; 09.6-A — IMPLEMENTED в main
(отдельная внешняя приёмка не подтверждена). 09.6-C, D1, D2 и E1 —
IMPLEMENTED / ACCEPTED / MERGED. E2 — IMPLEMENTED / ACCEPTED / MERGED; E3 — IMPLEMENTED / ACCEPTED / MERGED.**

Статус актуализирован по `main` (base E3): `cf3a0c35f0a89ca0e0f0fa2e54fe561463c0fbbe`.
09.6-E1: **IMPLEMENTED / ACCEPTED / MERGED**, включая исправления внешнего ревью.
C/D1/D2 external acceptance is confirmed by the status-consolidation task;
repository history contains C through `1e73331`, D1 through `f2206a1`, and D2
through `053e579` (including review corrections). The A implementation and its
corrections are present from `009e4a0` through `bcf8414`; the
[A validation record](09-06-a-validation.md) does not establish a separate final
external acceptance. IMPLEMENTED describes delivered behavior; ACCEPTED here
means external branch review, not manual user acceptance of HV-01 or Phase C.

Current capability boundary: creation and module installation/removal, base
draft/check, BaseTemplateRevision publication and safe PhysicalObject updates
are implemented. E1 добавляет редактирование ModuleTemplate, сохранённые черновики
и рекомендательные проверки влияния на установки; реализация принята и включена
в main. Публикация последующих ревизий модулей (E2): IMPLEMENTED / ACCEPTED / MERGED. Обновление установок (E3): IMPLEMENTED / ACCEPTED / MERGED.

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

## Будущие пользовательские характеристики портов

`BaseTemplate` и `ModuleTemplate` должны в дальнейшем поддерживать
[пользовательские справочники и характеристики портов](../../product/user-reference-catalogs.md).
Это согласованное pre-L2 направление, не IMPLEMENTED capability 09.6.
Пользовательский тип порта не заменяет `CONNECTION_POINT` / `NETWORK_PORT`;
значения совместимости module/bay не доказывают физическую link compatibility.
Действующее точное сопоставление module/bay здесь не меняется.

Опубликованные ревизии остаются immutable. Семантика ссылок из immutable
revision на изменяемый справочник — отдельный OPEN вопрос, который необходимо
согласовать до implementation contract; live lookup или snapshot здесь не
выбирается. C-CAP-01 остаётся отдельной confirmed gap. Phase C PAUSED;
HV-01 NOT PASSED.

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
Обновление ревизий установок (09.6-E3) реализовано ниже. Визуальная компоновка установок реализована ограниченным срезом F2b ниже.
Dense Map LOD and endpoint technology semantics remain
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

## Реализованная граница: 09.6-E1 — IMPLEMENTED / ACCEPTED / MERGED

Итоговый SHA: `b96dc43303b8925d8973e7e2078a6d93540add98`.
E2: IMPLEMENTED / ACCEPTED / MERGED. E3: IMPLEMENTED, внешняя приёмка ожидается. Phase C — PAUSED, HV-01 — не PASSED.

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

### Реализованное представление

До F1 шаблон модуля не имел собственной геометрии или графического редактора.
В F1 они реализованы; внешняя приёмка F1 ожидается. Геометрия установок относится к F2 (OPEN).
При установке пользователь выбирает горизонтальное или вертикальное
распределение портов. Координаты равномерно вычисляются из порядка портов,
ориентации и прямоугольника отсека, как описано в границе 09.6-A.
Перемещение и изменение размеров прямоугольника меняют представление,
сохраняя идентичность установки и конечных точек.

### Согласованное продуктовое направление: F1 IMPLEMENTED / ACCEPTED / MERGED; F2a IMPLEMENTED / ACCEPTED / MERGED; F2b IMPLEMENTED

F1 реализован ниже; описание свободной компоновки установки относится к открытому F2. Базовый шаблон
оборудования задаёт корпус, панели, встроенные порты и видимые отсеки для
установки модулей. Шаблон модуля получает собственную геометрию и расположение
портов относительно модуля; графическое редактирование следует общим принципам
редактора базовых шаблонов. Вложенные модули не предусматриваются.

При установке пользователь выбирает совместимый отсек. Модуль отображается
как самостоятельный визуальный элемент внутри PhysicalObject. Пользователь
может свободно менять положение и размеры установленного модуля; порты
масштабируются и перемещаются вместе с ним. Индивидуальное изменение положения
портов установленного экземпляра не предусматривается. Изменение визуальной
геометрии не означает физическое перемещение модуля в другой отсек.

Геометрия шаблона модуля отделена от геометрии конкретной установки.
Индивидуальная компоновка принадлежит представлению конфигурации PhysicalObject,
а не SavedMap. Геометрия не является источником канонической истины.
Сохраняются ModuleInstallation.id, идентификаторы конечных точек,
NetworkInterface, Connections и Cables. Совместимость отсеков остаётся открытым
пользовательским значением. Новые канонические сущности и отношения не вводятся.

После E2/E3 предусмотрено отдельное направление 09.6-F:

- F1: геометрия и графический редактор шаблонов модулей.
- F2: визуальная компоновка установленных модулей внутри PhysicalObject.

Контракты F1, F2a и ограниченного редактирования F2b реализованы ниже.
Конкретные таблицы, API, алгоритмы преобразования координат и правила переноса
пользовательской геометрии при обновлении ревизий здесь не определяются.
Существующие правила обновления базовых шаблонов ниже не задают такие правила
для будущей геометрии модулей. 09.6-F не входит в E2/E3, Dense Map LOD,
семантику технологий конечных точек или существующие замечания Phase C.

## Implemented boundary: 09.6-E2

E2 IMPLEMENTED / ACCEPTED / MERGED. E3 IMPLEMENTED / ACCEPTED / MERGED; F1 IMPLEMENTED / ACCEPTED / MERGED; F2a IMPLEMENTED / ACCEPTED / MERGED; F2b IMPLEMENTED.

- Module editor publishes only a saved, currently checked candidate through
  `POST /v1/library/module-templates/{id}/candidates/{candidate_id}/publish`.
  Ownership, latest source revision, generation, definition and workspace review
  fingerprint are revalidated under D1 dependency-ordered SHARE ROW EXCLUSIVE
  input locks in READ COMMITTED, with bounded transaction retries.
- One transaction creates the next immutable revision, its own name, exact
  compatibility and ordered endpoint definitions preserving definition keys;
  records a unique candidate/revision receipt; advances draft source/generation.
  Candidate stays unchanged. Repeated requests return the receipt without writes.
  Stale checks return concrete 409 reasons and `recheck_required=true`.
- New installations pin the latest revision with exact compatibility. Library
  lists one current revision per template. Historical revision names remain
  unchanged; current root name follows publication. No existing installation,
  mapping, canonical endpoint, Connection, Cable or user data is reconciled.
- Editor/library expose derived counts; editor lists outdated installations,
  their object, bay, pinned source and E1 reasons against that actual source.
  Diagnostics confer no update authorization and execute no update.
- Forward migration **0005** adds revision names and publication receipts;
  applied migrations remain unchanged. Workspace format remains **5**. Historical
  C/D1/D2/E1 archives without module publication/name fields are accepted only
  with initial module revisions. Current archives require names, receipts for
  every noninitial revision, matching candidate ownership/source numbering and
  exact ordered published definitions. Partial E2 profiles are rejected.

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

- Обновление установок (09.6-E3): IMPLEMENTED / ACCEPTED / MERGED. E2 IMPLEMENTED / ACCEPTED / MERGED. E1: IMPLEMENTED / ACCEPTED / MERGED.
- Геометрия шаблонов F1 и layout F2a: IMPLEMENTED / ACCEPTED / MERGED;
  ограниченное редактирование установок F2b: IMPLEMENTED.
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

## Implemented boundary: 09.6-E3

**E3 IMPLEMENTED / ACCEPTED / MERGED; F1 IMPLEMENTED / ACCEPTED / MERGED; F2a IMPLEMENTED / ACCEPTED / MERGED; F2b IMPLEMENTED.
Phase C PAUSED; HV-01 not PASSED.**

- «Обновить совместимые установки» calls POST
  /v1/library/module-templates/{id}/reconcile. The batch pins the latest
  published revision, processes installations sequentially with independent
  commits and returns updated, already_current, or requires_intervention
  with live reasons. A changed published target refuses remaining attempts.
- Definitions match only by definition_key within each installation, directly
  across skipped revisions. Retained mappings change only definition_id;
  installation ID, bay, orientation, canonical IDs, aliases, metadata and all
  existing user dependencies survive. Base revision provenance does not change.
- Added endpoints receive normal canonical materialization. Kind changes,
  incompatible current bays, missing/broken materialization and unsafe removal
  refuse the installation. No relocation or manual conflict resolution is added.
- Preflight runs under READ COMMITTED after module-root SHARE and
  object/configuration/installation/mapping locks. Interfaces precede points;
  retained owner/binding rows stay SHARE locked. Removal uses D2's complete
  direct-FK/JSON dependency checks, locks current direct references and all
  canonical JSON tables. Lock timeout/deadlock/error rolls back that installation.
  Cached E1/E2 analysis never authorizes a write.
- The editor shows individual results and reloads server diagnostics without
  replacing local unsaved definitions. Results are transient, with no stored status.
- Workspace remains format_version=5; existing revision/mapping provenance
  supports mixed revisions without schema additions or migrations.

Validation: Docker targeted E3 tests cover skipped revisions, identity,
addition/removal, refusals, independent rollback/success, retry, target change,
mixed-revision archive restore and concurrent FK/JSON/owner/binding writers.
D2 reconciliation/concurrency and E1/E2 review/publication regression tests,
targeted client tests, TypeScript/Vite build and diff checks are the boundary.
Full suites were not requested or run. Manual HV-01 and external acceptance
remain outstanding.


## Implemented boundary: 09.6-F1

F1 **IMPLEMENTED / ACCEPTED / MERGED**. E1/E2/E3:
**IMPLEMENTED / ACCEPTED / MERGED**. F2a **IMPLEMENTED / ACCEPTED / MERGED**; F2b **IMPLEMENTED**. Phase C **PAUSED**;
HV-01 is not PASSED.

- ModuleTemplateRevision owns one rectangular body: positive finite width and
  height, `#RRGGBB` fill_color, and finite normalized endpoint coordinates in
  [0,1], keyed by definition_key. Geometry is part of the definition and its
  immutable draft/check/candidate/publication workflow. Rename, reorder and
  body resizing preserve endpoint positions. Geometry changes appear in review
  and alone require no intervention.
- Creation and editing provide body properties, endpoint selection, group drag,
  horizontal/vertical alignment and distribution, zoom and fit view. Endpoint
  names, kinds and order remain form properties. Published geometry is visible
  in the library. Unsaved geometry participates in dirty state and survives
  failed requests and diagnostic refreshes.
- F1 never changes installation geometry: until F2, installed endpoints retain
  the ModuleBay/orientation/endpoint-order algorithm. Installation revision
  changes require explicit E3, preserving canonical identity by definition_key.
  No free-layout fields, panels or canonical entities are introduced.
- Forward migration **0006** adds revision geometry and deterministically extends
  historical revision/draft/candidate definitions: 240 × 80, #64748b, endpoint
  x=(i+1)/(N+1), y=0.5 in existing order. IDs, user edits, publication receipts
  and canonical data remain intact; migrations 0001–0005 are unchanged.
- Workspace format remains **v5**. New exports identify F1 with top-level
  `module_geometry_version=1`, so removing all geometry from a current export
  cannot disguise it as historical. Full historical profiles receive the same
  deterministic extension. Current F1 profiles require geometry throughout;
  mixed profiles and invalid geometry are rejected. Publication ownership,
  immutable candidate/revision equality, endpoint identities and installation
  mappings retain their existing validation.


## Implemented boundary: 09.6-F2a

F2a **IMPLEMENTED / ACCEPTED / MERGED**. F2b **IMPLEMENTED** (external branch inspection pending).
Phase C **PAUSED**; HV-01 is not PASSED.

- Installation `layout` belongs to ObjectConfiguration through its stable
  ModuleInstallation ID: panel_key and normalized panel-local x/y/width/height.
  This is presentation, with no canonical entities or SavedMap dependencies.
- Initial layout fits the F1 body inside its bay, preserving aspect ratio in
  panel units. VERTICAL rotates the complete image clockwise. Layout stays
  inside the bay's panel; visual placement never changes bay_key.
- Configuration reads batch panels, revisions and mappings, returning body
  layout/color and transformed F1 port coordinates by definition_key, retaining
  canonical endpoint IDs. PhysicalObject renders the installed body and ports.
- E3 preserves layout when updating the pinned revision. D2 retains layout
  when the bay remains on its panel, including bay rectangle changes. The panel of the final D2 proposed placement is checked against layout.panel_key.
  Reassignment to a compatible bay on the same panel preserves layout and IDs.
  A final bay on another panel returns MODULE_LAYOUT_PANEL_CONFLICT through
  analysis and fresh locked apply; missing capacity retains INSUFFICIENT_COMPATIBLE_CAPACITY; automatic cross-panel migration is not implemented.
- Forward migration **0007** deterministically fills existing installations.
  Applied 0001–0006 are unchanged. Workspace stays **v5** and adds
  module_layout_version=1. Historical archives lacking both marker and layout
  receive the same deterministic fit. Current incomplete or invalid profiles
  fail before writes. Saved layout round-trips unchanged.
- Interactive movement/resizing, per-port installation geometry, nested modules,
  SavedMap and Dense Map LOD remain outside F2a.


## Implemented boundary: 09.6-F2b

F1 and F2a **IMPLEMENTED / ACCEPTED / MERGED**. F2b **IMPLEMENTED**;
external inspection of the final branch diff remains required. Phase C **PAUSED**;
HV-01 **not PASSED**.

- PhysicalObject provides explicit adjustment mode, single body selection, bounded
  mouse/pointer movement and one corner handle for proportional resizing. Ports
  follow their F1 relative positions, including VERTICAL rotation. Normal view
  cannot move modules. Selection and handle are visible only in adjustment mode.
- Save, cancel and reset are explicit. Reset uses the current pinned bay, module
  geometry, orientation and panel dimensions through the F2a initial fit function.
  Draft layout stays local until save; errors retain draft and its expected server
  snapshot. A conflict never rebases or overwrites another session automatically:
  cancel and reload the object to obtain fresh configuration. Dirty selection
  cannot be replaced by another selection; cancel or save it first.
- PUT `/v1/topology/physical-objects/{object_id}/module-installations/{installation_id}/layout`
  accepts configuration_id, base_revision_id, module_revision_id, bay_key,
  orientation, expected_layout and layout. Exact expected-state comparison runs
  after object/configuration/installation UPDATE locks in the existing order.
  Revision, bay/orientation, configuration or layout mismatch returns 409 with
  a concrete reason. Lock timeout/deadlock/serialization failure returns controlled
  409; transaction rollback prevents partial writes. Invalid ownership, panel,
  coordinates or sizes return 422. Numbers must be finite, sizes positive and
  rectangle contained in its current bay panel. Extra request fields are rejected.
- Only installation.layout changes. Identical current requests do not write.
  Configuration response refreshes body and ports, and existing detail/projection
  refresh preserves unrelated page state. No schema, migrations, template editor,
  per-port tools, D2/E3 algorithm changes or SavedMap changes are introduced.
- Targeted Docker checks cover save, expected-state refusals, concurrent locked
  writers, canonical/mapping identity, rollback, idempotence and v5 round-trip;
  F2a tests retain E3/D2 guarantees. Client checks cover adjustment mode, selection,
  bounded movement, proportional resize, port projection, save/cancel/reset and
  retained drafts after server errors/conflicts. TypeScript/Vite and diff checks
  are required. Full suites and manual HV-01 are outside this acceptance evidence.

## Endpoint display name consistency correction (2026-11-04)

Built-in endpoint read names follow BuiltInEndpointMapping.definition_id and the
ObjectConfiguration pinned base revision. Publishing alone does not advance read
names; successful D2 reconciliation does. Shared EndpointNames resolves CP/NI
names in bounded batches for details, projection, connection peers and inventory.
Canonical aliases remain unchanged and are exposed as read-only canonical_label
in physical point details and shown under object technical details. Graphical
module names remain local; detached module names remain contextual.

Phase C remains PAUSED; HV-01 remains NOT PASSED. External inspection of this
correction is required; this change does not alter D2/E3 or canonical topology.

Validation: Docker/PostgreSQL targeted backend checks: 19 passed (new pinned-name
read test, hardware configuration/module naming, device details and catalog
inventory). Frontend: 24 passed (physical details/channel refresh, endpoint picker,
read adapter and derived base/module map menus/wiring source). Docker TypeScript
and Vite build passed; git diff --check passed. GitNexus detect_changes reports
critical reach through the shared read resolver; no incomplete result reported.
Full suites were not run. Browser verification of an existing two-panel 24-port
object was not performed; manual HV-01 and external diff inspection remain open.

## HV-01-UX-02A — Logical module places

**HV-01-UX-02A — DOCS IMPLEMENTED. Logical module places runtime — OPEN.
Phase C — PAUSED. HV-01 — NOT PASSED.**

[Продуктовый контракт логических модульных мест](../../product/logical-module-places.md) задаёт будущую
модель: панель, открытая совместимость и количество индивидуально идентифицируемых
мест без обязательного rectangle. Фиксированные отсеки допустимы. Контракт
разделяет целевую семантику, инварианты и OPEN решения миграции/размещения;
действующие IMPLEMENTED F1/F2/D2 не переписываются и runtime не объявляется готовым.
