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
import { FloatingTopologyEdge, ForegroundCableRoutes, WiringRoute, getFloatingEndpoints, getRenderedConnectionPoint } from "./FloatingTopologyEdge";
import { OffMapContinuationEdge } from "./OffMapContinuationEdge";
import type { PhysicalTraceOverlay } from "../topology/interfacePhysicalTraceOverlay";
import { physicalObjectIdForNode } from "../topology/projection";
import { perfMark, perfMeasure } from "../perfMarks";
import type { XYPosition } from "@xyflow/react";
import { overlapsAnyNode } from "../topology/nodeFootprint";
import type { MapCableRoute } from "../topology/savedMapTypes";
import { cableRouteForCollapsedCable } from "../topology/cableRoutePresentation";
import { cableIdForNode } from "../topology/projection";
import type { MapCableRouteWaypoint, MapTextAnnotation } from "../topology/savedMapTypes";
import { useI18n } from "../i18n";
import { blueprintNodeDisplayDimensions } from "../topology/blueprintDisplaySize";
import { blueprintMapNameplateHeight } from "../topology/blueprintDisplaySize";
import { nodeFootprint, type FlowRectangle } from "../topology/nodeFootprint";
import { deriveLocationPresentation, projectCollapsedEdges } from "../topology/locationFrames";
import type { LocationDocument } from "../topology/locationTypes";
import type { LocationGroupMove, MapLocationState, MapPlacement } from "../topology/savedMapTypes";
import { prepareLocationGroupMove, type GroupCableGeometry } from "../topology/locationGroupMove";
import { presentationSceneDocument } from "../topology/presentationScene";
import { MapTextAnnotationLayer } from "./MapTextAnnotationLayer";
import { LocationProxyNode } from "./LocationProxyNode";
import { normalizeLocationBoundaryAnchors, projectBoundaryWaypoint, resolveBoundaryWaypoint } from "../topology/locationBoundaryAnchors";

interface TopologyCanvasProps {
  document: TopologyProjectionDocument;
  selection: TopologySelection;
  onSelectionChange: (selection: TopologySelection) => void;
  layoutEngine?: TopologyLayoutEngine;
  layoutStore?: TopologyLayoutStore;
  traceOverlay?: PhysicalTraceOverlay;
  /** Exact Cable ids directly attached to the selected PhysicalObject. */
  directlyAttachedCableIds?: ReadonlySet<string>;
  sceneKey?: string;
  /** Request one fit after a fresh layout has been applied. */
  viewportFitRevision?: number;
  /** A one-shot presentation request to reveal a physical object. */
  focusPhysicalObjectId?: string | null;
  positionOverrides?: Record<string, XYPosition>;
  /** New authoritative SavedMap placement snapshot, including variant switches and refreshes. */
  positionSnapshot?: readonly MapPlacement[];
  displayWidthOverrides?: Record<string, number>;
  locationFrameInput?: { locations: readonly LocationDocument[]; placements: readonly MapPlacement[]; states?: readonly MapLocationState[]; onCollapse?: (locationId: string, collapsed: boolean) => void; onConfigure?: (locationId: string) => void; onGroupMove?: (locationId: string, move: LocationGroupMove) => void; onGroupMoveRejected?: (message: string) => void };
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
  routeNormalizerRef?: { current: ((cableId: string, waypoints: readonly MapCableRouteWaypoint[]) => MapCableRouteWaypoint[]) | null };
  physicalPortStates?: Record<string, 'eligible' | 'source' | 'destination' | 'unavailable'>;
  onPhysicalPortClick?: (port: { physicalObjectId: string; connectionPointId: string; label: string }) => void;
  wiringRoute?: { source: { physicalObjectId: string; connectionPointId: string }; target?: { physicalObjectId: string; connectionPointId: string }; waypoints: readonly MapCableRouteWaypoint[]; selectedWaypointIndex: number | null; onWaypointSelect: (index: number) => void; onWaypointMove: (index: number, waypoint: MapCableRouteWaypoint) => void; };
  wiringHighlightedConnectionMemberIds?: ReadonlySet<string>;
  wiringContinuationConnectionPointIds?: ReadonlySet<string>;
  textAnnotations?: readonly MapTextAnnotation[];
  annotationMode?: { annotationPlacement?: boolean; previewAnnotation?: MapTextAnnotation; selectedAnnotationId?: string | null; editableAnnotationId?: string | null; onAnnotationPlace?: (position: XYPosition) => void; onAnnotationSelect?: (annotationId: string) => void; onMoveAnnotation?: (annotationId: string, position: XYPosition) => void };

}

