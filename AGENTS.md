# NetMap development contract — read first

Read this root `AGENTS.md` before any NetMap architecture or implementation
work. Current `main` and current repository documentation are the source of
truth; conversation-recovery prompts may be stale.

NetMap is pre-production. Backward/legacy compatibility is **not** a default
goal. When an obsolete development-stage implementation, schema, API,
authoring format, UI concept, parser, presentation model, or abstraction
conflicts with the accepted target architecture, remove it rather than preserve
it through compatibility machinery.

Do not add compatibility layers, dual old/new formats, deprecated aliases,
legacy parsers, migration/translation shims, `old || new` fallback semantics,
shadow models, or obsolete authoring APIs merely to preserve obsolete
development behavior. Compatibility is justified only for:

- canonical user/network data;
- stable canonical identity;
- immutable historical snapshots that remain in the product model; or
- an explicitly approved external compatibility contract.

Historical readability and immutable provenance do **not** keep obsolete
authoring or runtime contracts alive. Decision rule: choose deletion over extra
complexity to preserve an obsolete implementation unless an exception above
applies.

Permanent NetMap rules:

- Canonical topology is the runtime source of truth; presentation is not
  topology evidence. Blueprint and Port Block are authoring/provenance/
  presentation constructs, not canonical topology entities.
- Identity never depends on labels, numbering, coordinates, layout/order, or
  presentation. Immutable versions remain immutable.
- Avoid speculative abstractions for later milestones; complete one bounded
  milestone at a time.
- Codex implements code, never changes or pushes `main`; a FINAL branch diff
  requires external inspection before acceptance. A WIP checkpoint is not an
  acceptance boundary.
- Runtime is Docker-only, migrations run before startup, and dependencies are
  pinned. UI defaults to Russian, with English through typed i18n.
- Published/applied Alembic revisions are immutable. Once a revision may have
  been applied to any persistent database, never modify it to change the schema
  contract: use a new forward migration for every evolution or correction, as
  existing databases will not replay an already-recorded revision. This protects
  migration-history integrity, not obsolete application contracts.

## Testing workflow

- Use targeted tests for the affected behavioural contract by default during
  implementation and at final acceptance. Choose broader checks based on the
  actual regression surface, risk, and acceptance criteria. Reaching the final
  boundary or changing several layers within a bounded milestone does not by
  itself require full backend/frontend suites.
- For documentation-only work, review the diff, verify links and anchors,
  and check consistency with current repository documentation.
- Preserve behavioural contracts and invariants. Duplicate a check only when
  each instance provides distinct coverage or evidence. Reserve true E2E tests
  for a small number of end-to-end guarantees and verify local contracts in
  cheaper layers.
- Classify failures outside the current contract as milestone regressions or
  unrelated/obsolete test debt before acting. Keep unrelated failures outside
  the corrective milestone and avoid restoring obsolete expectations.
- GitNexus change inspection is separate from test selection.

## Interface consistency

- Apply these requirements to new and changed interfaces. Inspect comparable
  screens and follow the [UX/IA contract](docs/UX_IA_CONTRACT.md).
- Reuse PageShell, PageHeader, Breadcrumbs, and existing styles for buttons,
  fields, tables, and messages where applicable. Follow existing control sizes,
  spacing, and colors. Add CSS only for feature-specific behaviour.
- Check applicable dialogs, responsive layouts, keyboard focus, action
  hierarchy, confirmations, typography, localization, and control states.
- For substantial UI changes, provide browser evidence for affected flows
  and viewport sizes, with screenshots where possible. Report any browser
  verification that could not be performed.
- Visual consistency is part of acceptance. Keep general redesign and
  independent UX defects outside the milestone scope.

## Milestone status and final report

Use **IMPLEMENTED** once the scoped changes are complete. Use **ACCEPTED**
only after all prescribed acceptance checks and external inspection of the
final branch diff are complete. Passing automated tests alone does not
establish acceptance.

Include in the final report:

- Branch, base SHA, and final SHA.
- Implemented contract and milestone status.
- Checks performed and their results.
- Checks omitted, limitations, and deviations.
- GitNexus result when applicable.
- Commit, push, and working tree status.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **netmap**. Use the task-specific
MCP/CLI commands and resources for targeted discovery, impact analysis, and
change detection.

- Before changing a function, class, method, or other symbol, run targeted
  upstream impact analysis when the target is not already fully understood.
  Warn the user before edits if it reports HIGH or CRITICAL risk.
- `risk: UNKNOWN`, `partial: true`, or `truncated: true` never proves that
  dependencies are absent; a zero can mean unseen. Re-run incomplete graph
  checks, and when an UNKNOWN result matters, confirm it with ordinary text
  search before treating a symbol as safe to change or delete.
- Use targeted GitNexus discovery (`query`, `context`, process resources) in
  preference to broad repository scans. Do not invoke it mechanically when
  the exact target files or symbols are already known.
- Run `detect_changes` before the final commit for code changes and ensure the
  result covers the final diff for acceptance. Run it for intermediate WIP
  commits as needed. Documentation-only changes require no `detect_changes`.
- Report unavailable, incomplete, or wrong-worktree analysis as unresolved,
  together with the alternative checks performed and their results.
- Use graph-aware rename/refactoring workflows; do not rename symbols with
  blind find-and-replace.

<!-- gitnexus:end -->
