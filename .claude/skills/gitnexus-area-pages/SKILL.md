---
name: gitnexus-area-pages
description: "Skill for the Pages area of netmap. 142 symbols across 33 files."
---

# Pages

142 symbols | 33 files | Cohesion: 78%

## When to Use

- Working with code in `frontend/`
- Understanding how onNodeDragStop, InfrastructureObjectDetailPage, MapPage work
- Modifying pages-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `frontend/src/pages/MapPage.tsx` | MapPage, create, createWiring, endpointFor, objectSearchResults (+38) |
| `frontend/src/pages/MapPage.savedMaps.test.tsx` | Location, blueprintPresentation, loadProjection, loadProjection, loadProjection (+17) |
| `frontend/src/pages/InfrastructureObjectsPage.tsx` | CatalogState, InfrastructureObjectsPage, RenameDialog, fold, Actions (+9) |
| `frontend/src/pages/ObjectBlueprintEditor.tsx` | newBlueprintEditorState, addLink, samePair, renderLink, updateLink |
| `frontend/src/pages/MapPage.wiring.test.tsx` | loadProjection, renderPage, apiResponse, fetchMock |
| `frontend/src/topology/nodeFootprint.ts` | footprintDimensionsForProjectionNode, nodeFootprint, overlapsAnyNode, projectionNodeFootprint |
| `frontend/src/topology/projection.ts` | physicalObjectIdForNode, physicalObjectIdForSelection, projectionRequestFor, nodeForPhysicalObject |
| `frontend/src/pages/PortBlockEditorPage.tsx` | PortBlockEditorPage, field, update, updateLabel |
| `frontend/src/pages/InfrastructureObjectDetailPage.test.tsx` | details, inventory, renderPage |
| `frontend/src/pages/InfrastructureObjectDetailPage.tsx` | InfrastructureObjectDetailPage, addMapLink, mapLink |

## Entry Points

Start here when exploring this area:

- **`onNodeDragStop`** (Function) — `frontend/src/components/TopologyCanvas.tsx:353`
- **`InfrastructureObjectDetailPage`** (Function) — `frontend/src/pages/InfrastructureObjectDetailPage.tsx:48`
- **`MapPage`** (Function) — `frontend/src/pages/MapPage.tsx:136`
- **`create`** (Function) — `frontend/src/pages/MapPage.tsx:439`
- **`createWiring`** (Function) — `frontend/src/pages/MapPage.tsx:673`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `onNodeDragStop` | Function | `frontend/src/components/TopologyCanvas.tsx` | 353 |
| `InfrastructureObjectDetailPage` | Function | `frontend/src/pages/InfrastructureObjectDetailPage.tsx` | 48 |
| `MapPage` | Function | `frontend/src/pages/MapPage.tsx` | 136 |
| `create` | Function | `frontend/src/pages/MapPage.tsx` | 439 |
| `createWiring` | Function | `frontend/src/pages/MapPage.tsx` | 673 |
| `endpointFor` | Function | `frontend/src/pages/MapPage.tsx` | 613 |
| `objectSearchResults` | Function | `frontend/src/pages/MapPage.tsx` | 211 |
| `onPhysicalPortClick` | Function | `frontend/src/pages/MapPage.tsx` | 644 |
| `openInsertion` | Function | `frontend/src/pages/MapPage.tsx` | 494 |
| `refreshWiringAfterRouteWrite` | Function | `frontend/src/pages/MapPage.tsx` | 655 |
| `refreshWiringProjection` | Function | `frontend/src/pages/MapPage.tsx` | 648 |
| `resetCableRoute` | Function | `frontend/src/pages/MapPage.tsx` | 1086 |
| `resizeBlueprint` | Function | `frontend/src/pages/MapPage.tsx` | 909 |
| `resolveInsertionPosition` | Function | `frontend/src/pages/MapPage.tsx` | 687 |
| `retryInsertionRefresh` | Function | `frontend/src/pages/MapPage.tsx` | 832 |
| `retryWiringRefresh` | Function | `frontend/src/pages/MapPage.tsx` | 685 |
| `retryWiringRoute` | Function | `frontend/src/pages/MapPage.tsx` | 684 |
| `saveWiringRoute` | Function | `frontend/src/pages/MapPage.tsx` | 659 |
| `selectedPlacementPosition` | Function | `frontend/src/pages/MapPage.tsx` | 1153 |
| `setViewMode` | Function | `frontend/src/pages/MapPage.tsx` | 603 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `InfrastructureObjectDetailPage → Ref` | cross_community | 7 |
| `InfrastructureObjectDetailPage → Ref` | cross_community | 7 |
| `RetryWiringRoute → Node` | intra_community | 7 |
| `OnNodeDragStop → BlueprintDisplayDimensions` | cross_community | 6 |
| `OnNodeDragStop → VisibleBlueprintFaces` | cross_community | 6 |
| `RetryWiringRefresh → Node` | intra_community | 6 |
| `AddContinuationAtViewportCenter → BlueprintDisplayDimensions` | cross_community | 6 |
| `AddContinuationAtViewportCenter → VisibleBlueprintFaces` | cross_community | 6 |
| `SubmitInsertion → BlueprintDisplayDimensions` | cross_community | 6 |
| `SubmitInsertion → VisibleBlueprintFaces` | cross_community | 6 |

## How to Explore

1. `context({name: "onNodeDragStop"})` — see callers and callees
2. `query({search_query: "pages"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
