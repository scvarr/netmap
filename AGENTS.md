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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **netmap** (9567 symbols, 33346 relationships, 373 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact analysis before editing.** Use `impact({target: "symbolName", direction: "upstream"})` (MCP) or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .` (CLI fallback); report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/netmap/context` | Codebase overview, check index freshness |
| `gitnexus://repo/netmap/clusters` | All functional areas |
| `gitnexus://repo/netmap/processes` | All execution flows |
| `gitnexus://repo/netmap/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
