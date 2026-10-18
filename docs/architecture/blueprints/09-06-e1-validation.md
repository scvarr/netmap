# 09.6-E1 validation — ModuleTemplate drafts and impact review

Date: 2026-10-17. Branch: `09-06-e1-module-template-draft-review`.
Implementation complete; external inspection/acceptance pending. E2/E3 remain
OPEN; Phase C remains PAUSED and HV-01 requires its separate manual recheck.

## Delivered contract

- Module library edit action and Russian/typed-English editor for name, exact
  compatibility, endpoint names/kinds/order, additions and removals.
- Persisted server draft with optimistic generation conflicts and frozen
  append-only candidates. Existing revisions, installations, canonical endpoints,
  Connections and user data are unchanged by opening, saving and checking.
- Per-installation analysis across every pinned revision, using definition keys
  and the configuration's current bay. Exact compatibility mismatch and existing
  endpoint kind changes require intervention. Unused removal reuses D2's FK/JSON
  dependency checks, including the module's own mapping exemption and validation
  of expected point/interface ownership/binding materialization.
- C's REPEATABLE READ snapshot/retry and input fingerprint are reused. Generation
  saves and canonical/configuration/installation changes invalidate checks.
  Module draft/candidate writes do not invalidate BaseTemplate checks or expand
  base publication locks. Client focus/15-second refresh hides conclusions while
  dirty, pending, failed, conflicting or stale.
- Forward migration `0004` adds the two module review tables. No applied revision
  was edited. Workspace stays v5: current exports include both new authoring
  collections, old supported v5/C archives restore with empty module reviews,
  and partial/unknown/malformed structures fail before writes.

## Verification

All application runtime/build/test execution used Docker. Targeted backend run:

```text
pytest -ra tests/test_module_template_review.py
  tests/test_base_template_review.py tests/test_base_template_review_concurrency.py
  tests/test_base_template_publication.py tests/test_object_reconciliation.py
  tests/test_object_reconciliation_concurrency.py tests/test_hardware_configuration.py
  tests/test_module_template_deletion.py tests/test_workspace_portability.py
  tests/test_workspace_compatibility.py
```

Result: **167 passed**. This includes generation conflicts/concurrent draft
initialization, concurrent canonical commits during a coherent check, nonblocking
review reads, installation invalidation, old-revision installations, exact
compatibility, FK/JSON dependencies, missing materialization, immutable snapshots,
workspace round-trip and real historical 09.6-C fixture import. The existing C
archive test now expects migration 0004 and explicitly empty module review
collections; all historical rows/IDs/snapshots remain compared unchanged.

Targeted client checks: **105 passed** across the module editor, library action/API
serialization, BaseTemplate editor/review and typed translations. Production TypeScript/Vite
build passes; Vite retains its bundle-size advisory. Full suites were not run:
the affected local contracts and related BaseTemplate mechanisms are bounded
and covered by the targeted selections.

`git diff --check` and staged diff whitespace checks pass. GitNexus
`detect_changes(scope="staged", repo="netmap")` completed without partial or
truncated output: 19 files, 141 changed symbols, 28 affected processes, aggregate
risk **critical**. The listed processes were inspected against the diff and
targeted coverage: new module review plus shared App/library and base
review/publication paths. This is change-inspection evidence, not external
acceptance or a claim that the aggregate risk is low.

## Remaining boundaries

The fingerprint deliberately remains conservative and workspace-wide, as in C;
unrelated canonical edits may invalidate a review. Reviews are advisory snapshots,
not authorization to apply an update. No module publication, installation update,
module relocation, conflict editor or module canvas is included. External branch
inspection is the next acceptance boundary; no merge to main is performed.

## External review corrections — 2026-10-18

Follow-up to external inspection of `3cdd6681fef56181332e641cddad7dab7f833fc3`:

- Retained module endpoints now require ConnectionPoint cardinality exactly 1;
  an invalid cardinality reports `requires_intervention` / `INVALID_ENDPOINT_MAPPING`.
  Addressed tests cover both NETWORK_PORT and CONNECTION_POINT, with unchanged
  canonical data and installations after the advisory check.
- A successful refresh clears the previous error only after its generation
  matches the editor's saved generation. Confirmed current conclusions become
  visible again after a transient failure; dirty input and generation conflicts
  still suppress conclusions and preserve local input/the saved generation.
- Docker targeted checks: `tests/test_module_template_review.py` **42 passed**;
  `src/pages/EditModuleTemplatePage.test.tsx` **12 passed**. New regression tests
  reproduced both defects before the fixes. TypeScript/Vite production build
  and `git diff --check` pass.

These corrections do not change BaseTemplate, publication, installation writes,
canonical write paths, the schema or the E1 boundary. External acceptance remains
pending.