const nodeTypes = { device: DeviceNode, locationProxy: LocationProxyNode };
const edgeTypes = {
  floating: FloatingTopologyEdge,
  continuation: OffMapContinuationEdge,
};

const hasRenderableBounds = (bounds: FlowRectangle) =>
  Number.isFinite(bounds.x) && Number.isFinite(bounds.y) &&
  Number.isFinite(bounds.width) && Number.isFinite(bounds.height) &&
  bounds.width > 0 && bounds.height > 0;

interface FrameDrag {
  pointerId: number;
  locationId: string;
  start: XYPosition;
  bounds: FlowRectangle;
}

interface FrameDragPreview extends FrameDrag {
  delta: XYPosition;
}

export function TopologyCanvas({
  document,
  selection,
  onSelectionChange,
  layoutEngine = toFlowProjection,
  layoutStore,
  traceOverlay,
  directlyAttachedCableIds,
  sceneKey,
  viewportFitRevision = 0,
  focusPhysicalObjectId,
  positionOverrides,
  positionSnapshot,
  displayWidthOverrides,
  locationFrameInput,
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
  routeNormalizerRef,
  physicalPortStates,
  onPhysicalPortClick,
  wiringRoute,
  wiringHighlightedConnectionMemberIds,
  wiringContinuationConnectionPointIds,
  textAnnotations = [],
  annotationMode,
}: TopologyCanvasProps) {
  const { t } = useI18n();
  const [projection, setProjection] = useState<FlowProjection | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const fitAfterLayout = useRef(false);
  const appliedViewportFitRevision = useRef(0);
  const fittedSceneKey = useRef<string | null>(null);
  const appliedPositionSnapshot = useRef(positionSnapshot);
  const appliedAuthoritativePositionRevision = useRef(authoritativePositionRevision);
  const currentDocument = useRef(document);
  const appliedSceneKey = useRef<string | null>(null);
  const confirmedNodePositions = useRef(new Map<string, XYPosition>());
  const canvasRef = useRef<HTMLDivElement>(null);
  const focusedObjectKey = useRef<string | null>(null);
  const frameDrag = useRef<FrameDrag | null>(null);
  const routeNormalizer = useRef<((cableId: string, waypoints: readonly MapCableRouteWaypoint[]) => MapCableRouteWaypoint[]) | null>(null);
  const [frameDragPreview, setFrameDragPreview] = useState<FrameDragPreview | null>(null);
  const { fitView, getZoom, screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  const viewKey = topologyLayoutViewKey(document);
  const presentationSceneKey = sceneKey ?? viewKey;
  const presentationScene = useMemo(() => presentationSceneDocument(document), [document]);

  currentDocument.current = document;

  const annotationDrag = useRef<string | null>(null);
  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      if (annotationDrag.current) annotationMode?.onMoveAnnotation?.(annotationDrag.current, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    };
    const finish = () => { annotationDrag.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); };
  }, [annotationMode, screenToFlowPosition]);
  useEffect(() => {
    if (!routeNormalizerRef) return;
    routeNormalizerRef.current = (cableId, waypoints) => routeNormalizer.current?.(cableId, waypoints) ?? [...waypoints];
    return () => { routeNormalizerRef.current = null; };
  }, [routeNormalizerRef]);
  const onAnnotationPointerDown = (annotationId: string, event: PointerEvent<SVGTextElement>) => {
    if (annotationMode?.editableAnnotationId !== annotationId) return;
    event.preventDefault(); event.stopPropagation();
    annotationDrag.current = annotationId;
  };

  useEffect(() => {
    let current = true;
    const sceneChanged = appliedSceneKey.current !== presentationSceneKey;
    appliedSceneKey.current = presentationSceneKey;
    if (sceneChanged) {
      frameDrag.current = null;
      setFrameDragPreview(null);
      setProjection(null);
    }
    setLayoutError(null);
    perfMark("layout-start");
    void layoutEngine(presentationScene).then(
      (nextProjection) => {
        if (!current || currentDocument.current !== document) return;
        const storedPositions =
          positionOverrides ?? layoutStore?.load(viewKey) ?? {};
        const next: FlowProjection = {
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
        if (appliedViewportFitRevision.current !== viewportFitRevision) {
          appliedViewportFitRevision.current = viewportFitRevision;
          fitAfterLayout.current = true;
        }
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
  }, [document, layoutEngine, layoutRevision, layoutStore, presentationScene, t, viewKey, viewportFitRevision]);

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

  // A fresh props object alone must not reset a live drag. An authoritative
  // SavedMap snapshot (or explicit rollback revision) can replace positions.
  useEffect(() => {
    if (appliedPositionSnapshot.current === positionSnapshot &&
        appliedAuthoritativePositionRevision.current === authoritativePositionRevision) return;
    appliedPositionSnapshot.current = positionSnapshot;
    appliedAuthoritativePositionRevision.current = authoritativePositionRevision;
    if (!positionOverrides) return;
    setProjection((current) => {
      if (!current) return current;
      const nodes = {
        ...current,
        nodes: current.nodes.map((node) => {
          const position = positionOverrides[node.id];
          return position
            ? { ...node, position, parentId: undefined, extent: undefined, expandParent: undefined }
            : node;
        }),
      }.nodes;
      confirmedNodePositions.current = new Map(
        nodes.map((node) => [node.id, node.position]),
      );
      return { ...current, nodes };
    });
  }, [authoritativePositionRevision, positionOverrides, positionSnapshot]);

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
    if (!projection || !focusPhysicalObjectId) return;
    const requestKey = `${presentationSceneKey}/${focusPhysicalObjectId}`;
    if (focusedObjectKey.current === requestKey) return;
    const node = projection.nodes.find(
      (candidate) => physicalObjectIdForNode(candidate.data.projection) === focusPhysicalObjectId,
    );
    if (!node) return;
    focusedObjectKey.current = requestKey;
    // Targeted fit keeps the object wholly visible without fitting the map.
    // maxZoom preserves the user's current zoom unless the object needs zooming out.
    void fitView({ nodes: [node], duration: 300, padding: 0.15, maxZoom: getZoom() });
  }, [fitView, focusPhysicalObjectId, getZoom, presentationSceneKey, projection]);

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

  routeNormalizer.current = null;
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

  const showLocationPresentation = Boolean(locationFrameInput && document.layer === "L1" && document.detail_level === "PHYSICAL_OBJECT");
  const displayedPhysicalObjects = showLocationPresentation ? projection.nodes.flatMap((node) => {
      const physicalObjectId = physicalObjectIdForNode(node.data.projection);
      if (!physicalObjectId) return [];
      const blueprint = node.data.projection.attributes.blueprint_presentation;
      const rectangle = nodeFootprint(node);
      if (blueprint) {
        const width = node.width ?? rectangle.width;
        const face = blueprintNodeDisplayDimensions(blueprint, width);
        rectangle.width = width;
        rectangle.height = face.height + blueprintMapNameplateHeight(blueprint, width);
      }
      return [{ physicalObjectId, rectangle }];
    }) : [];
  const locationPresentation = showLocationPresentation && locationFrameInput
    ? deriveLocationPresentation(locationFrameInput.locations, locationFrameInput.placements, displayedPhysicalObjects, locationFrameInput.states ?? [])
    : { frames: [], objectPaths: [], proxies: [], hiddenObjectProxy: new Map<string, string>() };
  const renderableFrames = locationPresentation.frames.filter((frame) => hasRenderableBounds(frame.bounds));
  const boundaryFrames = renderableFrames.map((frame) => ({ locationId: frame.locationId, bounds: frame.bounds }));
  const resolveRouteWaypoints = (waypoints: readonly MapCableRouteWaypoint[]) => waypoints.map((point) => resolveBoundaryWaypoint(point, boundaryFrames));
  const previewFrames = (() => {
    if (!frameDragPreview || !locationFrameInput || !hasRenderableBounds(frameDragPreview.bounds) ||
      !Number.isFinite(frameDragPreview.delta.x) || !Number.isFinite(frameDragPreview.delta.y) ||
      !renderableFrames.some((frame) => frame.locationId === frameDragPreview.locationId)) return [];
    const byLocationId = new Map(locationFrameInput.locations.map((location) => [location.location_ref.entity_id, location]));
    const subtree = new Set([frameDragPreview.locationId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const location of locationFrameInput.locations) {
        const id = location.location_ref.entity_id;
        if (!subtree.has(id) && location.parent_location_ref && subtree.has(location.parent_location_ref.entity_id)) {
          subtree.add(id);
          changed = true;
        }
      }
    }
    const movingObjects = new Set(locationFrameInput.placements.filter((placement) =>
      placement.positions['L1/PHYSICAL_OBJECT'] && placement.location_ref && subtree.has(placement.location_ref.entity_id),
    ).map((placement) => placement.physical_object_ref.entity_id));
    const previewObjects = displayedPhysicalObjects.map((object) => movingObjects.has(object.physicalObjectId)
      ? { ...object, rectangle: { ...object.rectangle, x: object.rectangle.x + frameDragPreview.delta.x, y: object.rectangle.y + frameDragPreview.delta.y } }
      : object);
    const future = deriveLocationPresentation(locationFrameInput.locations, locationFrameInput.placements, previewObjects, locationFrameInput.states ?? []);
    const ancestors = new Set<string>();
    let parentId = byLocationId.get(frameDragPreview.locationId)?.parent_location_ref?.entity_id;
    while (parentId && !ancestors.has(parentId)) {
      ancestors.add(parentId);
      parentId = byLocationId.get(parentId)?.parent_location_ref?.entity_id;
    }
    const currentById = new Map(renderableFrames.map((frame) => [frame.locationId, frame]));
    return future.frames.filter((frame) => {
      const current = currentById.get(frame.locationId);
      if (!current || !hasRenderableBounds(frame.bounds)) return false;
      if (frame.locationId === frameDragPreview.locationId) return true;
      return ancestors.has(frame.locationId) && (frame.bounds.x !== current.bounds.x || frame.bounds.y !== current.bounds.y ||
        frame.bounds.width !== current.bounds.width || frame.bounds.height !== current.bounds.height);
    });
  })();
  const locationPathsByObjectId = new Map(locationPresentation.objectPaths.map((path) => [path.physicalObjectId, path.label]));
  const proxyNodeId = (locationId: string) => `location-proxy:${locationId}`;
  const hiddenNodeProxies = new Map(projection.nodes.flatMap((node) => {
    const objectId = physicalObjectIdForNode(node.data.projection);
    const locationId = objectId && locationPresentation.hiddenObjectProxy.get(objectId);
    return locationId ? [[node.id, proxyNodeId(locationId)] as const] : [];
  }));
  const nodes: DeviceFlowNode[] = projection.nodes.filter((node) => !hiddenNodeProxies.has(node.id)).map((node) => ({
    ...node,
    draggable: draggableNodeIds ? draggableNodeIds.has(node.id) && !lockedNodeIds?.has(node.id) : lockedNodeIds?.has(node.id) ? false : undefined,
    data: {
      ...node.data,
      locationPresentationPath: locationPathsByObjectId.get(physicalObjectIdForNode(node.data.projection) ?? ""),
      traceHighlighted: traceOverlay?.highlightedNodeIds.has(node.id) ?? false,
      traceHighlightedConnectionMemberIds: traceOverlay?.highlightedConnectionMemberIds ?? new Set<string>(),
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
  for (const proxy of locationPresentation.proxies) nodes.push({
    id: proxyNodeId(proxy.locationId), type: 'locationProxy',
    position: { x: proxy.bounds.x, y: proxy.bounds.y }, width: proxy.bounds.width, height: proxy.bounds.height,
    draggable: false, selectable: false,
    data: { projection: null as unknown as TopologyProjectionNode, locationProxy: { locationId: proxy.locationId, label: proxy.label, hiddenObjectCount: proxy.hiddenObjectCount, traced: [...hiddenNodeProxies].some(([nodeId, targetId]) => targetId === proxyNodeId(proxy.locationId) && traceOverlay?.highlightedNodeIds.has(nodeId)), expandLabel: t('map.locationExpand', { name: proxy.label }), configureLabel: t('map.locationConfigureCollapse', { name: proxy.label }), onExpand: locationFrameInput?.onCollapse ? () => locationFrameInput.onCollapse?.(proxy.locationId, false) : undefined, onConfigure: locationFrameInput?.onConfigure ? () => locationFrameInput.onConfigure?.(proxy.locationId) : undefined } },
  });
  const edges = projectCollapsedEdges(annotationMode ? [] : projection.edges, hiddenNodeProxies).map((edge) => {
    const savedRoute = document.layer === "L1" && document.detail_level === "PHYSICAL_OBJECT"
      ? cableRouteForCollapsedCable(edge.data?.cableNode, cableRoutes)
      : undefined;
    const cableRoute = savedRoute && { ...savedRoute, waypoints: resolveRouteWaypoints(savedRoute.waypoints) };
    const matchingDraft = edge.data?.cableNode
      && cableRouteDraft
      && cableIdForNode(edge.data.cableNode) === cableRouteDraft.cableId
      ? { ...cableRouteDraft, waypoints: resolveRouteWaypoints(cableRouteDraft.waypoints), onWaypointMove: (index: number, point: MapCableRouteWaypoint) => {
        const anchor = cableRouteDraft.waypoints[index]?.anchor;
        if (!anchor) { cableRouteDraft.onWaypointMove(index, point); return; }
        const frame = boundaryFrames.find((item) => item.locationId === anchor.location_id);
        if (frame) cableRouteDraft.onWaypointMove(index, projectBoundaryWaypoint(frame.locationId, frame.bounds, point));
      } }
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
    const isDirectlyAttached = tracedCableId !== null &&
      (directlyAttachedCableIds?.has(tracedCableId) ?? false);
    const cablePresentationEmphasis: NonNullable<LogicalFlowEdge['data']>['cablePresentationEmphasis'] = matchingDraft
      ? 'editing'
      : isSelected
        ? 'selected'
        : isTraced
          ? 'traced'
          : isDirectlyAttached
            ? 'attached'
            : 'normal';
    return {
      ...edge,
      data: edge.data ? { ...edge.data, cablePresentationEmphasis, ...(cableRoute ? { cableRoute } : {}), ...(matchingDraft ? { cableRouteDraft: matchingDraft, renderRouteEditorInForeground: true } : {}) } : edge.data,
      selected: isSelected,
      animated: isSelected || isTraced || isDirectlyAttached,
      style: {
        stroke: isSelected ? "#54e3b4" : isTraced ? "#f0bd66" : isDirectlyAttached ? "#35c99c" : "#52676b",
        strokeWidth: isSelected ? 3 : isTraced ? 4 : isDirectlyAttached ? 3 : 2,
        opacity: 1,
      },
    };
  });

  const renderedNodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeBox = (node: DeviceFlowNode) => ({ x: node.position.x, y: node.position.y, width: node.measured?.width ?? node.width ?? 212, height: node.measured?.height ?? node.height ?? 144 });
  const routeEndpoints = (sourceNode: DeviceFlowNode, targetNode: DeviceFlowNode, sourcePointId?: string, targetPointId?: string) => {
    const sourceBox = nodeBox(sourceNode), targetBox = nodeBox(targetNode);
    const floating = getFloatingEndpoints(sourceBox, targetBox);
    return {
      source: sourceNode.data.locationProxy ? floating.source : getRenderedConnectionPoint(sourceNode.data.projection, sourceBox, sourcePointId) ?? floating.source,
      target: targetNode.data.locationProxy ? floating.target : getRenderedConnectionPoint(targetNode.data.projection, targetBox, targetPointId) ?? floating.target,
    };
  };
  routeNormalizer.current = (cableId, waypoints) => {
    const edge = edges.find((item) => item.data?.cableNode && cableIdForNode(item.data.cableNode) === cableId);
    let endpoints = edge && renderedNodeById.get(edge.source) && renderedNodeById.get(edge.target)
      ? routeEndpoints(renderedNodeById.get(edge.source)!, renderedNodeById.get(edge.target)!, edge.data?.endpointPair?.from_connection_point_id, edge.data?.endpointPair?.to_connection_point_id)
      : null;
    if (!endpoints && wiringRoute?.target) {
      const sourceNode = nodes.find((node) => physicalObjectIdForNode(node.data.projection) === wiringRoute.source.physicalObjectId);
      const targetNode = nodes.find((node) => physicalObjectIdForNode(node.data.projection) === wiringRoute.target?.physicalObjectId);
      if (sourceNode && targetNode) endpoints = routeEndpoints(sourceNode, targetNode, wiringRoute.source.connectionPointId, wiringRoute.target.connectionPointId);
    }
    return endpoints ? normalizeLocationBoundaryAnchors(endpoints.source, endpoints.target, resolveRouteWaypoints(waypoints), boundaryFrames) : [...waypoints];
  };

  const onNodeClick: NodeMouseHandler<DeviceFlowNode> = (_, node) => {
    if (annotationMode) return;
    if (node.data.locationProxy) return;
    const physicalObjectId = physicalObjectIdForNode(node.data.projection);
    onSelectionChange({ type: "node", item: node.data.projection });
  };
  const onEdgeClick: EdgeMouseHandler<LogicalFlowEdge> = (event, edge) => {
    if (annotationMode) return;
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
    if (annotationMode) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    if (node.data.locationProxy) return;
    const projectionNode = node.data.projection;
    if (cableIdForNode(projectionNode)) onPhysicalCableContextMenu?.(projectionNode, { x: event.clientX, y: event.clientY });
    else onPhysicalNodeContextMenu?.(projectionNode, { x: event.clientX, y: event.clientY });
  };
  const onEdgeContextMenu: EdgeMouseHandler<LogicalFlowEdge> = (event, edge) => {
    if (annotationMode) {
      event.preventDefault();
      return;
    }
    if (!edge.data?.cableNode) return;
    event.preventDefault();
    onPhysicalCableContextMenu?.(edge.data.cableNode, { x: event.clientX, y: event.clientY });
  };
  const onNodesChange: OnNodesChange<DeviceFlowNode> = (changes) => {
    if (annotationMode) return;
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
    if (annotationMode) return;
    if (node.data.locationProxy) return;
    confirmedNodePositions.current.set(node.id, node.position);
  };
  const onNodeDragStop: OnNodeDrag<DeviceFlowNode> = (_, draggedNode) => {
    if (annotationMode) return;
    if (draggedNode.data.locationProxy) return;
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

  const startFrameDrag = (event: PointerEvent<HTMLElement>, locationId: string, bounds: FlowRectangle) => {
    if (!locationFrameInput?.onGroupMove || !hasRenderableBounds(bounds)) return;
    event.preventDefault();
    event.stopPropagation();
    const drag = { pointerId: event.pointerId, locationId, start: screenToFlowPosition({ x: event.clientX, y: event.clientY }), bounds: { ...bounds } };
    frameDrag.current = drag;
    setFrameDragPreview({ ...drag, delta: { x: 0, y: 0 } });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateFrameDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = frameDrag.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y };
    if (Number.isFinite(delta.x) && Number.isFinite(delta.y)) setFrameDragPreview({ ...drag, delta });
  };

  const cancelFrameDrag = (event?: PointerEvent<HTMLElement>) => {
    if (event && frameDrag.current?.pointerId !== event.pointerId) return;
    frameDrag.current = null;
    setFrameDragPreview(null);
  };

  const finishFrameDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = frameDrag.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    cancelFrameDrag();
    if (!locationFrameInput?.onGroupMove) return;
    const end = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const delta = { x: end.x - drag.start.x, y: end.y - drag.start.y };
    if ((!delta.x && !delta.y) || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return;
    const rectangles = new Map(projection.nodes.flatMap((node) => {
      const id = physicalObjectIdForNode(node.data.projection);
      if (!id) return [];
      return [[id, nodeFootprint(node)] as const];
    }));
    const originalNodes = new Map(projection.nodes.map((node) => [node.id, node]));
    const displayedNodes = new Map(nodes.map((node) => [node.id, node]));
    const cables: GroupCableGeometry[] = edges.flatMap((edge) => {
      const cableId = edge.data?.cableNode && cableIdForNode(edge.data.cableNode);
      const pair = edge.data?.endpointPair, original = edge.data?.projection;
      if (!cableId || !pair || !original) return [];
      const originalSource = originalNodes.get(original.from_node_id)?.data.projection;
      const originalTarget = originalNodes.get(original.to_node_id)?.data.projection;
      const sourceObjectId = originalSource && physicalObjectIdForNode(originalSource);
      const targetObjectId = originalTarget && physicalObjectIdForNode(originalTarget);
      const sourceNode = displayedNodes.get(edge.source), targetNode = displayedNodes.get(edge.target);
      if (!sourceObjectId || !targetObjectId || !sourceNode || !targetNode) return [];
      const box = (node: DeviceFlowNode) => ({ x: node.position.x, y: node.position.y, width: node.measured?.width ?? node.width ?? 212, height: node.measured?.height ?? node.height ?? 144 });
      const floating = getFloatingEndpoints(box(sourceNode), box(targetNode));
      const source = sourceNode.data.locationProxy ? floating.source : getRenderedConnectionPoint(sourceNode.data.projection, box(sourceNode), pair.from_connection_point_id) ?? floating.source;
      const target = targetNode.data.locationProxy ? floating.target : getRenderedConnectionPoint(targetNode.data.projection, box(targetNode), pair.to_connection_point_id) ?? floating.target;
      return [{ cableId, sourceObjectId, targetObjectId, source, target, savedWaypoints: cableRoutes?.find((route) => route.cable_ref.entity_id === cableId)?.waypoints }];
    });
    try {
      const move = prepareLocationGroupMove(drag.locationId, delta, drag.bounds, locationFrameInput.locations, locationFrameInput.placements, rectangles, cables);
      locationFrameInput.onGroupMove(drag.locationId, move);
    } catch (reason) {
      locationFrameInput.onGroupMoveRejected?.(reason instanceof Error ? reason.message : String(reason));
    }
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
          if (annotationMode) {
            if (annotationMode.annotationPlacement) annotationMode.onAnnotationPlace?.(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
            return;
          }
          const anchor = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          onSelectionChange(null);
          onPaneClick?.(anchor);
        }}
        onPaneContextMenu={(event) => {
          if (annotationMode || !onPhysicalPaneContextMenu) {
            return;
          }
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
        nodesDraggable={!annotationMode && (
          Boolean(onPhysicalNodeDragStop) ||
          (!disableAutoLayout && document.layer === "L1")
        )}
        nodesConnectable={false}
        elementsSelectable={!annotationMode}
        panOnDrag
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
        {(renderableFrames.length > 0 || locationPresentation.proxies.length > 0) && <ViewportPortal>
          <div className="location-frame-layer" aria-hidden={!locationFrameInput?.onCollapse && !locationFrameInput?.onConfigure ? true : undefined}>
            {renderableFrames.map((frame) => {
              const collapsed = locationFrameInput?.states?.some((state) => state.location_ref.entity_id === frame.locationId && state.collapsed) ?? false;
              const toggleLabel = t(collapsed ? 'map.locationExpand' : 'map.locationCollapse', { name: frame.label });
              const configureLabel = t('map.locationConfigureCollapse', { name: frame.label });
              return <div
                key={frame.locationId}
                className="location-frame"
                data-location-id={frame.locationId}
                style={{ left: frame.bounds.x, top: frame.bounds.y, width: frame.bounds.width, height: frame.bounds.height }}
              ><span className="location-frame__heading nodrag nopan" onPointerDown={locationFrameInput?.onGroupMove ? (event) => startFrameDrag(event, frame.locationId, frame.bounds) : undefined} onPointerMove={updateFrameDrag} onPointerUp={finishFrameDrag} onPointerCancel={cancelFrameDrag} onLostPointerCapture={cancelFrameDrag}><span className="location-frame__label">{frame.label}</span>{locationFrameInput?.onCollapse && locationFrameInput.onConfigure && <span className="location-frame__actions"><button className="location-action" type="button" aria-label={toggleLabel} title={toggleLabel} onPointerDown={(event) => event.stopPropagation()} onClick={() => locationFrameInput.onCollapse?.(frame.locationId, !collapsed)}>{collapsed ? '+' : '−'}</button><button className="location-action" type="button" aria-label={configureLabel} title={configureLabel} onPointerDown={(event) => event.stopPropagation()} onClick={() => locationFrameInput.onConfigure?.(frame.locationId)}>⚙</button></span>}</span></div>;
            })}
            {previewFrames.map((frame) => <div key={frame.locationId} className="location-frame location-frame--drag-preview" data-preview-location-id={frame.locationId} aria-hidden="true" style={{ left: frame.bounds.x, top: frame.bounds.y, width: frame.bounds.width, height: frame.bounds.height }} />)}
          </div>
        </ViewportPortal>}
        {document.layer === "L1" && document.detail_level === "PHYSICAL_OBJECT" && (textAnnotations.length > 0 || annotationMode) && (
          <ViewportPortal>
            <MapTextAnnotationLayer annotations={textAnnotations} previewAnnotation={annotationMode?.previewAnnotation} selectedAnnotationId={annotationMode?.selectedAnnotationId} interactiveAnnotationId={annotationMode?.editableAnnotationId} onAnnotationPointerDown={onAnnotationPointerDown} onAnnotationClick={(annotationId) => annotationMode?.onAnnotationSelect?.(annotationId)} />
          </ViewportPortal>
        )}
        <MiniMap
          className="topology-canvas__minimap"
          pannable
          zoomable
          position="bottom-right"
          nodeColor="#183b3b"
          maskColor="rgba(5, 13, 15, 0.72)"
          ariaLabel={t("canvas.minimap")}
        />
        <Controls showInteractive={false} position="bottom-left" />
        {!annotationMode && <ForegroundCableRoutes edges={edges} physicalPortStates={physicalPortStates} />}
        {!annotationMode && wiringRoute && <ViewportPortal><svg className="cable-routes-foreground cable-routes-foreground--wiring" aria-hidden="true"><WiringRoute {...wiringRoute} /></svg></ViewportPortal>}
      </ReactFlow>
    </div>
  );
}
