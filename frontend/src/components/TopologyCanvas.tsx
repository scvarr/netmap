import { locationAtPoint } from '../topology/locationSelection';
import type { LocationGridArrangement } from './useLocationGridArrangement';
import { LocationArrangementToolbar } from './LocationArrangementToolbar';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
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
import { FloatingTopologyEdge, ForegroundCableRoutes } from "./FloatingTopologyEdge";
import { OffMapContinuationEdge } from "./OffMapContinuationEdge";
import type { PhysicalTraceOverlay } from "../topology/interfacePhysicalTraceOverlay";
import { physicalObjectIdForNode } from "../topology/projection";
import { perfMark, perfMeasure } from "../perfMarks";
import type { XYPosition } from "@xyflow/react";
import { overlapsAnyNode } from "../topology/nodeFootprint";
import { cableIdForNode } from "../topology/projection";
import type { MapTextAnnotation } from "../topology/savedMapTypes";
import { useI18n } from "../i18n";
import { blueprintRenderedNodeDimensions } from "../topology/blueprintDisplaySize";
import { nodeFootprint, type FlowRectangle } from "../topology/nodeFootprint";
import { layoutLocationFrames, editLocationFrames, locationBoundaryPoint } from '../topology/locationFrameGeometry';
import { LocationFrameEditor } from "./LocationFrameEditor";
import type { LocationChannelInput } from '../topology/hierarchicalCableRoutes';
import { cableOccupiedPortIds } from '../topology/physicalPortPresentation';
import { deriveLocationPresentation, projectCollapsedEdges } from "../topology/locationFrames";
import type { LocationDocument } from "../topology/locationTypes";
import type { MapLocationState, MapPlacement } from "../topology/savedMapTypes";
import { presentationSceneDocument } from "../topology/presentationScene";
import { MapTextAnnotationLayer } from "./MapTextAnnotationLayer";
import { LocationProxyNode } from "./LocationProxyNode";

