import {
  BaseEdge,
  Position,
  getStraightPath,
  useReactFlow,
  useInternalNode,
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
  if (slot) { const side = slot.anchor.side; return { x: box.x + (side === 'LEFT' ? 0 : side === 'RIGHT' ? box.width : box.width * slot.anchor.offset), y: box.y + (side === 'TOP' ? 0 : side === 'BOTTOM' ? box.height : box.height * slot.anchor.offset), side: side === 'LEFT' ? Position.Left : side === 'RIGHT' ? Position.Right : side === 'TOP' ? Position.Top : Position.Bottom }; }
  const points = genericConnectionPoints(projection); const index = points.findIndex((point) => point.connection_point_id === connectionPointId); return index < 0 ? null : { x: box.x + box.width, y: box.y + box.height * genericEndpointOffset(index, points.length), side: Position.Right };
};

export const routedCablePath = (
  source: FloatingEndpoint,
  target: FloatingEndpoint,
  waypoints: readonly MapCableRouteWaypoint[],
): string => [source, ...waypoints, target]
  .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
  .join(' ');

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
