import { useEffect, useRef, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ViewportPortal,
  useReactFlow,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  toFlowProjection,
  type DeviceFlowNode,
  type FlowProjection,
  type LogicalFlowEdge,
  type TopologyLayoutEngine,
} from "../topology/layout";
import type {
  TopologyProjectionDocument,
  TopologyProjectionNode,
  TopologySelection,
} from "../topology/types";
import {
  applyTopologyPositionOverrides,
  topologyLayoutViewKey,
  type TopologyLayoutStore,
} from "../topology/layoutStore";
import { DeviceNode } from "./DeviceNode";
import { FloatingTopologyEdge, ForegroundCableRoutes, WiringRoute } from "./FloatingTopologyEdge";
import { OffMapContinuationEdge } from "./OffMapContinuationEdge";
import type { PhysicalTraceOverlay } from "../topology/interfacePhysicalTraceOverlay";
import { physicalObjectIdForNode } from "../topology/projection";
import { perfMark, perfMeasure } from "../perfMarks";
import type { XYPosition } from "@xyflow/react";
import { overlapsAnyNode } from "../topology/nodeFootprint";
import type { MapCableRoute, MapRegion } from "../topology/savedMapTypes";
import { cableRouteForCollapsedCable } from "../topology/cableRoutePresentation";
import { cableIdForNode } from "../topology/projection";
import type { MapCableRouteWaypoint } from "../topology/savedMapTypes";
import { useI18n } from "../i18n";
import { blueprintNodeDisplayDimensions } from "../topology/blueprintDisplaySize";
import { MapRegionLayer, type MapReferenceOutline, type MapRegionDraft } from "./MapRegionLayer";

interface TopologyCanvasProps {
  document: TopologyProjectionDocument;
  selection: TopologySelection;
  onSelectionChange: (selection: TopologySelection) => void;
  layoutEngine?: TopologyLayoutEngine;
  layoutStore?: TopologyLayoutStore;
  traceOverlay?: PhysicalTraceOverlay;
  sceneKey?: string;
  positionOverrides?: Record<string, XYPosition>;
  displayWidthOverrides?: Record<string, number>;
  draggableNodeIds?: ReadonlySet<string>;
  lockedNodeIds?: ReadonlySet<string>;
  authoritativePositionRevision?: number;
  onPhysicalNodeDragStop?: (
    physicalObjectId: string,
    position: XYPosition,
  ) => void;
  onBlueprintDisplayResize?: (physicalObjectId: string, displayWidth: number) => void;
  onNodeCollisionRejected?: () => void;
  disableAutoLayout?: boolean;
  onViewportCenterReady?: (getter: (() => XYPosition) | null) => void;
  onPhysicalPaneContextMenu?: (anchor: XYPosition, screen: XYPosition) => void;
  onPhysicalNodeContextMenu?: (node: TopologyProjectionNode, screen: XYPosition) => void;
  onPhysicalCableContextMenu?: (node: TopologyProjectionNode, screen: XYPosition) => void;
  onPhysicalPortContextMenu?: (port: { physicalObjectId: string; connectionPointId: string; label: string }, screen: XYPosition) => void;
  onPaneClick?: (anchor: XYPosition) => void;
  onContinuationClickAnchor?: (
    continuationId: string,
    anchor: XYPosition,
  ) => void;
  cableRoutes?: readonly MapCableRoute[];
  cableRouteDraft?: { cableId: string; waypoints: readonly MapCableRouteWaypoint[]; selectedWaypointIndex: number | null; onWaypointSelect: (index: number) => void; onWaypointMove: (index: number, waypoint: MapCableRouteWaypoint) => void; onWaypointInsert: (index: number, waypoint: MapCableRouteWaypoint) => void; };
  physicalPortStates?: Record<string, 'eligible' | 'source' | 'destination' | 'unavailable'>;
  onPhysicalPortClick?: (port: { physicalObjectId: string; connectionPointId: string; label: string }) => void;
  wiringRoute?: { source: { physicalObjectId: string; connectionPointId: string }; target?: { physicalObjectId: string; connectionPointId: string }; waypoints: readonly MapCableRouteWaypoint[]; selectedWaypointIndex: number | null; onWaypointSelect: (index: number) => void; onWaypointMove: (index: number, waypoint: MapCableRouteWaypoint) => void; };
  wiringHighlightedConnectionMemberIds?: ReadonlySet<string>;
  wiringContinuationConnectionPointIds?: ReadonlySet<string>;
  regions?: readonly MapRegion[];
  regionMode?: { showReferenceOutlines: boolean; draft?: MapRegionDraft; onDraftPoint?: (point: XYPosition) => void; onCompleteDraft?: () => void };
}

