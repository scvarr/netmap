# 09.6-D2 validation — safe PhysicalObject reconciliation

**D2 IMPLEMENTED, AWAITING EXTERNAL INSPECTION.**
**Phase C PAUSED; HV-01 remains incomplete, not PASSED.** No merge or next
milestone is included.

Baseline: `f2206a1cc3f65ddd1834e74471099ec689ae968f`.
Branch: `09-06-d2-safe-object-reconciliation`; initially clean at that baseline.

## Implementation evidence

- `POST /v1/library/base-templates/{id}/reconcile` targets the current immutable
  revision and processes all configurations of that base, with one independent
  transaction and outcome per PhysicalObject. Repeating it reports current
  objects without duplicate points/interfaces/mappings/installations/Connections.
- Old and target definitions match by opaque keys, directly across revision gaps.
  Retained mapping IDs and canonical endpoint IDs stay fixed. Definition renames
  preserve all aliases, including unchanged default aliases whose origin cannot
  be inferred. Surviving canonical dependencies are never rewritten.
- New point/network endpoints materialize with the regular ownership/binding
  semantics. Removal requires absence of Connections, other mappings, unexpected
  bindings/owners, upper/lower realizations, changed aliases, L2/L3 and every
  direct-FK/canonical-JSON reference. Unknown JSON shapes fail closed.
- Valid module placements survive; displaced installations move deterministically
  by stable IDs and exact compatible bay keys. Insufficient capacity aborts the
  whole object. Swaps preserve the same installation and module revision, mapping,
  orientation, canonical endpoint IDs, Connections and user data.
- No existing Connection is deleted. Changes to internal links touching live
  Connections refuse the object; additions require free cardinality=1 points.
  Unchanged authored links do not recreate missing canonical Connections.
- The write path ignores candidate safety conclusions. It rereads actual facts
  after object/configuration/installation/mapping and endpoint locks at READ
  COMMITTED. Direct dependency rows lock existing non-FK edits too. Deletion alone
  locks canonical JSON tables in SHARE mode to stop references without FK locks.
  Ordinary additive updates have no SHARE/SHARE ROW EXCLUSIVE table locks.
  Bounded lock conflicts are per-object retry outcomes; arbitrary apply/commit
  failures roll back before reporting failure or proceeding to peers.
- Actual object status and refusal reasons are derived after reload. Per-attempt
  outcomes are transient UI results, not persisted canonical status. No new
  storage/migration; applied 0001/0002/0003 and workspace v5/C compatibility are
  unchanged. Module revision upgrades and manual movement remain outside D2.

## Targeted checks (Docker/PostgreSQL, 2026-10-17)

`docker compose -f compose.test.yaml exec -T test-backend pytest -o addopts= tests/test_object_reconciliation.py tests/test_object_reconciliation_concurrency.py tests/test_base_template_review.py tests/test_base_template_review_concurrency.py tests/test_base_template_publication.py tests/test_hardware_configuration.py tests/test_module_uninstall.py tests/test_workspace_portability.py tests/test_workspace_compatibility.py -k 'not test_uninstall_removes_only_owned_aggregate_and_read_context' -q --tb=short`

- **137 passed, 2 deselected**, including **45 new D2 tests**. Coverage includes
  1→2 and revision skips; exact existing canonical/mapping IDs, aliases and
  Connections; both added endpoint kinds and safe removals; all dependency
  classes above; missing/foreign mappings and kind refusal; stable placements,
  deterministic relocation, bay swaps and capacity failure; internal-link safety
  and cardinality; whole-object rollback after partial materialization and after
  deletion/relocation/link creation; independent objects, idempotency and a
  combined updated/blocked/modular workspace round-trip.
- Real independent PostgreSQL writers cover Connection commits before endpoint
  locks, alias edits while preflight waits, FK/JSON/alias/binding writers after
  preflight, installation commits before object locking and uninstall contention.
  Other-object updates proceed during additive reconciliation; a busy object
  fails independently. Simultaneous retries materialize exactly once.
- The two deselected parameter cases are confirmed pre-existing obsolete test
  debt: unchanged `tests/test_module_uninstall.py:73` asserts workspace version
  **4**, already on the stated base. The implemented C/D1 contract and exporter
  already require **5**. The initial related run reported **92 passed, 2 failed**
  solely at that assertion. D2 changes neither that test nor the archive format.
  Its own uninstall concurrency and v5 round-trip checks pass. Scope was not
  expanded to restore v4 or repair unrelated test expectations.
- `docker build --target build -t netmap-d2-frontend-check frontend` — **PASS**,
  TypeScript and production build. Existing large-chunk warning remains.
- `docker run --rm netmap-d2-frontend-check npm test -- src/pages/EditBaseTemplatePage.test.tsx src/pages/HardwareConfiguration.test.tsx src/topology/objectReconciliation.test.ts src/i18n.test.tsx`
  — **24 passed**. Explicit action/POST, all per-object outcomes and localized
  reasons, current state after remount, failed-request retry, preservation of
  unsaved edits, rejection of a concurrent draft generation during result refresh,
  existing publication/module behavior and typed i18n are covered. Final source
  inspection caught the need to retain the old optimistic generation when another
  author saves during reconciliation; the client now uses the existing checked
  refresh instead of silently adopting that generation with stale editor content.
