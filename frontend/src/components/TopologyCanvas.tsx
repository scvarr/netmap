import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
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
  type DeviceNodeData,
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
import type { MapCableRouteWaypoint, MapTextAnnotation } from "../topology/savedMapTypes";
import { useI18n } from "../i18n";
import { blueprintNodeDisplayDimensions } from "../topology/blueprintDisplaySize";
import { presentationSceneDocument, type MapCompositeSceneInput } from "../topology/presentationScene";
import { MapRegionLayer, type MapReferenceOutline, type MapRegionDraft } from "./MapRegionLayer";
import { RegionDraftEditor, type RegionDraftPointerTarget, type RegionDraftSegmentFeedback } from './RegionDraftEditor';
import { assistSegment, type SegmentAssistResult } from '../topology/geometryAssist';

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
  compositeInputs?: readonly MapCompositeSceneInput[];
  cableRouteDraft?: { cableId: string; waypoints: readonly MapCableRouteWaypoint[]; selectedWaypointIndex: number | null; onWaypointSelect: (index: number) => void; onWaypointMove: (index: number, waypoint: MapCableRouteWaypoint) => void; onWaypointInsert: (index: number, waypoint: MapCableRouteWaypoint) => void; };
  physicalPortStates?: Record<string, 'eligible' | 'source' | 'destination' | 'unavailable'>;
  onPhysicalPortClick?: (port: { physicalObjectId: string; connectionPointId: string; label: string }) => void;
  wiringRoute?: { source: { physicalObjectId: string; connectionPointId: string }; target?: { physicalObjectId: string; connectionPointId: string }; waypoints: readonly MapCableRouteWaypoint[]; selectedWaypointIndex: number | null; onWaypointSelect: (index: number) => void; onWaypointMove: (index: number, waypoint: MapCableRouteWaypoint) => void; };
  wiringHighlightedConnectionMemberIds?: ReadonlySet<string>;
  wiringContinuationConnectionPointIds?: ReadonlySet<string>;
  regions?: readonly MapRegion[];
  textAnnotations?: readonly MapTextAnnotation[];
  selectedRegionId?: string | null;
  /** Session-only Region→Location reading aid; no map or topology mutation follows. */
  locationFocusObjectIds?: ReadonlySet<string> | null;
  regionMode?: { showReferenceOutlines: boolean; draft?: MapRegionDraft; editableDraft?: boolean; invalidDraft?: boolean; hiddenRegionId?: string | null; previewRegion?: MapRegion; editableLabelRegionId?: string | null; onMoveLabel?: (position: XYPosition) => void; annotationPlacement?: boolean; previewAnnotation?: MapTextAnnotation; selectedAnnotationId?: string | null; editableAnnotationId?: string | null; onAnnotationPlace?: (position: XYPosition) => void; onAnnotationSelect?: (annotationId: string) => void; onMoveAnnotation?: (annotationId: string, position: XYPosition) => void; onDraftPoint?: (point: XYPosition) => void; onCompleteDraft?: () => void; onMoveDraftVertex?: (index: number, point: XYPosition) => void; onInsertDraftVertex?: (edgeStartIndex: number, point: XYPosition) => void; onTranslateDraft?: (delta: XYPosition) => void; onSelectDraftVertex?: (index: number | null) => void };
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