const nodeTypes = { device: DeviceNode };
const edgeTypes = {
  floating: FloatingTopologyEdge,
  continuation: OffMapContinuationEdge,
};

interface ScreenPosition { x: number; y: number }
const REGION_DRAFT_CLOSE_RADIUS_PX = 12;

const isRegionDraftClosingTarget = ({
  draft,
  pointerScreen,
  flowToScreenPosition,
}: {
  draft: MapRegionDraft;
  pointerScreen: ScreenPosition;
  flowToScreenPosition: (position: XYPosition) => ScreenPosition;
}) => {
  if (draft.status !== 'drawing' || draft.points.length < 3) return false;
  const firstScreen = flowToScreenPosition(draft.points[0]);
  return Math.hypot(pointerScreen.x - firstScreen.x, pointerScreen.y - firstScreen.y) <= REGION_DRAFT_CLOSE_RADIUS_PX;
};

const regionDraftPointForPointer = ({
  points,
  pointerScreen,
  shiftKey,
  screenToFlowPosition,
  flowToScreenPosition,
}: {
  points: readonly XYPosition[];
  pointerScreen: ScreenPosition;
  shiftKey: boolean;
  screenToFlowPosition: (position: ScreenPosition) => XYPosition;
  flowToScreenPosition: (position: XYPosition) => ScreenPosition;
}): XYPosition => {
  if (!shiftKey || points.length === 0) return screenToFlowPosition(pointerScreen);

  const previousScreen = flowToScreenPosition(points.at(-1)!);
  const dx = pointerScreen.x - previousScreen.x;
  const dy = pointerScreen.y - previousScreen.y;
  const constrainedScreen = Math.abs(dx) >= Math.abs(dy)
    ? { x: pointerScreen.x, y: previousScreen.y }
    : { x: previousScreen.x, y: pointerScreen.y };
  return screenToFlowPosition(constrainedScreen);
};