- Persistent runtime rebuilt through Docker without database reset or volume
  deletion. `alembic current`: **0003 (head)**; `alembic check`: **no new upgrade
  operations**. Existing runtime data retained.
- Full backend/frontend suites were not run: affected reconciliation, authoring,
  module and workspace behaviors have targeted coverage; no platform/schema
  change requires a full regression run.

## Browser scenario (real Docker frontend/backend)

Synthetic records were added through current APIs and bounded fixture setup;
existing user data was not cleared. In-app browser, 2026-10-17:

1. Base `09.6-D2 browser reconciliation` has two built-in network endpoints and
   one exact-compatible bay. Created `D2 Automatic`, `D2 Requires intervention`
   and `D2 Installed module` on revision 1; installed a vertical module in the
   third object. Two Cable-backed Connections join their endpoints. The automatic
   object's retained interface has a custom user alias.
2. Published revision 2: retained endpoint renamed, second endpoint removed,
   network and point endpoints added, old bay replaced by a compatible bay.
   Before reconciliation the editor showed **2 waiting / 1 intervention** with
   the existing Connection as the concrete refusal reason.
3. Clicked **«Обновить совместимые объекты»** in the browser. Automatic and modular
   objects returned **«Обновлён»**; the connected-endpoint object required
   intervention and retained revision 1. Other two configurations pinned revision 2.
4. Reloaded: two **«Актуален»**, zero waiting and one intervention with the same
   reason. Opened the module object's Physical tab: `Relocated bay` contains the
   same module, contextual endpoint name reflects the new bay, and the original
   cable to the blocked object remains connected. The automatic object's
   Interfaces tab shows `D2 user alias retained` plus the added network interface.
5. Compared full before/after workspace data: original Connections, members,
   Cable IDs/labels, surviving endpoint/mapping IDs and aliases remain intact.
   Installation changes only `bay_key`; module mappings/revision/orientation are
   identical. The blocked configuration and all its canonical rows are unchanged;
   unrelated configurations, settings and presentation are preserved.
6. Repeated the browser action: the two updated objects returned **«Актуален»**,
   the blocked object retained its reason, and the entire workspace export was
   byte-for-byte equivalent as decoded JSON to the post-first-update export.

Fixture identifiers:

- Base: `56b3c6ed-cb5d-44a1-a704-4f3530c39cdd`.
- Revision 2: `08f3c3d5-9d75-408a-895f-204fa62214e7`.
- Automatic: `19d80196-d5a4-4b6a-b0ad-82eb5948dbe8`.
- Intervention: `eb7759d7-5b1e-4328-bfcc-086b08e74f90`.
- Module object: `4e798e94-e677-4496-918c-014989793b29`.
- Preserved installation: `9c02a494-e626-460c-8f9a-572bca802854`.
- Preserved Connections: `a61dfa43-9def-4a33-8135-d85dd7a11861`,
  `b57a23ca-50e8-4620-9b82-9599dd06a8ef`.

## Change inspection and remaining limits

The final staged diff was reread, including the transaction/lock path, dependency
exemptions, client generation protection and behavioral/concurrency checks.
`git diff --check` and `git diff --cached --check` pass; migrations are unchanged.
GitNexus staged `detect_changes` inspected **14 files / 90 symbols / 11 affected
flows**, aggregate risk **HIGH**, with all 90 symbols returned and no partial or
truncated inspection result. The index was rebuilt against the final sources at
`E:\Projects\netmap`, baseline HEAD above. CLI metadata/status confirm that path
and commit; all **12 changed code/test files' SHA-256 hashes match the index**.
CLI status marks any dirty working tree stale by design; the MCP context endpoint
also retains an older cached one-commit hint despite resolving the newly indexed
reconciliation symbols. Neither hint was treated as proof of freshness: commit,
path and every changed source hash were verified directly. Only this validation
report's prose was then completed. The final change check uses the correct staged
diff/current graph. Affected draft
review, library state and editor flows have targeted coverage. Graph process
inventory has traversal/language boundaries (the new reconciliation entry point
has no process membership), so source inspection and direct PostgreSQL/browser
tests explicitly cover that path. This check is change inspection, not external
acceptance or proof of complete graph coverage. External branch inspection is
still required.

The batch is synchronous and derived dependency analysis can be expensive at
large scale. Endpoint deletion briefly blocks canonical JSON writers, whose
references have no FK protection. Lock contention returns a safe retry reason;
no automatic retry hides a partially successful batch. Conservative internal-link
and kind-change refusal may require future manual resolution. Transient execution
errors are logged and shown for that attempt; after reload the UI recomputes
actual revision/dependency state, without a separate status flag. No new provenance
relationship, conflict editor, ModuleTemplate editing/updating, SavedMap redesign,
or next-milestone work is included. Phase C and HV-01 remain unaccepted.