interface TopologyCanvasProps {
  arrangement?: LocationGridArrangement;
  document: TopologyProjectionDocument;
  selection: TopologySelection;
  onSelectionChange: (selection: TopologySelection) => void;
  layoutEngine?: TopologyLayoutEngine;
  layoutStore?: TopologyLayoutStore;
  traceOverlay?: PhysicalTraceOverlay;
  /** Exact Cable ids directly attached to the selected PhysicalObject. */
  directlyAttachedCableIds?: ReadonlySet<string>;
  sceneKey?: string;
  showAllVirtualChannels?: boolean;
  requireLocationChannels?: boolean;
  /** Request one fit after a fresh layout has been applied. */
  viewportFitRevision?: number;
  /** A one-shot presentation request to reveal a physical object. */
  focusPhysicalObjectId?: string | null;
  positionOverrides?: Record<string, XYPosition>;
  /** New authoritative SavedMap placement snapshot, including variant switches and refreshes. */
  positionSnapshot?: readonly MapPlacement[];
  displayWidthOverrides?: Record<string, number>;
  locationFrameInput?: { automatic?: import('../topology/savedMapTypes').AutomaticLocationLayout | null; locations: readonly LocationDocument[]; placements: readonly MapPlacement[]; variantId?: string; states?: readonly MapLocationState[]; onBoundaryPlacement?: (id: string, placement: Pick<import('../topology/savedMapTypes').MapLocationGeometry, 'edge' | 'offset'>) => Promise<void>; onGeometry?: (id: string, geometry: import('../topology/savedMapTypes').MapLocationGeometry) => Promise<void>; onCollapse?: (locationId: string, collapsed: boolean) => void; onConfigure?: (locationId: string) => void; };
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
  physicalPortStates?: Record<string, 'eligible' | 'source' | 'destination' | 'unavailable'>;
  bulkPortNumbers?: Record<string, number>;
  bulkPairs?: readonly { source: { physicalObjectId: string; connectionPointId: string }; target: { physicalObjectId: string; connectionPointId: string } }[];
  onPhysicalPortClick?: (port: { physicalObjectId: string; connectionPointId: string; label: string }) => void;
  wiringRoute?: { source: { physicalObjectId: string; connectionPointId: string }; target?: { physicalObjectId: string; connectionPointId: string } };
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

export function TopologyCanvas({ arrangement: sharedArrangement,
  document,
  selection,
  onSelectionChange,
  layoutEngine = toFlowProjection,
  layoutStore,
  traceOverlay,
  directlyAttachedCableIds,
  sceneKey,
  showAllVirtualChannels,
  requireLocationChannels,
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
  physicalPortStates,
  bulkPortNumbers,
  bulkPairs,
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
  const [frameUiZoom, setFrameUiZoom] = useState(1);
  const [frameEditPreview, setFrameEditPreview] = useState<{ scene: string; id: string; geometry: import('../topology/savedMapTypes').MapLocationGeometry } | null>(null);
  const { fitBounds, fitView, getZoom, screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  const arrangement = sharedArrangement ?? {preview:null,selected:null,busy:false,select:()=>{},canMove:()=>false,move:()=>{}};
  useEffect(() => { setFrameEditPreview(null); }, [locationFrameInput?.automatic, locationFrameInput?.variantId]);
  const viewKey = topologyLayoutViewKey(document);
  const presentationSceneKey = sceneKey ?? viewKey;
  const presentationScene = useMemo(() => presentationSceneDocument(document), [document]);
  const occupiedPorts = useMemo(() => cableOccupiedPortIds(document), [document]);

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
              ? { ...node, ...blueprintRenderedNodeDimensions(blueprint, displayWidth), data: { ...node.data, compositionDisplayWidth: displayWidth } }
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
            ? reason.message === 'map.portGeometryUnsupported' || reason.message === 'map.portGeometryCoincident' ? t(reason.message) : reason.message
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
          ? { ...node, ...blueprintRenderedNodeDimensions(blueprint, displayWidth), data: { ...node.data, compositionDisplayWidth: displayWidth } }
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
    const locations = locationFrameInput && document.layer === 'L1' && document.detail_level === 'PHYSICAL_OBJECT'
      ? deriveLocationPresentation(locationFrameInput.locations, locationFrameInput.placements, projection.nodes.flatMap(node => {
          const id = physicalObjectIdForNode(node.data.projection);
          return id ? [{ physicalObjectId: id, rectangle: nodeFootprint(node), flexibleCableZone: Boolean(node.data.projection.attributes.blueprint_presentation) }] : [];
        }), locationFrameInput.states ?? [], locationFrameInput.automatic) : null;
    const bounds = [...(locations?.frames ?? []).map(frame => frame.bounds), ...(locations?.proxies ?? []).filter(proxy => !proxy.partial).map(proxy => proxy.bounds),
      ...projection.nodes.map(node => ({ ...node, position: locations?.automaticPositions?.get(physicalObjectIdForNode(node.data.projection) ?? '') ?? node.position })).filter(node => !locations?.hiddenObjectProxy.has(physicalObjectIdForNode(node.data.projection) ?? '')).map(node => nodeFootprint(node))];
    if (bounds.length && locations) {
      const x = Math.min(...bounds.map(b => b.x)), y = Math.min(...bounds.map(b => b.y));
      const right = Math.max(...bounds.map(b => b.x + b.width)), bottom = Math.max(...bounds.map(b => b.y + b.height));
      void fitBounds({ x, y, width: right - x, height: bottom - y }, { padding: .2 });
    } else void fitView({ duration: 300, maxZoom: 1.1, padding: 0.2 });
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

  const physicalObjectView = document.layer === "L1" && document.detail_level === "PHYSICAL_OBJECT";
  const useVirtualChannels = physicalObjectView;
  const showChannelTerminals = frameUiZoom >= 0.6;
  const cableTraceActive = Boolean(traceOverlay && (
    traceOverlay.highlightedCableIds.size || traceOverlay.highlightedConnectionMemberIds.size || traceOverlay.highlightedEdgeIds.size
  ));
  const showLocationPresentation = Boolean(locationFrameInput && physicalObjectView);
  const displayedPhysicalObjects = showLocationPresentation ? projection.nodes.flatMap((node) => {
      const physicalObjectId = physicalObjectIdForNode(node.data.projection);
      if (!physicalObjectId) return [];
      const rectangle = nodeFootprint(node);
      return [{ physicalObjectId, rectangle, flexibleCableZone: Boolean(node.data.projection.attributes.blueprint_presentation) }];
    }) : [];
  const locationPresentation = showLocationPresentation && locationFrameInput
    ? deriveLocationPresentation(locationFrameInput.locations, locationFrameInput.placements, displayedPhysicalObjects, locationFrameInput.states ?? [], arrangement.preview ?? locationFrameInput.automatic)
    : { frames: [], objectPaths: [], proxies: [], hiddenObjectProxy: new Map<string, string>() };
  const automatic = showLocationPresentation && locationFrameInput?.automatic;
  const baseFrameGeometries = automatic ? new Map([...locationPresentation.frames, ...locationPresentation.proxies.filter(p => !p.partial)].map(f => [f.locationId, { ...f.bounds, edge: locationFrameInput?.states?.find(s => s.location_ref.entity_id === f.locationId)?.geometry?.edge ?? 'right' as const, offset: locationFrameInput?.states?.find(s => s.location_ref.entity_id === f.locationId)?.geometry?.offset ?? .5 }])) : layoutLocationFrames(locationFrameInput?.locations ?? [], new Map(locationFrameInput?.states?.flatMap(state => state.geometry ? [[state.location_ref.entity_id, state.geometry] as const] : []) ?? []));
  const activeFrameEdit = frameEditPreview?.scene === presentationSceneKey && baseFrameGeometries.has(frameEditPreview.id) ? frameEditPreview : null;
  const frameEdit = activeFrameEdit && !automatic
    ? editLocationFrames(locationFrameInput?.locations ?? [], baseFrameGeometries, activeFrameEdit.id, activeFrameEdit.geometry)
    : { frames: baseFrameGeometries, translations: new Map<string, XYPosition>() };
  if (automatic && activeFrameEdit) {
    const frame = baseFrameGeometries.get(activeFrameEdit.id)!;
    frameEdit.frames.set(activeFrameEdit.id, { ...frame, edge: activeFrameEdit.geometry.edge, offset: activeFrameEdit.geometry.offset });
  }
  const editedFrameGeometries = frameEdit.frames;
  locationPresentation.frames = locationPresentation.frames.map(frame => ({ ...frame, bounds: editedFrameGeometries.get(frame.locationId)! }));
  locationPresentation.proxies = locationPresentation.proxies.map(proxy => {
    const delta = frameEdit.translations.get(proxy.locationId);
    return delta ? { ...proxy, bounds: { ...proxy.bounds, x: proxy.bounds.x + delta.x, y: proxy.bounds.y + delta.y } } : proxy;
  });
  const renderableFrames = locationPresentation.frames.filter((frame) => hasRenderableBounds(frame.bounds));
  const locationPathsByObjectId = new Map(locationPresentation.objectPaths.map((path) => [path.physicalObjectId, path.label]));
  const proxyNodeId = (locationId: string) => `location-proxy:${locationId}`;
  const hiddenNodeProxies = new Map(projection.nodes.flatMap((node) => {
    const objectId = physicalObjectIdForNode(node.data.projection);
    const locationId = objectId && locationPresentation.hiddenObjectProxy.get(objectId);
    return locationId ? [[node.id, proxyNodeId(locationId)] as const] : [];
  }));
  const nodes: DeviceFlowNode[] = projection.nodes.filter((node) => !hiddenNodeProxies.has(node.id)).map((node) => ({
    ...node,
    ...(locationPresentation.automaticPositions?.get(physicalObjectIdForNode(node.data.projection) ?? "") ?? {}),
    position: locationPresentation.automaticPositions?.get(physicalObjectIdForNode(node.data.projection) ?? '') ?? node.position,
    draggable: automatic ? false : draggableNodeIds ? draggableNodeIds.has(node.id) && !lockedNodeIds?.has(node.id) : lockedNodeIds?.has(node.id) ? false : undefined,
    data: {
      ...node.data,
      locationPresentationPath: locationPathsByObjectId.get(physicalObjectIdForNode(node.data.projection) ?? ""),
      traceHighlighted: traceOverlay?.highlightedNodeIds.has(node.id) ?? false,
      traceHighlightedConnectionMemberIds: traceOverlay?.highlightedConnectionMemberIds ?? new Set<string>(),
      cableOccupiedPortIds: occupiedPorts,
      wiringHighlightedConnectionMemberIds,
      wiringContinuationConnectionPointIds,
      physicalPortStates,
      onPhysicalPortClick,
      onPhysicalPortContextMenu,
      onBlueprintDisplayResize,
      blueprintResizeEnabled: !automatic && Boolean(onBlueprintDisplayResize) && !lockedNodeIds?.has(node.id),
    },
    selected: selection?.type === "node" && selection.item.id === node.id,
  }));
  for (const proxy of locationPresentation.proxies) nodes.push({
    id: proxyNodeId(proxy.locationId), type: 'locationProxy',
    position: { x: proxy.bounds.x, y: proxy.bounds.y }, width: proxy.bounds.width, height: proxy.bounds.height,
    draggable: false, selectable: false,
    data: { projection: null as unknown as TopologyProjectionNode, locationProxy: { arrangementSelected: arrangement.selected === proxy.locationId, onSelectLocation: arrangement.preview && !proxy.partial ? () => arrangement.select(proxy.locationId) : undefined, partial: proxy.partial, boundaryPointId: locationFrameInput?.states?.find(s => s.location_ref.entity_id === proxy.locationId)?.boundary_point_id, boundaryEdge: baseFrameGeometries.get(proxy.locationId)?.edge, boundaryOffset: baseFrameGeometries.get(proxy.locationId)?.offset, locationId: proxy.locationId, label: proxy.label, hiddenObjectCount: proxy.hiddenObjectCount, traced: [...hiddenNodeProxies].some(([nodeId, targetId]) => targetId === proxyNodeId(proxy.locationId) && traceOverlay?.highlightedNodeIds.has(nodeId)), expandLabel: t('map.locationExpand', { name: proxy.label }), configureLabel: t('map.locationConfigureCollapse', { name: proxy.label }), onExpand: locationFrameInput?.onCollapse ? () => locationFrameInput.onCollapse?.(proxy.locationId, false) : undefined, onConfigure: locationFrameInput?.onConfigure ? () => locationFrameInput.onConfigure?.(proxy.locationId) : undefined } },
  });
  const edges = projectCollapsedEdges(annotationMode ? [] : projection.edges, hiddenNodeProxies).map((edge) => {
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
    const cablePresentationEmphasis: NonNullable<LogicalFlowEdge['data']>['cablePresentationEmphasis'] = isSelected
      ? 'selected'
      : isTraced
        ? 'traced'
        : isDirectlyAttached ? 'attached' : 'normal';
    return {
      ...edge,
      data: edge.data ? { ...edge.data, cablePresentationEmphasis, renderCableInForegroundOnly: Boolean(edge.data.cableNode) } : edge.data,
      selected: isSelected,
      focusable: edge.data?.cableNode ? false : edge.focusable,
      animated: isSelected || isTraced || isDirectlyAttached,
      style: {
        stroke: isSelected ? "#54e3b4" : isTraced ? "#f0bd66" : isDirectlyAttached ? "#35c99c" : "#52676b",
        strokeWidth: isSelected ? 3 : isTraced ? 4 : isDirectlyAttached ? 3 : 2,
        opacity: 1,
      },
    };
  });

  const assignments = new Map(locationFrameInput?.placements.map(p => [p.physical_object_ref.entity_id, p.location_ref?.entity_id ?? null]));
  const locationChannels = new Map<string | null, LocationChannelInput>();
  if (showLocationPresentation) {
    locationChannels.set(null, { locationId: null, boundary: null, members: [] });
    const pointIds = new Map(locationFrameInput?.states?.map(state => [state.location_ref.entity_id, state.boundary_point_id]));
    const parents = new Map(locationFrameInput?.locations.map(location => [location.location_ref.entity_id, location.parent_location_ref?.entity_id ?? null]));
    const boundaryId = (id: string) => 'Boundary:' + (pointIds.get(id) ?? id);
    for (const frame of renderableFrames) {
      locationChannels.set(frame.locationId, {
        locationId: frame.locationId,
        boundary: { id: boundaryId(frame.locationId), geometry: editedFrameGeometries.get(frame.locationId)! },
        members: [],
      });
    }
    const childFrames = [...renderableFrames, ...locationPresentation.proxies.filter(p => !p.partial && hasRenderableBounds(p.bounds))];
    for (const frame of childFrames) {
      const geometry = editedFrameGeometries.get(frame.locationId);
      const parent = locationChannels.get(parents.get(frame.locationId) ?? null);
      if (parent && geometry) parent.members.push({
        id: boundaryId(frame.locationId), kind: 'location', bounds: frame.bounds,
        point: locationBoundaryPoint(frame.bounds, geometry), edge: geometry.edge,
      });
    }
  }
  for (const node of nodes) {
    if (node.data.locationProxy) continue;
    const objectId = physicalObjectIdForNode(node.data.projection);
    if (!objectId) continue;
    const assigned = assignments.get(objectId) ?? null;
    const delta = assigned ? frameEdit.translations.get(assigned) : undefined;
    if (delta) node.position = { x: node.position.x + delta.x, y: node.position.y + delta.y };
    const local = locationChannels.get(assigned);
    if (local) {
      const bounds = nodeFootprint(node);
      if (hasRenderableBounds(bounds)) local.members.push({
        id: 'PhysicalObject:' + objectId, bounds, edge: 'right',
        kind: node.data.projection.attributes.blueprint_presentation ? 'blueprint-object' : 'generic-object',
        // This is also the COMB-01 exit on a blueprint's complete footprint.
        point: { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
      });
    }
  }
  const onNodeClick: NodeMouseHandler<DeviceFlowNode> = (_, node) => {
    if (annotationMode) return;
    if (node.data.locationProxy) return;
    const physicalObjectId = physicalObjectIdForNode(node.data.projection);
    onSelectionChange({ type: "node", item: node.data.projection });
  };
  const selectCable = (edge: LogicalFlowEdge) => {
    if (edge.data?.cableNode) onSelectionChange({ type: "node", item: edge.data.cableNode });
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
      selectCable(edge);
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


  return (
    <div
      className={`topology-canvas${showChannelTerminals ? '' : ' topology-canvas--reduced-terminals'}`}
      style={{ '--location-terminal-scale': Math.min(1, 1 / frameUiZoom) } as CSSProperties}
      aria-label={
        document.layer === "L1"
          ? t("canvas.physical")
          : t("canvas.logical")
      }
      ref={canvasRef}
    >
      <ReactFlow
        onMove={(_, viewport) => setFrameUiZoom(viewport.zoom)}
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
          if (arrangement.preview && !arrangement.busy) {
            const id = locationAtPoint(locationFrameInput?.locations ?? [], [...renderableFrames, ...locationPresentation.proxies.filter(p => !p.partial)], anchor);
            if (id) { arrangement.select(id); return; }
          }
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
        nodesDraggable={!automatic && !annotationMode && (
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
          <div className={"location-frame-layer" + (arrangement.preview ? " location-frame-layer--arranging" : "")} aria-hidden={!locationFrameInput?.onCollapse && !locationFrameInput?.onConfigure ? true : undefined}>
            {renderableFrames.map((frame) => {
              const collapsed = locationFrameInput?.states?.some((state) => state.location_ref.entity_id === frame.locationId && state.collapsed) ?? false;
              const toggleLabel = t(collapsed ? 'map.locationExpand' : 'map.locationCollapse', { name: frame.label });
              const configureLabel = t('map.locationConfigureCollapse', { name: frame.label });
              return <div key={frame.locationId}><LocationFrameEditor automatic={Boolean(automatic)} key={(locationFrameInput?.variantId ?? '') + (automatic ? automatic.mode ?? 'legacy' : 'manual') + frame.locationId} frame={frame} arrangementSelected={arrangement.selected === frame.locationId} onSelectLocation={arrangement.preview ? () => arrangement.select(frame.locationId) : undefined}
                state={(() => { const state = locationFrameInput?.states?.find(state => state.location_ref.entity_id === frame.locationId); return state ? { ...state, geometry: editedFrameGeometries.get(frame.locationId)! } : undefined; })()}
                uiScale={Math.min(1, 1 / frameUiZoom)}
                parentBounds={frame.parentLocationId ? editedFrameGeometries.get(frame.parentLocationId) : undefined}
                childBounds={(locationFrameInput?.locations ?? []).filter(l => l.parent_location_ref?.entity_id === frame.locationId).map<FlowRectangle>(l => editedFrameGeometries.get(l.location_ref.entity_id)!).concat(displayedPhysicalObjects.filter(object => locationFrameInput?.placements.some(p => p.physical_object_ref.entity_id === object.physicalObjectId && p.location_ref?.entity_id === frame.locationId)).map(object => object.rectangle))}
                disabled={arrangement.busy || Boolean(activeFrameEdit && activeFrameEdit.id !== frame.locationId)}
                onDraft={geometry => setFrameEditPreview(geometry ? { scene: presentationSceneKey, id: frame.locationId, geometry } : null)}
                screenToFlowPosition={screenToFlowPosition} onSave={locationFrameInput?.onGeometry} onSaveBoundary={locationFrameInput?.onBoundaryPlacement}
                actions={<span className="location-frame__actions">
                  <button type="button" className="location-action" aria-label={toggleLabel} title={toggleLabel} onClick={() => locationFrameInput?.onCollapse?.(frame.locationId, !collapsed)}>{collapsed ? '+' : '−'}</button>
                  <button type="button" className="location-action" aria-label={configureLabel} title={configureLabel} onClick={() => locationFrameInput?.onConfigure?.(frame.locationId)}>⚙</button>
                </span>} /></div>;
            })}
          </div>
        </ViewportPortal>}
        {arrangement.preview && <ViewportPortal><div className="location-arrangement-layer">
            {arrangement.selected && (() => {
              const frame = [...renderableFrames, ...locationPresentation.proxies.filter(p => !p.partial)].find(f => f.locationId === arrangement.selected);
              return frame ? <LocationArrangementToolbar canvasRef={canvasRef} frame={frame} uiScale={Math.min(1, 1 / frameUiZoom)} canMove={arrangement.canMove} onMove={arrangement.move} /> : null;
            })()}
        </div></ViewportPortal>}
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
        {!annotationMode && <ForegroundCableRoutes edges={edges} virtualChannels={useVirtualChannels}
          locationInputs={showLocationPresentation || (physicalObjectView && requireLocationChannels) ? [...locationChannels.values()] : undefined}
          zoom={frameUiZoom} showChannelTerminals={showChannelTerminals}
          showAllVirtualChannels={showAllVirtualChannels} physicalPortStates={physicalPortStates} bulkPortNumbers={bulkPortNumbers} bulkPairs={bulkPairs} wiringRoute={wiringRoute} traceActive={cableTraceActive} onCableSelect={selectCable} onCableContextMenu={(event, edge) => onEdgeContextMenu(event, edge)} />}
      </ReactFlow>
    </div>
  );
}
