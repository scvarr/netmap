# 09.6-D1 validation — BaseTemplate candidate publication

## Subsequent status consolidation (2026-10-17)

D1 (including its archive correction through `f2206a1`) is IMPLEMENTED,
externally ACCEPTED and merged
into main. External acceptance is confirmed by the status-consolidation task;
the cited commits are ancestors of main `053e579`.

This subsequent status does not constitute manual user acceptance: Phase C
remains PAUSED, HV-01 is not PASSED and requires manual recheck, and individual
C-* findings remain unchanged. ModuleTemplate editing/publication/updating
remains OPEN. See the [current 09.6 contract](09-06-hardware-template-module-contract.md).

## Original validation record (historical)

The record below retains its original implementation-time statuses, scope and
check results; references to pending inspection or later unimplemented slices
are historical, not the current series status.

**D1 IMPLEMENTED, AWAITING EXTERNAL INSPECTION.**
**D2 OPEN** — safe updates of existing PhysicalObjects.
**Phase C PAUSED; HV-01 incomplete.** No merge or D2 work is included.

Baseline: `1e73331921e08ca6992a9c1bff3a6a7e7f8f4726`.
Branch: `09-06-d1-base-template-publication`; initially clean at the baseline.

## Contract evidence

- A saved, checked candidate publishes all properties/panels/endpoints/links/bays
  into a new immutable revision with preserved opaque keys. Names now belong to
  revisions, so subsequent renaming cannot rewrite old revision detail.
- Ownership, exact saved draft generation/definition, current source revision
  and fingerprint are checked again in the publication transaction. Stale
  requests return a specific reason and require another check.
- READ COMMITTED publication locks its canonical/authoring fingerprint inputs
  through commit. SHARE ROW EXCLUSIVE serializes concurrent publishers without
  a lock-upgrade race. Existing draft GET/check retain non-blocking REPEATABLE
  READ. The library also reads revision/status from one coherent snapshot.
- Unique immutable receipts make same-candidate retries idempotent, including
  after further canonical changes or saved drafts. Different concurrent
  candidates produce one revision and one stale rejection. An injected failure
  after revision creation rolls back the revision, receipt and draft together.
- Existing canonical facts (including a connected Cable and user label),
  configurations, mappings, installed modules, settings and presentation remain
  byte-for-byte equivalent in workspace exports. New objects select the newest
  published revision through the unchanged current-revision selector.
- Earlier-revision counts and awaiting/intervention classifications are derived
  from pinned definitions and current facts. Problem objects do not block
  publication. There is no update/apply/relocation/conflict-resolution action.
- The draft advances atomically to the new source revision and generation.
  Candidates remain unchanged; publication completion is derived from their
  receipts and visible after reopening.
- Forward migration `0003` backfills immutable revision names and creates
  publication receipts. Applied `0001/0002` are unchanged. Workspace v5 exports
  and imports the new authoring fields/receipts, with ownership/source/content
  validation, preserving published state, retries and the rebased draft.

## Targeted checks (Docker, 2026-10-16)

- `docker compose -f compose.test.yaml exec -T test-backend pytest -o addopts= tests/test_base_template_publication.py tests/test_base_template_review_concurrency.py tests/test_base_template_review.py tests/test_hardware_configuration.py tests/test_workspace_portability.py tests/test_workspace_compatibility.py -q --tb=short`
  — **57 passed**: 13 publication tests, 24 review/concurrency tests, 20
  configuration/workspace tests.
- Publication concurrency tests use independent real PostgreSQL transactions:
  simultaneous identical/distinct requests, a canonical writer blocked after
  fingerprint capture, and publication committed between library catalog/status
  reads. Ordinary review GET still permits a concurrent canonical writer.
- `docker build --target build -t netmap-d1-frontend-check frontend`
  — **PASS**, TypeScript and production build; existing large-chunk warning.
- `docker run --rm netmap-d1-frontend-check npm test -- src/pages/EditBaseTemplatePage.test.tsx src/pages/HardwareConfiguration.test.tsx`
  — **16 passed**. Covers explicit publication, unsaved/stale/pending blocking,
  rejection retention, persisted completion, subsequent draft generation and
  library counts with separate waiting/intervention states.
- Existing persistent Docker database upgraded `0002 → 0003`, without reset or
  volume deletion. Canonical, presentation and settings exports before/after
  were identical. `alembic current`: **0003 (head)**; `alembic check`: **no new
  upgrade operations**.
- Full backend/frontend suites were not run: the affected bounded contracts
  have targeted coverage. The first frontend attempt mounted Windows native
  dependencies into Linux and failed to load a native binding; tests/build then
  passed using the Docker build stage's pinned Linux dependencies.

## Browser scenario

Real Docker frontend/backend, in-app browser, 2026-10-16:

1. Created `09.6-D1 browser publication` with one network port, width 160.
2. Created `D1 preserved first object` from revision 1.
3. Edited width to 220 and added a second port; saved the draft and checked
   changes. The existing object's analysis was potentially safe.
