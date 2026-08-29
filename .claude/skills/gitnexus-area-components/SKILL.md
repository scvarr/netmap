---
name: gitnexus-area-components
description: "Skill for the Components area of netmap. 200 symbols across 55 files."
---

# Components

200 symbols | 55 files | Cohesion: 78%

## When to Use

- Working with code in `frontend/`
- Understanding how DeviceNode, portProps, FloatingTopologyEdge work
- Modifying components-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `frontend/src/components/PhysicalObjectDetailsSection.tsx` | PhysicalObjectClassEditor, submit, DisconnectPhysicalConnection, disconnect, displayPointLabel (+17) |
| `frontend/src/components/FloatingTopologyEdge.tsx` | FloatingTopologyEdge, exact, ForegroundCableRoute, ForegroundCableRoutes, ForegroundNodePortMarkers (+8) |
| `frontend/src/components/QuickInspector.tsx` | QuickInspector, activeOperationFor, add, destroy, operationFor (+8) |
| `frontend/src/topology/presentation.ts` | displayNodeLabel, displayNodeLabelForLocale, shortId, displayCount, displayCountForLocale (+4) |
| `frontend/src/components/TraceCommandBar.test.tsx` | Harness, artifact, details, loadDetails, loadDetails (+4) |
| `frontend/src/components/ConnectPhysicalEndpoint.tsx` | ConnectPhysicalEndpoint, reset, submit, label, sort (+4) |
| `frontend/src/components/TopologyCanvas.test.tsx` | flowFor, layoutEngine, layoutEngine, layoutEngine, layoutEngine (+3) |
| `frontend/src/components/TraceCommandBar.tsx` | PortRefinement, TraceCommandBar, selectDestination, selectSource, submit (+2) |
| `frontend/src/components/ConnectPhysicalEndpoint.test.tsx` | create, document, load, node, point (+2) |
| `frontend/src/components/DeviceInterfacesSection.tsx` | InterfaceCard, InterfaceTechnicalDetails, SourceRefs, displayInterfaceLabel, shortId (+2) |

## Entry Points

Start here when exploring this area:

- **`DeviceNode`** (Function) — `frontend/src/components/DeviceNode.tsx:11`
- **`portProps`** (Function) — `frontend/src/components/DeviceNode.tsx:17`
- **`FloatingTopologyEdge`** (Function) — `frontend/src/components/FloatingTopologyEdge.tsx:161`
- **`exact`** (Function) — `frontend/src/components/FloatingTopologyEdge.tsx:177`
- **`ForegroundCableRoutes`** (Function) — `frontend/src/components/FloatingTopologyEdge.tsx:284`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `DeviceNode` | Function | `frontend/src/components/DeviceNode.tsx` | 11 |
| `portProps` | Function | `frontend/src/components/DeviceNode.tsx` | 17 |
| `FloatingTopologyEdge` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 161 |
| `exact` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 177 |
| `ForegroundCableRoutes` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 284 |
| `WiringRoute` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 130 |
| `getConnectionPointEndpoint` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 76 |
| `getFloatingEndpoints` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 51 |
| `getRenderedConnectionPoint` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 100 |
| `routedCablePath` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 121 |
| `InternalL1Continuity` | Function | `frontend/src/components/InternalL1Continuity.tsx` | 8 |
| `OffMapContinuationEdge` | Function | `frontend/src/components/OffMapContinuationEdge.tsx` | 28 |
| `blueprintDisplayDimensions` | Function | `frontend/src/topology/blueprintDisplaySize.ts` | 22 |
| `blueprintNodeDisplayDimensions` | Function | `frontend/src/topology/blueprintDisplaySize.ts` | 30 |
| `blueprintObjectLabelFontSize` | Function | `frontend/src/topology/blueprintDisplaySize.ts` | 70 |
| `minimumBlueprintDisplayWidth` | Function | `frontend/src/topology/blueprintDisplaySize.ts` | 42 |
| `visibleBlueprintFaces` | Function | `frontend/src/topology/blueprintDisplaySize.ts` | 15 |
| `genericConnectionPoints` | Function | `frontend/src/topology/genericEndpointPresentation.ts` | 4 |
| `genericEndpointOffset` | Function | `frontend/src/topology/genericEndpointPresentation.ts` | 10 |
| `internalL1Segments` | Function | `frontend/src/topology/internalL1Presentation.ts` | 37 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `InfrastructureObjectDetailPage → Ref` | cross_community | 7 |
| `InfrastructureObjectDetailPage → Ref` | cross_community | 7 |
| `PortRow → ShortId` | cross_community | 6 |
| `OnNodeDragStop → BlueprintDisplayDimensions` | cross_community | 6 |
| `OnNodeDragStop → VisibleBlueprintFaces` | cross_community | 6 |
| `PortRow → Ref` | cross_community | 6 |
| `PortRow → Ref` | cross_community | 6 |
| `AddContinuationAtViewportCenter → BlueprintDisplayDimensions` | cross_community | 6 |
| `AddContinuationAtViewportCenter → VisibleBlueprintFaces` | cross_community | 6 |
| `SubmitInsertion → BlueprintDisplayDimensions` | cross_community | 6 |

## How to Explore

1. `context({name: "DeviceNode"})` — see callers and callees
2. `query({search_query: "components"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
