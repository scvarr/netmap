---
name: gitnexus-area-portblocks
description: "Skill for the PortBlocks area of netmap. 6 symbols across 2 files."
---

# PortBlocks

6 symbols | 2 files | Cohesion: 86%

## When to Use

- Working with code in `frontend/`
- Understanding how save, createPortBlockRequest, generatePortBlock work
- Modifying portblocks-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `frontend/src/portBlocks/editorModel.ts` | clean, createPortBlockRequest, generatePortBlock, labelNumber, requiredPortCount |
| `frontend/src/pages/PortBlockEditorPage.tsx` | save |

## Entry Points

Start here when exploring this area:

- **`save`** (Function) — `frontend/src/pages/PortBlockEditorPage.tsx:15`
- **`createPortBlockRequest`** (Function) — `frontend/src/portBlocks/editorModel.ts:16`
- **`generatePortBlock`** (Function) — `frontend/src/portBlocks/editorModel.ts:15`
- **`requiredPortCount`** (Function) — `frontend/src/portBlocks/editorModel.ts:10`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `save` | Function | `frontend/src/pages/PortBlockEditorPage.tsx` | 15 |
| `createPortBlockRequest` | Function | `frontend/src/portBlocks/editorModel.ts` | 16 |
| `generatePortBlock` | Function | `frontend/src/portBlocks/editorModel.ts` | 15 |
| `requiredPortCount` | Function | `frontend/src/portBlocks/editorModel.ts` | 10 |
| `clean` | Function | `frontend/src/portBlocks/editorModel.ts` | 9 |
| `labelNumber` | Function | `frontend/src/portBlocks/editorModel.ts` | 14 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Save → Clean` | intra_community | 4 |
| `Save → RequiredPortCount` | intra_community | 4 |

## How to Explore

1. `context({name: "save"})` — see callers and callees
2. `query({search_query: "portblocks"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