4. Published explicitly and observed revision 2, publication completion,
   one object awaiting update and zero requiring intervention.
5. Compared complete canonical exports and existing ObjectConfiguration,
   BuiltInEndpointMapping, ModuleInstallation and ModuleEndpointMapping before
   and after publication: **identical**. Revision 1 remained width 160;
   revision 2 was width 220. The first object remained pinned to revision 1.
6. Opened the old object's Physical and Interfaces tabs: its original port,
   interface and physical binding remained available.
7. Created `D1 current second object`: it pinned revision 2 and displayed two
   ports/interfaces. Library count of earlier-revision objects remained one.
8. Reopened the editor, including after container recreation/reload: width 220,
   two definitions, new source revision and persisted publication completion.

Browser template ID: `6b58bc05-b935-4d18-a960-cf27832f2562`.
Old object: `bb8aaf97-6d38-4918-a025-75c00e778dc1`.
New object: `f5d9ce77-cde8-4f90-a35d-8757c6963fb6`.

## Change inspection and limits

The final diff was reread; `git diff --check` passed. GitNexus final staged
`detect_changes` inspected **17 files / 90 symbols / 24 affected flows**, with
no partial/truncated inspection result, against `E:\Projects\netmap` at the
stated baseline. Aggregate graph risk is **critical** because authoring/import/
read flows share affected symbols; this is not external acceptance. An initial
FTS failure was repaired and the final graph rebuilt successfully. The graph's
process inventory has traversal limits; targeted source inspection and the
behavioral tests above supplement it.

The inherited fingerprint is deliberately workspace-wide. Unrelated
canonical/authoring edits may require another check. Publication briefly blocks
writers to those inputs, and derived intervention analysis can be expensive for
large libraries. Ordinary reads do not acquire global SHARE locks. D1 does not
implement safe object updates, module movement or ModuleTemplate publication.
External inspection and the separate HV-01 acceptance remain outstanding.

## Bounded corrective after review of 25789a3 (2026-10-17)

The reviewed D1 exporter added revision names and publication receipts while
retaining format v5, but its strict importer rejected real 09.6-C v5 archives.
This correction defines two exact v5 archive profiles. Exports remain in the
current explicit shape. Only a complete C shape (no publication collection,
no revision names, initial base revisions only) receives the bounded import
adaptation: each revision's name comes from its owning BaseTemplate, and
publications are empty. Mixed shapes, unknown fields and missing unrelated
collections are rejected. Current noninitial revisions require exactly one
receipt; FK/ownership/source/content checks remain active.

Evidence uses an actual archive produced by the unchanged exporter at main
`1e73331921e08ca6992a9c1bff3a6a7e7f8f4726`, on schema **0002** in the separate
Docker project `netmap-c-archive-fixture`. The source was extracted with
`git archive`; this branch was not switched. The committed fixture and its
reproduction instructions are in `tests/fixtures/workspace_09_6_c_v5.json`
and `tests/fixtures/README.md`. It contains synthetic connected topology, an
ObjectConfiguration, SavedMap/placements/routes/annotation, settings and a saved
draft/candidate whose name deliberately differs from the published root name.

Correction validation, isolated Docker/PostgreSQL schema **0003**:

- `docker compose -f compose.test.yaml exec -T test-backend pytest -o addopts= tests/test_workspace_portability.py tests/test_base_template_publication.py -q --tb=short`
  — **38 passed** (25 workspace tests and 13 existing D1 publication tests).
- Real C archive import succeeds; subsequent exports preserve every old
  record and identifier exactly, including immutable review fingerprints,
  pinned configurations and all canonical/presentation/settings sections.
  Only revision names and the explicit empty receipt collection are added.
  The supplied archive is not mutated. Re-import into a nonempty dataset
  remains forbidden and does not change its data.
- The imported C dataset can publish through the unchanged D1 workflow and
  round-trip again with its receipt intact. Canonical topology, SavedMaps and
  existing ObjectConfiguration remain identical throughout.
- Negative cases cover mixed C/current shapes, missing unrelated collections,
  later revisions disguised as C, missing/empty/null receipts, nonexistent
  candidate/revision references, foreign ownership, wrong source, mismatched
  candidate content, duplicate receipts/revision assignments and unknown fields.
  Rejected imports leave the destination dataset unchanged.
- `alembic current` — **0003 (head)**. Applied migrations 0001/0002/0003,
  publication transaction/locks/idempotency, impact analysis, UI and
  ObjectConfiguration code are unchanged. No user database reset or migration.
- `git diff --check` — **PASS**. Targeted import impact analysis is LOW;
  staged GitNexus `detect_changes` covers **6 files / 15 symbols / 4 import
  flows**, aggregate risk **medium**, with no partial/truncated result.
  Index path and baseline match this working tree and reviewed SHA.
  Full suites/frontend checks/browser runs are unnecessary for this import-only
  correction and were not run. D2 remains OPEN, Phase C PAUSED, HV-01 incomplete.
