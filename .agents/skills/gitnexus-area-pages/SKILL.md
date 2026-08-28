---
name: gitnexus-area-pages
description: "Skill for the Pages area of netmap. 128 symbols across 31 files."
---

# Pages

128 symbols | 31 files | Cohesion: 76%

## When to Use

- Working with code in `frontend/`
- Understanding how InfrastructureObjectDetailPage, MapPage, create work
- Modifying pages-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `frontend/src/pages/MapPage.tsx` | MapPage, create, createWiring, endpointFor, onPhysicalPortClick (+34) |
| `frontend/src/pages/MapPage.savedMaps.test.tsx` | Location, loadProjection, loadProjection, loadProjection, loadProjection (+14) |
| `frontend/src/pages/InfrastructureObjectsPage.tsx` | CatalogState, InfrastructureObjectsPage, RenameDialog, fold, Actions (+9) |
| `frontend/src/pages/ObjectBlueprintEditor.tsx` | newBlueprintEditorState, addLink, samePair, renderLink, updateLink |
| `frontend/src/pages/PortBlockEditorPage.tsx` | PortBlockEditorPage, field, update, updateLabel |
| `frontend/src/pages/InfrastructureObjectDetailPage.test.tsx` | details, inventory, renderPage |
| `frontend/src/pages/InfrastructureObjectDetailPage.tsx` | InfrastructureObjectDetailPage, addMapLink, mapLink |
| `frontend/src/topology/interfacePhysicalTraceOverlay.ts` | emptyOverlay, physicalTraceOverlayFor, sameEvidence |
| `frontend/src/topology/projection.ts` | projectionRequestFor, physicalObjectIdForSelection, nodeForPhysicalObject |
| `frontend/src/App.test.tsx` | LocationProbe, dataSourceFor, renderApp |

## Entry Points

Start here when exploring this area:

- **`InfrastructureObjectDetailPage`** (Function) — `frontend/src/pages/InfrastructureObjectDetailPage.tsx:48`
- **`MapPage`** (Function) — `frontend/src/pages/MapPage.tsx:135`
- **`create`** (Function) — `frontend/src/pages/MapPage.tsx:426`
- **`createWiring`** (Function) — `frontend/src/pages/MapPage.tsx:658`
- **`endpointFor`** (Function) — `frontend/src/pages/MapPage.tsx:600`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `InfrastructureObjectDetailPage` | Function | `frontend/src/pages/InfrastructureObjectDetailPage.tsx` | 48 |
| `MapPage` | Function | `frontend/src/pages/MapPage.tsx` | 135 |
| `create` | Function | `frontend/src/pages/MapPage.tsx` | 426 |
| `createWiring` | Function | `frontend/src/pages/MapPage.tsx` | 658 |
| `endpointFor` | Function | `frontend/src/pages/MapPage.tsx` | 600 |
| `onPhysicalPortClick` | Function | `frontend/src/pages/MapPage.tsx` | 631 |
| `openInsertion` | Function | `frontend/src/pages/MapPage.tsx` | 481 |
| `refreshWiringProjection` | Function | `frontend/src/pages/MapPage.tsx` | 635 |
| `resetCableRoute` | Function | `frontend/src/pages/MapPage.tsx` | 1049 |
| `resolveInsertionPosition` | Function | `frontend/src/pages/MapPage.tsx` | 672 |
| `retryInsertionRefresh` | Function | `frontend/src/pages/MapPage.tsx` | 808 |
| `retryWiringRefresh` | Function | `frontend/src/pages/MapPage.tsx` | 670 |
| `retryWiringRoute` | Function | `frontend/src/pages/MapPage.tsx` | 669 |
| `saveCableRoute` | Function | `frontend/src/pages/MapPage.tsx` | 1036 |
| `saveWiringRoute` | Function | `frontend/src/pages/MapPage.tsx` | 642 |
| `setViewMode` | Function | `frontend/src/pages/MapPage.tsx` | 590 |
| `submitInsertion` | Function | `frontend/src/pages/MapPage.tsx` | 707 |
| `physicalTraceOverlayFor` | Function | `frontend/src/topology/interfacePhysicalTraceOverlay.ts` | 15 |
| `footprintDimensionsForProjectionNode` | Function | `frontend/src/topology/nodeFootprint.ts` | 20 |
| `projectionNodeFootprint` | Function | `frontend/src/topology/nodeFootprint.ts` | 32 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `InfrastructureObjectDetailPage → Ref` | cross_community | 7 |
| `InfrastructureObjectDetailPage → Ref` | cross_community | 7 |
| `OnNodeDragStop → BlueprintDisplayDimensions` | cross_community | 6 |
| `OnNodeDragStop → VisibleBlueprintFaces` | cross_community | 6 |
| `RetryWiringRoute → Node` | intra_community | 6 |
| `AddContinuationAtViewportCenter → BlueprintDisplayDimensions` | cross_community | 6 |
| `AddContinuationAtViewportCenter → VisibleBlueprintFaces` | cross_community | 6 |
| `SubmitInsertion → BlueprintDisplayDimensions` | cross_community | 6 |
| `SubmitInsertion → VisibleBlueprintFaces` | cross_community | 6 |
| `App → UseI18n` | cross_community | 5 |

## How to Explore

1. `context({name: "InfrastructureObjectDetailPage"})` — see callers and callees
2. `query({search_query: "pages"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
