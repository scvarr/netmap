---
name: gitnexus-area-cluster-130
description: "Skill for the Cluster_130 area of netmap. 4 symbols across 2 files."
---

# Cluster_130

4 symbols | 2 files | Cohesion: 86%

## When to Use

- Working with code in `frontend/`
- Understanding how I18nProvider, readStoredLocale work
- Modifying cluster_130-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `frontend/src/i18n.tsx` | I18nProvider, readStoredLocale |
| `frontend/src/localization.integration.test.tsx` | LocaleControls, renderLocalized |

## Entry Points

Start here when exploring this area:

- **`I18nProvider`** (Function) — `frontend/src/i18n.tsx:84`
- **`readStoredLocale`** (Function) — `frontend/src/i18n.tsx:74`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `I18nProvider` | Function | `frontend/src/i18n.tsx` | 84 |
| `readStoredLocale` | Function | `frontend/src/i18n.tsx` | 74 |
| `LocaleControls` | Function | `frontend/src/localization.integration.test.tsx` | 9 |
| `renderLocalized` | Function | `frontend/src/localization.integration.test.tsx` | 14 |

## How to Explore

1. `context({name: "I18nProvider"})` — see callers and callees
2. `query({search_query: "cluster_130"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
