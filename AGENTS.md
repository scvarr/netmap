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
