---
name: gitnexus-area-pages
description: "Skill for the Pages area of netmap. 120 symbols across 18 files."
---

# Pages

120 symbols | 18 files | Cohesion: 77%

## When to Use

- Working with code in `frontend/`
- Understanding how onNodeDragStop, InfrastructureObjectDetailPage, MapPage work
- Modifying pages-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `frontend/src/pages/MapPage.tsx` | MapPage, create, createWiring, endpointFor, objectSearchResults (+38) |
| `frontend/src/pages/MapPage.savedMaps.test.tsx` | Location, blueprintPresentation, loadProjection, loadProjection, loadProjection (+16) |
| `frontend/src/pages/InfrastructureObjectsPage.tsx` | CatalogState, InfrastructureObjectsPage, RenameDialog, fold, Actions (+10) |
| `frontend/src/pages/MapPage.wiring.test.tsx` | loadProjection, renderPage, apiResponse, fetchMock |
| `frontend/src/topology/nodeFootprint.ts` | footprintDimensionsForProjectionNode, nodeFootprint, overlapsAnyNode, projectionNodeFootprint |
| `frontend/src/topology/projection.ts` | physicalObjectIdForNode, physicalObjectIdForSelection, projectionRequestFor, nodeForPhysicalObject |
| `frontend/src/pages/PortBlockEditorPage.tsx` | PortBlockEditorPage, field, update, updateLabel |
| `frontend/src/pages/ObjectBlueprintEditor.tsx` | addLink, samePair, renderLink, updateLink |
| `frontend/src/pages/InfrastructureObjectDetailPage.test.tsx` | details, inventory, renderPage |
| `frontend/src/pages/InfrastructureObjectDetailPage.tsx` | InfrastructureObjectDetailPage, addMapLink, mapLink |

## Entry Points

Start here when exploring this area:

- **`onNodeDragStop`** (Function) — `frontend/src/components/TopologyCanvas.tsx:353`
- **`InfrastructureObjectDetailPage`** (Function) — `frontend/src/pages/InfrastructureObjectDetailPage.tsx:48`
- **`MapPage`** (Function) — `frontend/src/pages/MapPage.tsx:139`
- **`create`** (Function) — `frontend/src/pages/MapPage.tsx:437`
- **`createWiring`** (Function) — `frontend/src/pages/MapPage.tsx:633`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `onNodeDragStop` | Function | `frontend/src/components/TopologyCanvas.tsx` | 353 |
| `InfrastructureObjectDetailPage` | Function | `frontend/src/pages/InfrastructureObjectDetailPage.tsx` | 48 |
| `MapPage` | Function | `frontend/src/pages/MapPage.tsx` | 139 |
| `create` | Function | `frontend/src/pages/MapPage.tsx` | 437 |
| `createWiring` | Function | `frontend/src/pages/MapPage.tsx` | 633 |
| `endpointFor` | Function | `frontend/src/pages/MapPage.tsx` | 573 |
| `objectSearchResults` | Function | `frontend/src/pages/MapPage.tsx` | 213 |
| `onPhysicalPortClick` | Function | `frontend/src/pages/MapPage.tsx` | 604 |
| `openInsertion` | Function | `frontend/src/pages/MapPage.tsx` | 492 |
| `refreshWiringAfterRouteWrite` | Function | `frontend/src/pages/MapPage.tsx` | 615 |
| `refreshWiringProjection` | Function | `frontend/src/pages/MapPage.tsx` | 608 |
| `resetCableRoute` | Function | `frontend/src/pages/MapPage.tsx` | 1046 |
| `resizeBlueprint` | Function | `frontend/src/pages/MapPage.tsx` | 869 |
| `resolveInsertionPosition` | Function | `frontend/src/pages/MapPage.tsx` | 647 |
| `retryInsertionRefresh` | Function | `frontend/src/pages/MapPage.tsx` | 792 |
| `retryWiringRefresh` | Function | `frontend/src/pages/MapPage.tsx` | 645 |
| `retryWiringRoute` | Function | `frontend/src/pages/MapPage.tsx` | 644 |
| `saveWiringRoute` | Function | `frontend/src/pages/MapPage.tsx` | 619 |
| `selectedPlacementPosition` | Function | `frontend/src/pages/MapPage.tsx` | 1113 |
| `setViewMode` | Function | `frontend/src/pages/MapPage.tsx` | 564 |

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
