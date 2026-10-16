# 09.6-C validation — persisted base template editing and review

09.6-C **IMPLEMENTED, AWAITING EXTERNAL INSPECTION**.
09.6-D **OPEN**: publication and safe application remain unimplemented.
Phase C remains PAUSED; HV-01 is not complete or PASSED.

Baseline: `85d878f839d8b403675c4c8fcf5858c35ad7567d`.
Branch: `09-06-c-base-template-draft-review`; initially clean.

## Contract evidence

- Draft initialization and persisted reopening preserve published opaque keys,
  full panel/endpoint/link/bay definitions and properties. Save does not create
  a revision. Draft conflicts return 409 and do not overwrite saved work.
- Each check persists a new immutable candidate and per-object impact result.
  Subsequent saves invalidate the earlier generation; canonical/configuration
  changes invalidate the recorded input fingerprint on server read.
- Added endpoints and geometry/rename changes preserve identity and are
  potentially safe. Removed endpoints with Connections, custom aliases, L2/L3
  bindings, physical bindings, realizations or Security/NAT/processing/routing
  policy references require intervention. Different instances are independent.
- Removed/changed occupied bays use exact compatibility and deterministic stable
  installation/bay ordering. Two displaced installations with two compatible
  bays are potentially safe; one or zero available bays requires intervention.
- Canonical facts, installations and published definitions are unchanged by
  save/check. Proposed placements are never applied.
- v5 export/reset/import round-trip includes saved drafts/candidates/results;
  invalid source references and unsupported v3/v4 packages are rejected.
- Client tests cover reopening saved edits and review, new-endpoint save field
  normalization, unsaved-state invalidation, error retention and focus freshness.

## Validation commands and results

All runtime/build/test commands use Docker.

- `docker compose -f compose.test.yaml exec -T test-backend pytest tests/test_base_template_review.py tests/test_hardware_configuration.py tests/test_workspace_portability.py tests/test_workspace_compatibility.py -q --tb=short`
  — **40 passed**.
- Frontend target tests: `EditBaseTemplatePage.test.tsx`,
  `BaseTemplateEditor.test.tsx`, `editorModel.test.ts`, `hardwareModules.test.ts`,
  `ModuleBayAuthoring.test.tsx` — **198 passed**. An old opening-time rounding
  expectation was replaced with exact saved-geometry preservation; explicit
  geometry edits still round as before.
- Frontend production build — **PASS** (existing large-chunk warning).
- Forward migration `0001 → 0002` applied to the existing persistent database,
  with canonical export before/after identical. No reset or volume removal.
  `alembic current` — **0002 (head)**; `alembic check` — no new operations.
- Full suites were not run: the affected contracts were covered by targeted tests.
- `git diff --check` — **PASS**. GitNexus staged `detect_changes` inspected all
  changed files without partial/truncated results: 154 symbols / 28 affected
  flows before the final test/report edits, aggregate risk **critical**. The
  affected editor, creation, import and review contracts were inspected and
  tested; this is not a claim of external acceptance. The index was fully
  rebuilt after an initial FTS repair failure.

## Browser scenario (2026-10-16)

Using the real Docker frontend/backend and the in-app browser:

1. Created `09.6-C browser review` with one built-in network port, width 160.
2. Created `09.6-C preserved object` from that published template.
3. Opened the library's **«Изменить шаблон»**, changed width to 200 and added
   another endpoint; saved with **«Сохранить черновик»** and observed confirmation.
4. Recreated application containers without touching the database; reloaded the
   browser. The saved width 200 and two definitions were restored.
5. Checked changes and observed the frozen candidate, structural changes and
   **«Потенциально безопасное автоматическое обновление»** for the existing object.
6. Compared complete canonical export, ObjectConfiguration and published revision
   with their pre-edit snapshots: **identical**. The published revision and object
   still have one endpoint and the original presentation.

The first browser pass exposed a JSON-property-order issue that kept checking
disabled after adding an endpoint. Semantic key-sorted comparison fixed it;
the client regression test now includes endpoint creation and server field order.

## Conservative intervention and freshness boundaries

The analysis requires attention for endpoint dependencies/user aliases, endpoint
kind changes, missing mappings, insufficient exact compatible capacity and internal
link changes touching canonical Connections. It does not promise that removing
an authored internal link can discard an existing Connection.

Freshness intentionally hashes all canonical/authoring inputs except review
records. Unrelated data changes can require a new check. The client checks on
focus and every 15 seconds and explicitly limits conclusions to the last server
check; it hides conclusions during revalidation, on failure, or after local edits.
There is no apply operation that could consume a stale result.

## Bounded correction after external review of 95d9f8a

Removed the global SHARE table locks from fingerprint reads. Ordinary GET of an
existing draft now uses non-locking SELECTs in a PostgreSQL REPEATABLE READ
transaction, without locking the BaseTemplate row. The saved draft, candidate and
freshness fingerprint are read from one MVCC snapshot. Fingerprinting still
conservatively reads canonical/authoring inputs, but does not block ordinary
writers. A document without verified input evidence cannot report `current=true`.

POST `/draft/check` uses the same transaction isolation for its draft, input
fingerprint and per-object analysis. It locks only the checked draft against
concurrent saves, then persists the immutable candidate with that exact input
fingerprint. Formatting the response neither scans inputs again nor acquires
global locks. Initial draft creation retains its short template lock; a bounded
retry of PostgreSQL serialization failures handles initialization/snapshot races.
Saving a draft still invalidates its previous candidate.

Correction validation (Docker/PostgreSQL):

- `docker compose -f compose.test.yaml exec -T test-backend pytest tests/test_base_template_review_concurrency.py tests/test_base_template_review.py -q --tb=short`
  — **24 passed**.
- Before GET commit, `pg_locks` contains only AccessShareLock table locks;
  another transaction can immediately lock the BaseTemplate row and commit a
  canonical endpoint change under a 750 ms lock timeout. The next GET reports
  stale review.
- A writer commits a custom endpoint alias and a new object's configuration
  between POST fingerprint capture and analysis. The persisted result and hash
  remain on the original snapshot; the next GET is stale, and the next check
  includes both objects and the new dependency.
- Unverified formatting fails closed; draft saves still invalidate review;
  concurrent initialization retries successfully and leaves exactly one draft.
- `git diff --check` — **PASS**. No schema, migration, workspace format, editor,
  impact-classification or published/canonical-data contract changes. Full suites
  and frontend checks were not run because this correction changes only backend
  transaction/read behavior.
