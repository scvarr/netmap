import {
  BaseEdge,
  Position,
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
import { blueprintDisplayDimensions, visibleBlueprintFaces } from '../topology/blueprintDisplaySize';

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
    const side = slot.anchor.side;
    const faces = visibleBlueprintFaces(presentation);
    const faceIndex = faces.indexOf(slot.face ?? 'FRONT');
    const face = blueprintDisplayDimensions(presentation.body, box.width);
    const panelTop = faceIndex * face.height;
    return {
      x: box.x + (side === 'LEFT' ? 0 : side === 'RIGHT' ? box.width : box.width * slot.anchor.offset),
      y: box.y + panelTop + (side === 'TOP' ? 0 : side === 'BOTTOM' ? face.height : face.height * slot.anchor.offset),
      side: side === 'LEFT' ? Position.Left : side === 'RIGHT' ? Position.Right : side === 'TOP' ? Position.Top : Position.Bottom,
    };
  }
  const points = genericConnectionPoints(projection); const index = points.findIndex((point) => point.connection_point_id === connectionPointId); return index < 0 ? null : { x: box.x + box.width, y: box.y + box.height * genericEndpointOffset(index, points.length), side: Position.Right };
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
  const source = getConnectionPointEndpoint(sourceNode.data.projection, rectangle(sourceNode), props.source.connectionPointId);
  const target = props.target && targetNode
    ? getConnectionPointEndpoint(targetNode.data.projection, rectangle(targetNode), props.target.connectionPointId)
    : undefined;
  if (!source) return null;
  const points = target ? [source, ...props.waypoints, target] : [source, ...props.waypoints];
  const path = points.length > 1 ? points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ') : '';
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
  const exact = (node: InternalNode<DeviceFlowNode>, connectionPointId: string | undefined): FloatingEndpoint | null => getConnectionPointEndpoint(node.data.projection, rectangle(node), connectionPointId);
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
      {draft && segmentPoints.slice(0, -1).map((point, index) => {
        const next = segmentPoints[index + 1];
        return <line
          key={`${id}:segment:${index}`}
          className="cable-route-segment-hit"
          x1={point.x} y1={point.y} x2={next.x} y2={next.y}
          stroke="transparent" strokeWidth={22} pointerEvents="stroke"
          onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); draft.onWaypointInsert(index, screenToFlowPosition({ x: event.clientX, y: event.clientY })); }}
        />;
      })}
      {draft?.waypoints.map((waypoint, index) => (
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
