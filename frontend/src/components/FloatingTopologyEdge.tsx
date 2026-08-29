import {
  BaseEdge,
  Position,
  ViewportPortal,
  getStraightPath,
  useReactFlow,
  useInternalNode,
  useNodes,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import {
  LAYOUT_NODE_HEIGHT,
  LAYOUT_NODE_WIDTH,
  type DeviceFlowNode,
  type LogicalFlowEdge,
} from '../topology/layout';
import { genericConnectionPoints, genericEndpointOffset } from '../topology/genericEndpointPresentation';
import type { MapCableRouteWaypoint } from '../topology/savedMapTypes';
import { blueprintDisplayDimensions, blueprintMapNameplateHeight, visibleBlueprintFaces } from '../topology/blueprintDisplaySize';

export interface NodeRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingEndpoint {
  x: number;
  y: number;
  side: Position;
}

const intersection = (from: NodeRectangle, to: NodeRectangle): FloatingEndpoint => {
  const centerX = from.x + from.width / 2;
  const centerY = from.y + from.height / 2;
  const deltaX = to.x + to.width / 2 - centerX;
  const deltaY = to.y + to.height / 2 - centerY;
  const horizontalScale = deltaX === 0 ? Number.POSITIVE_INFINITY : from.width / 2 / Math.abs(deltaX);
  const verticalScale = deltaY === 0 ? Number.POSITIVE_INFINITY : from.height / 2 / Math.abs(deltaY);
  const scale = Math.min(horizontalScale, verticalScale);
  const x = centerX + deltaX * scale;
  const y = centerY + deltaY * scale;

  if (horizontalScale < verticalScale) {
    return { x, y, side: deltaX > 0 ? Position.Right : Position.Left };
  }
  return { x, y, side: deltaY > 0 ? Position.Bottom : Position.Top };
};

export const getFloatingEndpoints = (
  source: NodeRectangle,
  target: NodeRectangle,
): { source: FloatingEndpoint; target: FloatingEndpoint } => {
  const sameCenter = source.x + source.width / 2 === target.x + target.width / 2
    && source.y + source.height / 2 === target.y + target.height / 2;
  if (sameCenter) {
    return {
      source: { x: source.x + source.width, y: source.y + source.height / 2, side: Position.Right },
      target: { x: target.x, y: target.y + target.height / 2, side: Position.Left },
    };
  }
  return {
    source: intersection(source, target),
    target: intersection(target, source),
  };
};

const rectangle = (node: InternalNode<DeviceFlowNode>): NodeRectangle => ({
  x: node.internals.positionAbsolute.x,
  y: node.internals.positionAbsolute.y,
  width: node.measured.width ?? node.width ?? LAYOUT_NODE_WIDTH,
  height: node.measured.height ?? node.height ?? LAYOUT_NODE_HEIGHT,
});

export const getConnectionPointEndpoint = (
  projection: DeviceFlowNode['data']['projection'],
  box: NodeRectangle,
  connectionPointId: string | undefined,
): FloatingEndpoint | null => {
  if (!connectionPointId) return null;
  const presentation = projection.attributes.blueprint_presentation;
  const slot = presentation?.slots.find((item) => item.connection_point_id === connectionPointId);
  if (slot && presentation) {
    const side = slot.external_attachment.side;
    const faces = visibleBlueprintFaces(presentation);
    const faceIndex = faces.indexOf(slot.face ?? 'FRONT');
    const face = blueprintDisplayDimensions(presentation.body, box.width);
    const panelTop = faceIndex * face.height;
    return {
      x: box.x + box.width * slot.external_attachment.x,
      y: box.y + blueprintMapNameplateHeight(presentation, box.width) + panelTop + face.height * slot.external_attachment.y,
      side: side === 'LEFT' ? Position.Left : side === 'RIGHT' ? Position.Right : side === 'TOP' ? Position.Top : Position.Bottom,
    };
  }
  const points = genericConnectionPoints(projection); const index = points.findIndex((point) => point.connection_point_id === connectionPointId); return index < 0 ? null : { x: box.x + box.width, y: box.y + box.height * genericEndpointOffset(index, points.length), side: Position.Right };
};

/** Visible Blueprint port position used by Saved Map cable presentation. */
export const getRenderedConnectionPoint = (
  projection: DeviceFlowNode['data']['projection'],
  box: NodeRectangle,
  connectionPointId: string | undefined,
): FloatingEndpoint | null => {
  if (!connectionPointId) return null;
  const presentation = projection.attributes.blueprint_presentation;
  const slot = presentation?.slots.find((item) => item.connection_point_id === connectionPointId);
  if (!slot || !presentation) return getConnectionPointEndpoint(projection, box, connectionPointId);
  const faces = visibleBlueprintFaces(presentation);
  const faceIndex = faces.indexOf(slot.face ?? 'FRONT');
  const face = blueprintDisplayDimensions(presentation.body, box.width);
  const panelTop = faceIndex * face.height;
  const side = slot.external_attachment.side;
  return {
    x: box.x + box.width * slot.rendered_position.x,
    y: box.y + blueprintMapNameplateHeight(presentation, box.width) + panelTop + face.height * slot.rendered_position.y,
    side: side === 'LEFT' ? Position.Left : side === 'RIGHT' ? Position.Right : side === 'TOP' ? Position.Top : Position.Bottom,
  };
};

export const routedCablePath = (
  source: FloatingEndpoint,
  target: FloatingEndpoint,
  waypoints: readonly MapCableRouteWaypoint[],
): string => [source, ...waypoints, target]
  .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
  .join(' ');

/** Presentation-only route used while the user is drawing a new cable. */
export function WiringRoute(props: {
  source: { physicalObjectId: string; connectionPointId: string };
  target?: { physicalObjectId: string; connectionPointId: string };
  waypoints: readonly MapCableRouteWaypoint[];
  selectedWaypointIndex: number | null;
  onWaypointSelect: (index: number) => void;
  onWaypointMove: (index: number, waypoint: MapCableRouteWaypoint) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const nodes = useNodes<DeviceFlowNode>();
  const sourceFlowId = nodes.find((node) => node.data.projection.source_refs.some((ref) => ref.entity_type === 'PhysicalObject' && ref.entity_id === props.source.physicalObjectId))?.id;
  const targetFlowId = props.target && nodes.find((node) => node.data.projection.source_refs.some((ref) => ref.entity_type === 'PhysicalObject' && ref.entity_id === props.target!.physicalObjectId))?.id;
  const sourceNode = useInternalNode<DeviceFlowNode>(sourceFlowId ?? '__none__');
  const targetNode = useInternalNode<DeviceFlowNode>(targetFlowId ?? '__none__');
  if (!sourceNode) return null;
  const source = getRenderedConnectionPoint(sourceNode.data.projection, rectangle(sourceNode), props.source.connectionPointId);
  const target = props.target && targetNode
    ? getRenderedConnectionPoint(targetNode.data.projection, rectangle(targetNode), props.target.connectionPointId)
    : undefined;
  if (!source) return null;
  const path = target
    ? routedCablePath(source, target, props.waypoints)
    : props.waypoints.length
      ? [source, ...props.waypoints].map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
      : '';
  return <>
    {path && <path className="wiring-route-preview" d={path} fill="none" stroke="#8d7aff" strokeWidth={3} pointerEvents="none" />}
    {props.waypoints.map((waypoint, index) => <circle key={`wiring-route:${index}`} className={`cable-route-waypoint wiring-route-waypoint${props.selectedWaypointIndex === index ? ' cable-route-waypoint--selected' : ''}`} cx={waypoint.x} cy={waypoint.y} r={6} style={{ pointerEvents: 'all' }} onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); props.onWaypointSelect(index); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.stopPropagation(); event.preventDefault(); props.onWaypointMove(index, screenToFlowPosition({ x: event.clientX, y: event.clientY })); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />)}
  </>;
}

export function FloatingTopologyEdge({
  id,
  source,
  target,
  style,
  markerStart,
  markerEnd,
  interactionWidth,
  data,
}: EdgeProps<LogicalFlowEdge>) {
  const { screenToFlowPosition } = useReactFlow();
  const sourceNode = useInternalNode<DeviceFlowNode>(source);
  const targetNode = useInternalNode<DeviceFlowNode>(target);
  if (!sourceNode || !targetNode) return null;

  const pair = data?.endpointPair;
  const exact = (node: InternalNode<DeviceFlowNode>, connectionPointId: string | undefined): FloatingEndpoint | null => data?.cableNode
    ? getRenderedConnectionPoint(node.data.projection, rectangle(node), connectionPointId)
    : getConnectionPointEndpoint(node.data.projection, rectangle(node), connectionPointId);
  const floating = getFloatingEndpoints(rectangle(sourceNode), rectangle(targetNode));
  const endpoints = { source: exact(sourceNode, pair?.from_connection_point_id) ?? floating.source, target: exact(targetNode, pair?.to_connection_point_id) ?? floating.target };
  const [straightPath] = getStraightPath({
    sourceX: endpoints.source.x,
    sourceY: endpoints.source.y,
    targetX: endpoints.target.x,
    targetY: endpoints.target.y,
  });
  const draft = data?.cableRouteDraft;
  const waypoints = draft?.waypoints ?? data?.cableRoute?.waypoints;
  const path = waypoints
    ? routedCablePath(endpoints.source, endpoints.target, waypoints)
    : straightPath;
  const segmentPoints = [endpoints.source, ...(waypoints ?? []), endpoints.target];
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={interactionWidth} />
      {draft && !data?.renderRouteEditorInForeground && segmentPoints.slice(0, -1).map((point, index) => {
        const next = segmentPoints[index + 1];
        return <line
          key={`${id}:segment:${index}`}
          className="cable-route-segment-hit"
          x1={point.x} y1={point.y} x2={next.x} y2={next.y}
          stroke="transparent" strokeWidth={22} pointerEvents="stroke"
          onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); draft.onWaypointInsert(index, screenToFlowPosition({ x: event.clientX, y: event.clientY })); }}
        />;
      })}
      {draft && !data?.renderRouteEditorInForeground && draft.waypoints.map((waypoint, index) => (
        <circle
          key={`${id}:waypoint:${index}`}
          className={`cable-route-waypoint${draft.selectedWaypointIndex === index ? ' cable-route-waypoint--selected' : ''}`}
          cx={waypoint.x}
          cy={waypoint.y}
          r={6}
          style={{ pointerEvents: 'all' }}
          onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); draft.onWaypointSelect(index); }}
          onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.stopPropagation(); event.preventDefault(); draft.onWaypointMove(index, screenToFlowPosition({ x: event.clientX, y: event.clientY })); }}
          onPointerUp={(event) => { event.stopPropagation(); event.preventDefault(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        />
      ))}
    </>
  );
}

