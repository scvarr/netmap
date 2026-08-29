---
name: gitnexus-area-components
description: "Skill for the Components area of netmap. 157 symbols across 36 files."
---

# Components

157 symbols | 36 files | Cohesion: 78%

## When to Use

- Working with code in `frontend/`
- Understanding how QuickInspector, activeOperationFor, add work
- Modifying components-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `frontend/src/components/PhysicalObjectDetailsSection.tsx` | PhysicalObjectClassEditor, submit, PhysicalObjectDetailsSection, PortActions, SourceRefs (+15) |
| `frontend/src/components/QuickInspector.tsx` | QuickInspector, activeOperationFor, add, destroy, operationFor (+8) |
| `frontend/src/topology/presentation.ts` | displayNodeLabel, displayNodeLabelForLocale, shortId, displayCount, displayCountForLocale (+5) |
| `frontend/src/components/TraceCommandBar.test.tsx` | Harness, artifact, details, loadDetails, loadDetails (+4) |
| `frontend/src/components/ConnectPhysicalEndpoint.tsx` | ConnectPhysicalEndpoint, reset, submit, label, sort (+4) |
| `frontend/src/components/TopologyCanvas.test.tsx` | flowFor, layoutEngine, layoutEngine, layoutEngine, layoutEngine (+3) |
| `frontend/src/components/FloatingTopologyEdge.tsx` | FloatingTopologyEdge, exact, WiringRoute, getFloatingEndpoints, intersection (+2) |
| `frontend/src/components/TraceCommandBar.tsx` | PortRefinement, TraceCommandBar, selectDestination, selectSource, submit (+2) |
| `frontend/src/components/ConnectPhysicalEndpoint.test.tsx` | create, document, load, node, point (+2) |
| `frontend/src/components/DeviceInterfacesSection.tsx` | InterfaceCard, InterfaceTechnicalDetails, SourceRefs, displayInterfaceLabel, shortId (+2) |

## Entry Points

Start here when exploring this area:

- **`QuickInspector`** (Function) — `frontend/src/components/QuickInspector.tsx:85`
- **`activeOperationFor`** (Function) — `frontend/src/components/QuickInspector.tsx:213`
- **`add`** (Function) — `frontend/src/components/QuickInspector.tsx:280`
- **`destroy`** (Function) — `frontend/src/components/QuickInspector.tsx:230`
- **`operationFor`** (Function) — `frontend/src/components/QuickInspector.tsx:209`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `QuickInspector` | Function | `frontend/src/components/QuickInspector.tsx` | 85 |
| `activeOperationFor` | Function | `frontend/src/components/QuickInspector.tsx` | 213 |
| `add` | Function | `frontend/src/components/QuickInspector.tsx` | 280 |
| `destroy` | Function | `frontend/src/components/QuickInspector.tsx` | 230 |
| `operationFor` | Function | `frontend/src/components/QuickInspector.tsx` | 209 |
| `remove` | Function | `frontend/src/components/QuickInspector.tsx` | 215 |
| `shell` | Function | `frontend/src/components/QuickInspector.tsx` | 172 |
| `togglePlacementLock` | Function | `frontend/src/components/QuickInspector.tsx` | 254 |
| `displayNodeLabel` | Function | `frontend/src/topology/presentation.ts` | 29 |
| `displayNodeLabelForLocale` | Function | `frontend/src/topology/presentation.ts` | 33 |
| `Inspector` | Function | `frontend/src/components/Inspector.tsx` | 117 |
| `displayCount` | Function | `frontend/src/topology/presentation.ts` | 64 |
| `displayCountForLocale` | Function | `frontend/src/topology/presentation.ts` | 65 |
| `displayStatus` | Function | `frontend/src/topology/presentation.ts` | 47 |
| `displayStatusForLocale` | Function | `frontend/src/topology/presentation.ts` | 48 |
| `numericAttribute` | Function | `frontend/src/topology/presentation.ts` | 56 |
| `FloatingTopologyEdge` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 135 |
| `exact` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 151 |
| `WiringRoute` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 107 |
| `getFloatingEndpoints` | Function | `frontend/src/components/FloatingTopologyEdge.tsx` | 50 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `InfrastructureObjectDetailPage → Ref` | cross_community | 7 |
| `InfrastructureObjectDetailPage → Ref` | cross_community | 7 |
| `PortRow → Ref` | cross_community | 6 |
| `PortRow → Ref` | cross_community | 6 |
| `Update → Clamp` | cross_community | 5 |
| `PortRow → Details` | cross_community | 5 |
| `InfrastructureObjectDetailPage → PhysicalClassPresentationForLocale` | cross_community | 5 |
| `InfrastructureObjectDetailPage → Delayed` | cross_community | 5 |
| `Update → SnapAxis` | cross_community | 4 |
| `BlueprintPreviewViewport → VisibleBlueprintThumbnailFaces` | intra_community | 4 |

## How to Explore

1. `context({name: "QuickInspector"})` — see callers and callees
2. `query({search_query: "components"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