const regionDraftAssistForPointer = ({
  points,
  pointerScreen,
  shiftKey, ctrlKey,
  screenToFlowPosition,
  flowToScreenPosition,
}: {
  points: readonly XYPosition[];
  pointerScreen: ScreenPosition;
  shiftKey: boolean; ctrlKey: boolean;
  screenToFlowPosition: (position: ScreenPosition) => XYPosition;
  flowToScreenPosition: (position: XYPosition) => ScreenPosition;
}): SegmentAssistResult | undefined => {
  if (points.length === 0) return undefined;
  return assistSegment({ anchor: points.at(-1)!, pointerScreen, shiftKey, ctrlKey, screenToFlowPosition, flowToScreenPosition });
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
  compositeInputs,
  cableRouteDraft,
  physicalPortStates,
  onPhysicalPortClick,
  wiringRoute,
  wiringHighlightedConnectionMemberIds,
  wiringContinuationConnectionPointIds,
  regions = [],
  textAnnotations = [],
  selectedRegionId,
  locationFocusObjectIds,
  regionMode,
}: TopologyCanvasProps) {
  const { t } = useI18n();
  const [projection, setProjection] = useState<FlowProjection | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [regionDraftPreview, setRegionDraftPreview] = useState<XYPosition | undefined>();
  const [regionDraftAssist, setRegionDraftAssist] = useState<SegmentAssistResult | undefined>();
  const [regionDraftEditorFeedback, setRegionDraftEditorFeedback] = useState<readonly RegionDraftSegmentFeedback[]>([]);
  const [regionDraftClosingTarget, setRegionDraftClosingTarget] = useState(false);
  const regionDraftDrag = useRef<{ kind: 'vertex'; index: number } | { kind: 'polygon'; last: XYPosition } | { kind: 'label' } | { kind: 'annotation'; id: string } | null>(null);
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
  const presentationScene = useMemo(() => presentationSceneDocument(document, compositeInputs), [document, compositeInputs]);

  currentDocument.current = document;

  useEffect(() => {
    if (!regionMode?.editableDraft && !regionMode?.editableLabelRegionId) regionDraftDrag.current = null;
  }, [regionMode?.editableDraft, regionMode?.editableLabelRegionId]);

  useEffect(() => {
    const onPointerMove = (event: globalThis.PointerEvent) => {
      const drag = regionDraftDrag.current;
      if (!drag) return;
      const pointerScreen = { x: event.clientX, y: event.clientY };
      const point = screenToFlowPosition(pointerScreen);
      if (drag.kind === 'label') {
        regionMode?.onMoveLabel?.(point);
        return;
      }
      if (drag.kind === 'annotation') {
        regionMode?.onMoveAnnotation?.(drag.id, point);
        return;
      }
      if (!regionMode?.editableDraft || !regionMode.draft || regionMode.draft.status !== 'editing') return;
      if (drag.kind === 'vertex') {
        const points = regionMode.draft.points;
        const previousIndex = (drag.index + points.length - 1) % points.length;
        const nextIndex = (drag.index + 1) % points.length;
        const candidates = [previousIndex, nextIndex].map((anchorIndex) => ({ anchorIndex, assist: assistSegment({ anchor: points[anchorIndex], pointerScreen, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, screenToFlowPosition, flowToScreenPosition }) }));
        const chosen = candidates.reduce((best, candidate) => {
          const bestDistance = Math.hypot(flowToScreenPosition(best.assist.point).x - pointerScreen.x, flowToScreenPosition(best.assist.point).y - pointerScreen.y);
          const candidateDistance = Math.hypot(flowToScreenPosition(candidate.assist.point).x - pointerScreen.x, flowToScreenPosition(candidate.assist.point).y - pointerScreen.y);
          return candidateDistance < bestDistance ? candidate : best;
        });
        regionMode.onMoveDraftVertex?.(drag.index, chosen.assist.point);
        const edited = points.map((current, index) => index === drag.index ? chosen.assist.point : current);
        setRegionDraftEditorFeedback([
          { start: edited[previousIndex], end: edited[drag.index], snappedAngle: chosen.anchorIndex === previousIndex && chosen.assist.snappedAngle, snappedLength: chosen.anchorIndex === previousIndex && chosen.assist.snappedLength },
          { start: edited[drag.index], end: edited[nextIndex], snappedAngle: chosen.anchorIndex === nextIndex && chosen.assist.snappedAngle, snappedLength: chosen.anchorIndex === nextIndex && chosen.assist.snappedLength },
        ]);
      }
      else {
        regionMode.onTranslateDraft?.({ x: point.x - drag.last.x, y: point.y - drag.last.y });
        drag.last = point;
      }
    };
    const finish = () => { regionDraftDrag.current = null; setRegionDraftEditorFeedback([]); };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => { window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); };
  }, [flowToScreenPosition, regionMode, screenToFlowPosition]);

  const onRegionDraftEditorPointerDown = (target: RegionDraftPointerTarget, event: PointerEvent<SVGElement>) => {
    if (!regionMode?.editableDraft || regionMode.draft?.status !== 'editing') return;
    event.preventDefault(); event.stopPropagation();
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (target.kind === 'vertex') {
      regionMode.onSelectDraftVertex?.(target.index);
      regionDraftDrag.current = target;
    } else if (target.kind === 'midpoint') {
      const insertedIndex = target.index + 1;
      regionMode.onInsertDraftVertex?.(target.index, point);
      regionDraftDrag.current = { kind: 'vertex', index: insertedIndex };
    } else {
      regionMode.onSelectDraftVertex?.(null);
      regionDraftDrag.current = { kind: 'polygon', last: point };
    }
  };

  const onRegionLabelPointerDown = (event: PointerEvent<SVGTextElement>) => {
    if (!regionMode?.editableLabelRegionId) return;
    event.preventDefault(); event.stopPropagation();
    regionDraftDrag.current = { kind: 'label' };
  };
  const onAnnotationPointerDown = (annotationId: string, event: PointerEvent<SVGTextElement>) => {
    if (regionMode?.editableAnnotationId !== annotationId) return;
    event.preventDefault(); event.stopPropagation();
    regionDraftDrag.current = { kind: 'annotation', id: annotationId };
  };

  useEffect(() => {
    let current = true;
    const sceneChanged = appliedSceneKey.current !== presentationSceneKey;
    appliedSceneKey.current = presentationSceneKey;
    if (sceneChanged) setProjection(null);
    setLayoutError(null);
    perfMark("layout-start");
    void layoutEngine(presentationScene).then(
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
  }, [document, layoutEngine, layoutRevision, layoutStore, presentationScene, t, viewKey]);

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
  const nodes = (regionMode ? [] : projection.nodes).map((node) => {
    const objectId = physicalObjectIdForNode(node.data.projection);
    const locationFocus: DeviceNodeData['locationFocus'] = locationFocusObjectIds && objectId
      ? (locationFocusObjectIds.has(objectId) ? 'match' : 'dim')
      : undefined;
    return ({
    ...node,
    draggable: draggableNodeIds
      ? draggableNodeIds.has(node.id) && !lockedNodeIds?.has(node.id)
      : lockedNodeIds?.has(node.id)
        ? false
        : undefined,
    data: {
      ...node.data,
      locationFocus,
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
    });
  });
  const edges = (regionMode ? [] : projection.edges).map((edge) => {
    const cableRoute = document.layer === "L1" && document.detail_level === "PHYSICAL_OBJECT"
      ? cableRouteForCollapsedCable(edge.data?.cableNode, cableRoutes)
      : undefined;
    const matchingDraft = edge.data?.cableNode
      && cableRouteDraft
      && cableIdForNode(edge.data.cableNode) === cableRouteDraft.cableId
      ? cableRouteDraft
      : undefined;
    const tracedCableId = edge.data?.cableNode
      ? cableIdForNode(edge.data.cableNode)
      : null;
    const isSelected = edge.data?.continuation
      ? selection?.type === "continuation" &&
        selection.item.id === edge.data.continuation.id
      : edge.data?.cableNode
        ? selection?.type === "node" &&
          selection.item.id === edge.data.cableNode.id
        : selection?.type === "edge" &&
          selection.item.id === edge.data?.projection?.id;
    const isTraced = tracedCableId !== null
      ? (traceOverlay?.highlightedCableIds.has(tracedCableId) ?? false)
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
            if (regionMode.annotationPlacement) {
              regionMode.onAnnotationPlace?.(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
              return;
            }
            if (regionMode.draft?.status === 'drawing') {
              const pointerScreen = { x: event.clientX, y: event.clientY };
              if (isRegionDraftClosingTarget({ draft: regionMode.draft, pointerScreen, flowToScreenPosition })) {
                regionMode.onCompleteDraft?.();
                return;
              }
              const assist = regionDraftAssistForPointer({
                points: regionMode.draft.points,
                pointerScreen,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                screenToFlowPosition,
                flowToScreenPosition,
              });
              regionMode.onDraftPoint?.(assist?.point ?? screenToFlowPosition(pointerScreen));
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
            const assist = closingTarget ? undefined : regionDraftAssistForPointer({
              points: regionMode.draft.points,
              pointerScreen,
              shiftKey: event.shiftKey,
              ctrlKey: event.ctrlKey,
              screenToFlowPosition,
              flowToScreenPosition,
            });
            setRegionDraftAssist(assist);
            setRegionDraftPreview(closingTarget ? regionMode.draft.points[0] : assist?.point);
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
        panOnDrag={!regionMode?.editableDraft && !regionMode?.editableLabelRegionId}
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
        {document.layer === "L1" && document.detail_level === "PHYSICAL_OBJECT" && (regions.length > 0 || textAnnotations.length > 0 || regionMode) && (
          <ViewportPortal>
            <MapRegionLayer
              regions={regions}
              selectedRegionId={selectedRegionId}
              hiddenRegionId={regionMode?.hiddenRegionId}
              previewRegion={regionMode?.previewRegion}
              interactiveLabelRegionId={regionMode?.editableLabelRegionId}
              onLabelPointerDown={onRegionLabelPointerDown}
              annotations={textAnnotations}
              previewAnnotation={regionMode?.previewAnnotation}
              selectedAnnotationId={regionMode?.selectedAnnotationId}
              interactiveAnnotationId={regionMode?.editableAnnotationId}
              onAnnotationPointerDown={onAnnotationPointerDown}
              onAnnotationClick={(annotationId) => regionMode?.onAnnotationSelect?.(annotationId)}
              referenceOutlines={referenceOutlines}
              showReferenceOutlines={Boolean(regionMode?.showReferenceOutlines)}
              draft={regionMode?.draft && { ...regionMode.draft, previewPoint: regionMode.draft.status === 'drawing' ? regionDraftPreview : undefined, closingTarget: regionDraftClosingTarget, assist: regionDraftAssist }}
            />
            {regionMode?.draft?.status === 'editing' && <RegionDraftEditor points={regionMode.draft.points} selectedVertexIndex={regionMode.draft.selectedVertexIndex ?? null} invalid={Boolean(regionMode.invalidDraft)} interactive={Boolean(regionMode.editableDraft)} feedback={regionDraftEditorFeedback} onPointerDown={onRegionDraftEditorPointerDown} />}
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
