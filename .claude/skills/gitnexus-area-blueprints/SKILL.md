---
name: gitnexus-area-blueprints
description: "Skill for the Blueprints area of netmap. 41 symbols across 8 files."
---

# Blueprints

41 symbols | 8 files | Cohesion: 76%

## When to Use

- Working with code in `frontend/`
- Understanding how addBulkInternalLinks, cleanupLinks, composedSlotKey work
- Modifying blueprints-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `frontend/src/blueprints/editorModel.ts` | addBulkInternalLinks, cleanupLinks, composedSlotKey, internalLinkPairKey, orderedSlotKeys (+9) |
| `frontend/src/blueprints/compositionGeometry.ts` | bounded, clamp, initialPlacementForPorts, resizePlacement, snapped (+9) |
| `frontend/src/pages/ObjectBlueprintEditor.tsx` | ObjectBlueprintEditor, add, instanceLabel, remove, switchVersion (+2) |
| `frontend/src/blueprints/editorModel.test.ts` | instance, port |
| `frontend/src/components/PortBlockStructurePreview.tsx` | PortBlockStructurePreview |
| `frontend/src/pages/EditObjectBlueprintPage.tsx` | load |
| `frontend/src/topology/portBlockTypes.ts` | loadPortBlockVersion |
| `frontend/src/components/BlueprintCompositionCanvas.tsx` | BlueprintCompositionCanvas |

## Entry Points

Start here when exploring this area:

- **`addBulkInternalLinks`** (Function) — `frontend/src/blueprints/editorModel.ts:31`
- **`cleanupLinks`** (Function) — `frontend/src/blueprints/editorModel.ts:28`
- **`composedSlotKey`** (Function) — `frontend/src/blueprints/editorModel.ts:19`
- **`internalLinkPairKey`** (Function) — `frontend/src/blueprints/editorModel.ts:29`
- **`removeInternalLinksBetweenInstances`** (Function) — `frontend/src/blueprints/editorModel.ts:44`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `addBulkInternalLinks` | Function | `frontend/src/blueprints/editorModel.ts` | 31 |
| `cleanupLinks` | Function | `frontend/src/blueprints/editorModel.ts` | 28 |
| `composedSlotKey` | Function | `frontend/src/blueprints/editorModel.ts` | 19 |
| `internalLinkPairKey` | Function | `frontend/src/blueprints/editorModel.ts` | 29 |
| `removeInternalLinksBetweenInstances` | Function | `frontend/src/blueprints/editorModel.ts` | 44 |
| `resolveSlotKeys` | Function | `frontend/src/blueprints/editorModel.ts` | 26 |
| `PortBlockStructurePreview` | Function | `frontend/src/components/PortBlockStructurePreview.tsx` | 5 |
| `ObjectBlueprintEditor` | Function | `frontend/src/pages/ObjectBlueprintEditor.tsx` | 16 |
| `add` | Function | `frontend/src/pages/ObjectBlueprintEditor.tsx` | 26 |
| `instanceLabel` | Function | `frontend/src/pages/ObjectBlueprintEditor.tsx` | 20 |
| `remove` | Function | `frontend/src/pages/ObjectBlueprintEditor.tsx` | 27 |
| `switchVersion` | Function | `frontend/src/pages/ObjectBlueprintEditor.tsx` | 28 |
| `update` | Function | `frontend/src/pages/ObjectBlueprintEditor.tsx` | 25 |
| `clampPlacement` | Function | `frontend/src/blueprints/editorModel.ts` | 8 |
| `createBlueprintRequest` | Function | `frontend/src/blueprints/editorModel.ts` | 71 |
| `faceLocalIndex` | Function | `frontend/src/blueprints/editorModel.ts` | 17 |
| `fallbackPlacement` | Function | `frontend/src/blueprints/editorModel.ts` | 13 |
| `generateBlueprint` | Function | `frontend/src/blueprints/editorModel.ts` | 59 |
| `hydrateBlueprintEditorState` | Function | `frontend/src/blueprints/editorModel.ts` | 49 |
| `load` | Function | `frontend/src/pages/EditObjectBlueprintPage.tsx` | 11 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Load → IsObject` | cross_community | 6 |
| `Load → Malformed` | cross_community | 6 |
| `Update → Clamp` | cross_community | 5 |
| `EditObjectBlueprintPage → PlacementRect` | cross_community | 5 |
| `EditObjectBlueprintPage → ClampPlacement` | cross_community | 5 |
| `NewObjectBlueprintPage → PlacementRect` | cross_community | 5 |
| `NewObjectBlueprintPage → ClampPlacement` | cross_community | 5 |
| `Update → SnapAxis` | cross_community | 4 |
| `EditObjectBlueprintPage → Normalized` | cross_community | 4 |
| `EditObjectBlueprintPage → CompositionCanvas` | cross_community | 4 |

## How to Explore

1. `context({name: "addBulkInternalLinks"})` — see callers and callees
2. `query({search_query: "blueprints"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