export function TopologyCanvas({
  document,
  selection,
  onSelectionChange,
  layoutEngine = toFlowProjection,
  layoutStore,
  traceOverlay,
  sceneKey,
  positionOverrides,
  displayWidthOverrides,
  draggableNodeIds,
  lockedNodeIds,
  authoritativePositionRevision,
  onPhysicalNodeDragStop,
  onBlueprintDisplayResize,
  onNodeCollisionRejected,
  disableAutoLayout,
  onViewportCenterReady,
  onPhysicalPaneContextMenu,
  onPhysicalNodeContextMenu,
  onPhysicalCableContextMenu,
  onPhysicalPortContextMenu,
  onPaneClick,
  onContinuationClickAnchor,
  cableRoutes,
  cableRouteDraft,
  physicalPortStates,
  onPhysicalPortClick,
  wiringRoute,
  wiringHighlightedConnectionMemberIds,
  wiringContinuationConnectionPointIds,
  regions = [],
  regionMode,
}: TopologyCanvasProps) {
  const { t } = useI18n();
  const [projection, setProjection] = useState<FlowProjection | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [regionDraftPreview, setRegionDraftPreview] = useState<XYPosition | undefined>();
  const [regionDraftClosingTarget, setRegionDraftClosingTarget] = useState(false);
  const fitAfterLayout = useRef(false);
  const fittedSceneKey = useRef<string | null>(null);
  const appliedAuthoritativePositionRevision = useRef(
    authoritativePositionRevision,
  );
  const currentDocument = useRef(document);
  const appliedSceneKey = useRef<string | null>(null);
  const confirmedNodePositions = useRef(new Map<string, XYPosition>());
  const latestReferenceOutlines = useRef<MapReferenceOutline[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { fitView, screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  const viewKey = topologyLayoutViewKey(document);
  const presentationSceneKey = sceneKey ?? viewKey;

  currentDocument.current = document;

  useEffect(() => {
    let current = true;
    const sceneChanged = appliedSceneKey.current !== presentationSceneKey;
    appliedSceneKey.current = presentationSceneKey;
    if (sceneChanged) setProjection(null);
    setLayoutError(null);
    perfMark("layout-start");
    void layoutEngine(document).then(
      (nextProjection) => {
        if (!current || currentDocument.current !== document) return;
        const storedPositions =
          positionOverrides ?? layoutStore?.load(viewKey) ?? {};
        const next = {
          ...nextProjection,
          nodes: applyTopologyPositionOverrides(
            nextProjection.nodes,
            storedPositions,
          ).map((node) => {
            const blueprint = node.data.projection.attributes.blueprint_presentation;
            const displayWidth = displayWidthOverrides?.[node.id];
            return blueprint && displayWidth !== undefined
              ? { ...node, ...blueprintNodeDisplayDimensions(blueprint, displayWidth) }
              : node;
          }),
        };
        confirmedNodePositions.current = new Map(
          next.nodes.map((node) => [node.id, node.position]),
        );
        setProjection(next);
        perfMark("layout-end");
        perfMeasure("layout-duration", "layout-start", "layout-end");
      },
      (reason: unknown) => {
        if (!current) return;
        setLayoutError(
          reason instanceof Error
            ? reason.message
            : t("canvas.layoutFailed"),
        );
      },
    );
    return () => {
      current = false;
    };
  }, [document, layoutEngine, layoutRevision, layoutStore, t, viewKey]);

  useEffect(() => {
    if (!displayWidthOverrides) return;
    setProjection((current) => current ? {
      ...current,
      nodes: current.nodes.map((node) => {
        const blueprint = node.data.projection.attributes.blueprint_presentation;
        const displayWidth = displayWidthOverrides[node.id];
        return blueprint && displayWidth !== undefined
          ? { ...node, ...blueprintNodeDisplayDimensions(blueprint, displayWidth) }
          : node;
      }),
    } : current);
  }, [displayWidthOverrides]);

  // A position acknowledgement is already reflected by React Flow's drag state.
  // Only an explicit authoritative revision (for example, a failed persistence rollback)
  // may replace positions without rebuilding the layout scene.
  useEffect(() => {
    if (
      appliedAuthoritativePositionRevision.current ===
      authoritativePositionRevision
    )
      return;
    appliedAuthoritativePositionRevision.current =
      authoritativePositionRevision;
    if (!positionOverrides) return;
    setProjection((current) => {
      if (!current) return current;
      const nodes = applyTopologyPositionOverrides(
        current.nodes,
        positionOverrides,
      );
      confirmedNodePositions.current = new Map(
        nodes.map((node) => [node.id, node.position]),
      );
      return { ...current, nodes };
    });
  }, [authoritativePositionRevision]);

  useEffect(() => {
    if (!projection) return;
    const shouldFit =
      fitAfterLayout.current || fittedSceneKey.current !== presentationSceneKey;
    if (!shouldFit) return;
    fitAfterLayout.current = false;
    fittedSceneKey.current = presentationSceneKey;
    void fitView({ duration: 300, maxZoom: 1.1, padding: 0.2 });
    requestAnimationFrame(() => {
      perfMark("map-interactive");
      perfMeasure("time-to-map", "document-received", "map-interactive");
    });
  }, [fitView, presentationSceneKey, projection]);

  useEffect(() => {
    if (!onViewportCenterReady) return undefined;
    onViewportCenterReady(() => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) return { x: 0, y: 0 };
      return screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });
    });
    return () => onViewportCenterReady(null);
  }, [onViewportCenterReady, screenToFlowPosition]);

  if (layoutError) {
    return (
      <div className="topology-layout-state" role="alert">
        {layoutError}
      </div>
    );
  }
  if (!projection) {
    return (
      <div className="topology-layout-state" role="status">
        {t("canvas.layouting")}
      </div>
    );
  }

  const currentReferenceOutlines: MapReferenceOutline[] = projection.nodes
    .filter((node) => node.data.projection.kind === "PHYSICAL_OBJECT" && node.data.projection.attributes.class !== "cable")
    .map((node) => {
      return {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: node.measured?.width ?? node.width ?? 0,
        height: node.measured?.height ?? node.height ?? 0,
      };
    });
  if (!regionMode) latestReferenceOutlines.current = currentReferenceOutlines;
  const referenceOutlines = regionMode ? latestReferenceOutlines.current : currentReferenceOutlines;
  const nodes = (regionMode ? [] : projection.nodes).map((node) => ({
    ...node,
    draggable: draggableNodeIds
      ? draggableNodeIds.has(node.id) && !lockedNodeIds?.has(node.id)
      : lockedNodeIds?.has(node.id)
        ? false
        : undefined,
    data: {
      ...node.data,
      traceHighlighted: traceOverlay?.highlightedNodeIds.has(node.id) ?? false,
      traceHighlightedConnectionMemberIds:
        traceOverlay?.highlightedConnectionMemberIds ?? new Set<string>(),
      wiringHighlightedConnectionMemberIds,
      wiringContinuationConnectionPointIds,
      physicalPortStates,
      onPhysicalPortClick,
      onPhysicalPortContextMenu,
      onBlueprintDisplayResize,
      blueprintResizeEnabled: Boolean(onBlueprintDisplayResize) && !lockedNodeIds?.has(node.id),
    },
    selected: selection?.type === "node" && selection.item.id === node.id,
  }));
  const edges = (regionMode ? [] : projection.edges).map((edge) => {
    const cableRoute = document.layer === "L1" && document.detail_level === "PHYSICAL_OBJECT"
      ? cableRouteForCollapsedCable(edge.data?.cableNode, cableRoutes)
      : undefined;
    const matchingDraft = edge.data?.cableNode
      && cableRouteDraft
      && cableIdForNode(edge.data.cableNode) === cableRouteDraft.cableId
      ? cableRouteDraft
      : undefined;
    const isSelected = edge.data?.continuation
      ? selection?.type === "continuation" &&
        selection.item.id === edge.data.continuation.id
      : edge.data?.cableNode
        ? selection?.type === "node" &&
          selection.item.id === edge.data.cableNode.id
        : selection?.type === "edge" &&
          selection.item.id === edge.data?.projection.id;
    const isTraced = edge.data?.cableNode
      ? (edge.data.supportingEdgeIds?.every((id) =>
          traceOverlay?.highlightedEdgeIds.has(id),
        ) ?? false)
      : edge.data?.endpointPair
        ? (traceOverlay?.highlightedConnectionMemberIds.has(
            edge.data.endpointPair.connection_member_id,
          ) ?? false)
        : (traceOverlay?.highlightedEdgeIds.has(edge.id) ?? false);
    return {
      ...edge,
      data: edge.data ? { ...edge.data, ...(cableRoute ? { cableRoute } : {}), ...(matchingDraft ? { cableRouteDraft: matchingDraft, renderRouteEditorInForeground: true } : {}) } : edge.data,
      selected: isSelected,
      animated: isSelected || isTraced,
      style: {
        stroke: isSelected ? "#54e3b4" : isTraced ? "#f0bd66" : "#52676b",
        strokeWidth: isSelected ? 3 : isTraced ? 4 : 2,
        opacity: 1,
      },
    };
  });

  const onNodeClick: NodeMouseHandler<DeviceFlowNode> = (_, node) => {
    if (regionMode) return;
    onSelectionChange({ type: "node", item: node.data.projection });
  };
  const onEdgeClick: EdgeMouseHandler<LogicalFlowEdge> = (event, edge) => {
    if (regionMode) return;
    const item = edge.data?.projection;
    if (edge.data?.continuation) {
      onContinuationClickAnchor?.(
        edge.data.continuation.id,
        screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      );
      onSelectionChange({ type: "continuation", item: edge.data.continuation });
    } else if (edge.data?.cableNode)
      onSelectionChange({ type: "node", item: edge.data.cableNode });
    else if (item) onSelectionChange({ type: "edge", item });
  };
  const onNodeContextMenu: NodeMouseHandler<DeviceFlowNode> = (event, node) => {
    if (regionMode) return;
    event.preventDefault();
    const projectionNode = node.data.projection;
    if (cableIdForNode(projectionNode)) onPhysicalCableContextMenu?.(projectionNode, { x: event.clientX, y: event.clientY });
    else onPhysicalNodeContextMenu?.(projectionNode, { x: event.clientX, y: event.clientY });
  };
  const onEdgeContextMenu: EdgeMouseHandler<LogicalFlowEdge> = (event, edge) => {
    if (regionMode) return;
    if (!edge.data?.cableNode) return;
    event.preventDefault();
    onPhysicalCableContextMenu?.(edge.data.cableNode, { x: event.clientX, y: event.clientY });
  };
  const onNodesChange: OnNodesChange<DeviceFlowNode> = (changes) => {
    if (regionMode) return;
    setProjection((current) =>
      current
        ? {
            ...current,
            nodes: applyNodeChanges(changes, current.nodes),
          }
        : current,
    );
  };
  const onNodeDragStart: OnNodeDrag<DeviceFlowNode> = (_, node) => {
    if (regionMode) return;
    confirmedNodePositions.current.set(node.id, node.position);
  };
  const onNodeDragStop: OnNodeDrag<DeviceFlowNode> = (_, draggedNode) => {
    if (regionMode) return;
    const confirmedPosition = confirmedNodePositions.current.get(draggedNode.id);
    const placedNodes = draggableNodeIds
      ? projection.nodes.filter((node) => draggableNodeIds.has(node.id))
      : [];
    if (
      confirmedPosition &&
      draggableNodeIds?.has(draggedNode.id) &&
      overlapsAnyNode(draggedNode, placedNodes)
    ) {
      setProjection((current) =>
        current
          ? {
              ...current,
              nodes: current.nodes.map((node) =>
                node.id === draggedNode.id
                  ? { ...node, position: confirmedPosition }
                  : node,
              ),
            }
          : current,
      );
      onNodeCollisionRejected?.();
      return;
    }
    const physicalObjectId = physicalObjectIdForNode(
      draggedNode.data.projection,
    );
    if (onPhysicalNodeDragStop && physicalObjectId) {
      onPhysicalNodeDragStop(physicalObjectId, draggedNode.position);
      return;
    }
    if (!layoutStore) return;
    layoutStore.save(viewKey, {
      ...layoutStore.load(viewKey),
      [draggedNode.id]: draggedNode.position,
    });
  };
  const resetLayout = () => {
    layoutStore?.clear(viewKey);
    fitAfterLayout.current = true;
    setLayoutRevision((revision) => revision + 1);
  };

  return (
    <div
      className="topology-canvas"
      aria-label={
        document.layer === "L1"
          ? t("canvas.physical")
          : t("canvas.logical")
      }
      ref={canvasRef}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={(event) => {
          if (regionMode) {
            if (regionMode.draft?.status === 'drawing') {
              const pointerScreen = { x: event.clientX, y: event.clientY };
              if (isRegionDraftClosingTarget({ draft: regionMode.draft, pointerScreen, flowToScreenPosition })) {
                regionMode.onCompleteDraft?.();
                return;
              }
              regionMode.onDraftPoint?.(regionDraftPointForPointer({
                points: regionMode.draft.points,
                pointerScreen,
                shiftKey: event.shiftKey,
                screenToFlowPosition,
                flowToScreenPosition,
              }));
            }
            return;
          }
          const anchor = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          onSelectionChange(null);
          onPaneClick?.(anchor);
        }}
        onPaneMouseMove={(event) => {
          if (regionMode?.draft?.status === 'drawing') {
            const pointerScreen = { x: event.clientX, y: event.clientY };
            const closingTarget = isRegionDraftClosingTarget({ draft: regionMode.draft, pointerScreen, flowToScreenPosition });
            setRegionDraftClosingTarget(closingTarget);
            setRegionDraftPreview(closingTarget ? regionMode.draft.points[0] : regionDraftPointForPointer({
              points: regionMode.draft.points,
              pointerScreen,
              shiftKey: event.shiftKey,
              screenToFlowPosition,
              flowToScreenPosition,
            }));
          }
        }}
        onPaneContextMenu={(event) => {
          if (regionMode || !onPhysicalPaneContextMenu) return;
          event.preventDefault();
          onPhysicalPaneContextMenu(
            screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            { x: event.clientX, y: event.clientY },
          );
        }}
        fitView={false}
        fitViewOptions={{
          padding: 0.2,
          maxZoom: document.layer === "L1" ? 4 : 1.1,
        }}
        minZoom={0.35}
        maxZoom={document.layer === "L1" ? 4 : 1.8}
        nodesDraggable={!regionMode && (
          Boolean(onPhysicalNodeDragStop) ||
          (!disableAutoLayout && document.layer === "L1")
        )}
        nodesConnectable={false}
        elementsSelectable={!regionMode}
        proOptions={{ hideAttribution: true }}
      >
        <Panel position="top-left">
          {!disableAutoLayout && (
            <button
              type="button"
              className="topology-auto-layout"
              onClick={resetLayout}
            >
              {t("canvas.autoLayout")}
            </button>
          )}
        </Panel>
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.4}
          color="#25383c"
        />
        {document.layer === "L1" && document.detail_level === "PHYSICAL_OBJECT" && (regions.length > 0 || regionMode) && (
          <ViewportPortal>
            <MapRegionLayer
              regions={regions}
              referenceOutlines={referenceOutlines}
              showReferenceOutlines={Boolean(regionMode?.showReferenceOutlines)}
              draft={regionMode?.draft && { ...regionMode.draft, previewPoint: regionMode.draft.status === 'drawing' ? regionDraftPreview : undefined, closingTarget: regionDraftClosingTarget }}
            />
          </ViewportPortal>
        )}
        <MiniMap
          pannable
          zoomable
          position="top-right"
          nodeColor="#183b3b"
          maskColor="rgba(5, 13, 15, 0.72)"
          ariaLabel={t("canvas.minimap")}
        />
        <Controls showInteractive={false} position="bottom-left" />
        {!regionMode && <ForegroundCableRoutes edges={edges} physicalPortStates={physicalPortStates} />}
        {!regionMode && wiringRoute && <ViewportPortal><svg className="cable-routes-foreground cable-routes-foreground--wiring" aria-hidden="true"><WiringRoute {...wiringRoute} /></svg></ViewportPortal>}
      </ReactFlow>
    </div>
  );
}