function ForegroundCableRoute({ edge }: { edge: LogicalFlowEdge }) {
  const { screenToFlowPosition } = useReactFlow();
  const sourceNode = useInternalNode<DeviceFlowNode>(edge.source);
  const targetNode = useInternalNode<DeviceFlowNode>(edge.target);
  const data = edge.data;
  if (!sourceNode || !targetNode || !data?.cableNode) return null;

  const pair = data.endpointPair;
  const floating = getFloatingEndpoints(rectangle(sourceNode), rectangle(targetNode));
  const endpoints = {
    source: getRenderedConnectionPoint(sourceNode.data.projection, rectangle(sourceNode), pair?.from_connection_point_id) ?? floating.source,
    target: getRenderedConnectionPoint(targetNode.data.projection, rectangle(targetNode), pair?.to_connection_point_id) ?? floating.target,
  };
  const draft = data.cableRouteDraft;
  const waypoints = draft?.waypoints ?? data.cableRoute?.waypoints;
  const path = routedCablePath(endpoints.source, endpoints.target, waypoints ?? []);
  const emphasis = draft ? 'editing' : edge.selected ? 'selected' : 'normal';
  const style = draft ? { stroke: '#8d7aff', strokeWidth: 5, opacity: 1 } : edge.style;
  const segmentPoints = [endpoints.source, ...(waypoints ?? []), endpoints.target];

  return <g data-testid={`foreground-cable-${edge.id}`} data-emphasis={emphasis}>
    <path className={`cable-route-foreground cable-route-foreground--${emphasis}`} d={path} fill="none" style={{ ...style, pointerEvents: 'none' }} />
    {draft && segmentPoints.slice(0, -1).map((point, index) => {
      const next = segmentPoints[index + 1];
      return <line key={`${edge.id}:foreground-segment:${index}`} className="cable-route-segment-hit" x1={point.x} y1={point.y} x2={next.x} y2={next.y} stroke="transparent" strokeWidth={22} pointerEvents="stroke" onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); draft.onWaypointInsert(index, screenToFlowPosition({ x: event.clientX, y: event.clientY })); }} />;
    })}
    {draft?.waypoints.map((waypoint, index) => (
      <circle key={`${edge.id}:foreground-waypoint:${index}`} className={`cable-route-waypoint${draft.selectedWaypointIndex === index ? ' cable-route-waypoint--selected' : ''}`} cx={waypoint.x} cy={waypoint.y} r={6} pointerEvents="all" onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); draft.onWaypointSelect(index); }} onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.stopPropagation(); event.preventDefault(); draft.onWaypointMove(index, screenToFlowPosition({ x: event.clientX, y: event.clientY })); }} onPointerUp={(event) => { event.stopPropagation(); event.preventDefault(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
    ))}
  </g>;
}

