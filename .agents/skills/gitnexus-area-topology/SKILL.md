---
name: gitnexus-area-topology
description: "Skill for the Topology area of netmap. 294 symbols across 60 files."
---

# Topology

294 symbols | 60 files | Cohesion: 96%

## When to Use

- Working with code in `frontend/`
- Understanding how parsePhysicalObjectDetailsDocument, validateItems, parseDeviceDetailsDocument work
- Modifying topology-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `frontend/src/topology/apiSavedMapDataSource.ts` | cableRoute, error, malformed, mapRef, object (+20) |
| `frontend/src/topology/apiObjectBlueprintDataSource.ts` | backendError, isObject, malformed, parseBody, parseCanonicalRef (+17) |
| `frontend/src/topology/apiTopologyDataSource.ts` | isObject, malformed, parseProjectionDocument, readBackendError, requireObject (+14) |
| `frontend/src/topology/apiPhysicalObjectDetailsDataSource.ts` | errorMessage, isObject, malformed, parsePhysicalObjectDetailsDocument, validateItems (+11) |
| `frontend/src/topology/apiDeviceDetailsDataSource.ts` | isObject, malformed, parseDeviceDetailsDocument, readBackendError, requireCount (+11) |
| `frontend/src/topology/apiPortBlockDataSource.ts` | creation, error, isObject, malformed, object (+11) |
| `frontend/src/topology/apiBlueprintUpgradeDataSource.ts` | malformed, parseBlueprintUpgradeAnalysisDocument, parseChange, parseLibraryRef, parseStatus (+10) |
| `frontend/src/topology/apiCatalogInventoryDataSource.ts` | count, endpoint, exactKeys, isObject, label (+9) |
| `frontend/src/topology/apiPhysicalEndpointConnectionWriteDataSource.ts` | isObject, malformed, parsePhysicalEndpointConnectionCreationDocument, readBackendError, requireArray (+5) |
| `frontend/src/topology/layoutStore.ts` | applyTopologyPositionOverrides, topologyLayoutViewKey, isPosition, clear, key (+4) |

## Entry Points

Start here when exploring this area:

- **`parsePhysicalObjectDetailsDocument`** (Function) — `frontend/src/topology/apiPhysicalObjectDetailsDataSource.ts:66`
- **`validateItems`** (Function) — `frontend/src/topology/apiPhysicalObjectDetailsDataSource.ts:99`
- **`parseDeviceDetailsDocument`** (Function) — `frontend/src/topology/apiDeviceDetailsDataSource.ts:113`
- **`parseObjectBlueprintCreationDocument`** (Function) — `frontend/src/topology/apiObjectBlueprintDataSource.ts:80`
- **`parseObjectBlueprintInstantiationDocument`** (Function) — `frontend/src/topology/apiObjectBlueprintDataSource.ts:85`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `BlueprintUpgradeApiError` | Class | `frontend/src/topology/blueprintUpgradeTypes.ts` | 4 |
| `ApiTopologyDataSource` | Class | `frontend/src/topology/apiTopologyDataSource.ts` | 110 |
| `FixtureTopologyDataSource` | Class | `frontend/src/topology/fixtureTopologyDataSource.ts` | 68 |
| `ApiBlueprintUpgradeDataSource` | Class | `frontend/src/topology/apiBlueprintUpgradeDataSource.ts` | 109 |
| `ApiCatalogInventoryDataSource` | Class | `frontend/src/topology/apiCatalogInventoryDataSource.ts` | 27 |
| `ApiConnectionPointWriteDataSource` | Class | `frontend/src/topology/apiConnectionPointWriteDataSource.ts` | 31 |
| `ApiDeviceDetailsDataSource` | Class | `frontend/src/topology/apiDeviceDetailsDataSource.ts` | 146 |
| `ApiDeviceInterfaceWriteDataSource` | Class | `frontend/src/topology/apiDeviceInterfaceWriteDataSource.ts` | 33 |
| `ApiDeviceWriteDataSource` | Class | `frontend/src/topology/apiDeviceWriteDataSource.ts` | 31 |
| `ApiInterfacePhysicalTraceDataSource` | Class | `frontend/src/topology/apiInterfacePhysicalTraceDataSource.ts` | 94 |
| `ApiL2ForwardingContextWriteDataSource` | Class | `frontend/src/topology/apiL2ForwardingContextWriteDataSource.ts` | 76 |
| `ApiObjectBlueprintDataSource` | Class | `frontend/src/topology/apiObjectBlueprintDataSource.ts` | 97 |
| `ApiPhysicalEndpointConnectionWriteDataSource` | Class | `frontend/src/topology/apiPhysicalEndpointConnectionWriteDataSource.ts` | 92 |
| `ApiPhysicalLinkWriteDataSource` | Class | `frontend/src/topology/apiPhysicalLinkWriteDataSource.ts` | 80 |
| `ApiPhysicalObjectClassWriteDataSource` | Class | `frontend/src/topology/apiPhysicalObjectClassWriteDataSource.ts` | 17 |
| `ApiPhysicalObjectDeleteDataSource` | Class | `frontend/src/topology/apiPhysicalObjectDeleteDataSource.ts` | 22 |
| `PhysicalObjectDeletionError` | Class | `frontend/src/topology/apiPhysicalObjectDeleteDataSource.ts` | 15 |
| `ApiPhysicalObjectDetailsDataSource` | Class | `frontend/src/topology/apiPhysicalObjectDetailsDataSource.ts` | 118 |
| `ApiPhysicalObjectDisplayNameWriteDataSource` | Class | `frontend/src/topology/apiPhysicalObjectDisplayNameWriteDataSource.ts` | 17 |
| `ApiPhysicalObjectL1TraceDataSource` | Class | `frontend/src/topology/apiPhysicalObjectL1TraceDataSource.ts` | 23 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `OnNodeDragStop → BlueprintDisplayDimensions` | cross_community | 6 |
| `OnNodeDragStop → VisibleBlueprintFaces` | cross_community | 6 |
| `Load → IsObject` | cross_community | 6 |
| `Load → Malformed` | cross_community | 6 |
| `AddContinuationAtViewportCenter → BlueprintDisplayDimensions` | cross_community | 6 |
| `AddContinuationAtViewportCenter → VisibleBlueprintFaces` | cross_community | 6 |
| `SubmitInsertion → BlueprintDisplayDimensions` | cross_community | 6 |
| `SubmitInsertion → VisibleBlueprintFaces` | cross_community | 6 |
| `CreateObjectBlueprint → IsObject` | intra_community | 5 |
| `CreateObjectBlueprint → Malformed` | intra_community | 5 |

## How to Explore

1. `context({name: "parsePhysicalObjectDetailsDocument"})` — see callers and callees
2. `query({search_query: "topology"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