export type ForegroundPortState = 'eligible' | 'source' | 'destination' | 'unavailable';

function ForegroundPortMarkers({ physicalPortStates }: { physicalPortStates?: Record<string, ForegroundPortState> }) {
  const nodes = useNodes<DeviceFlowNode>();
  return <>{nodes.map((node) => <ForegroundNodePortMarkers key={node.id} nodeId={node.id} physicalPortStates={physicalPortStates} />)}</>;
}

function ForegroundNodePortMarkers({ nodeId, physicalPortStates }: { nodeId: string; physicalPortStates?: Record<string, ForegroundPortState> }) {
  const node = useInternalNode<DeviceFlowNode>(nodeId);
  if (!node || node.data.projection.kind !== 'PHYSICAL_OBJECT') return null;
  const projection = node.data.projection;
  const blueprint = projection.attributes.blueprint_presentation;
  const ports = blueprint
    ? blueprint.slots.map((slot) => ({ id: slot.connection_point_id, network: slot.kind === 'NETWORK_PORT' }))
    : genericConnectionPoints(projection).map((point) => ({ id: point.connection_point_id, network: false }));
  return <g className="cable-route-port-markers" pointerEvents="none">
    {ports.map((port) => {
      const endpoint = getRenderedConnectionPoint(projection, rectangle(node), port.id);
      const state = physicalPortStates?.[port.id];
      const className = `cable-route-port-marker${port.network ? ' cable-route-port-marker--network' : ''}${state ? ` cable-route-port-marker--wiring-${state}` : ''}`;
      return endpoint && (port.network
        ? <rect key={port.id} className={className} x={endpoint.x - 3.5} y={endpoint.y - 3.5} width={7} height={7} rx={1} pointerEvents="none" />
        : <circle key={port.id} className={className} cx={endpoint.x} cy={endpoint.y} r={3.5} pointerEvents="none" />);
    })}
  </g>;
}

/** Foreground-only cable rendering; only route-editor controls accept input. */
export function ForegroundCableRoutes({ edges, physicalPortStates }: { edges: readonly LogicalFlowEdge[]; physicalPortStates?: Record<string, ForegroundPortState> }) {
  const cables = edges.filter((edge) => Boolean(edge.data?.cableNode));
  if (!cables.length) return null;
  return <ViewportPortal>
    <svg className="cable-routes-foreground" aria-hidden="true">
      {cables.map((edge) => <ForegroundCableRoute key={edge.id} edge={edge} />)}
      <ForegroundPortMarkers physicalPortStates={physicalPortStates} />
    </svg>
  </ViewportPortal>;
}
