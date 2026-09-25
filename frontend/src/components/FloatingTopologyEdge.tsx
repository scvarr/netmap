import {
  BaseEdge,
  Position,
  ViewportPortal,
  getStraightPath,
  useReactFlow,
  useInternalNode,
  useNodes,
  useViewport,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import { useEffect, useState, type MouseEvent, type PointerEvent } from 'react';
import {
  LAYOUT_NODE_HEIGHT,
  LAYOUT_NODE_WIDTH,
  type DeviceFlowNode,
  type LogicalFlowEdge,
} from '../topology/layout';
import { genericConnectionPoints, genericEndpointOffset } from '../topology/genericEndpointPresentation';
import type { MapCableRouteWaypoint } from '../topology/savedMapTypes';
import { blueprintDisplayDimensions, blueprintMapNameplateHeight, visibleBlueprintFaces } from '../topology/blueprintDisplaySize';
import { assistSegment, segmentAngle, segmentLength, type SegmentAssistResult } from '../topology/geometryAssist';
import { assistBoundaryWaypoint } from '../topology/locationBoundaryAnchors';
import { findForeignRouteSnap, FOREIGN_BOUNDARY_HALF_SIDE_FLOW, FOREIGN_BOUNDARY_STROKE_FLOW, FOREIGN_WAYPOINT_RADIUS_FLOW, FOREIGN_WAYPOINT_STROKE_FLOW, type ForeignRouteGeometry, type ForeignRouteSnap } from '../topology/foreignRouteSnap';
import { cableIdForNode } from '../topology/projection';

const CABLE_ANGLE_FAMILIES = [{ step: 45, capturePx: 12 }, { step: 15, capturePx: 5 }];
const EDITING_CABLE_STROKE_FLOW = 5;
const EDITABLE_WAYPOINT_RADIUS_FLOW = 2.25;
const EDITABLE_BOUNDARY_HALF_SIDE_FLOW = 1.75;
const EDITABLE_WAYPOINT_STROKE_FLOW = 0.5;
const rayIntersection = (left: MapCableRouteWaypoint, leftAngle: number, right: MapCableRouteWaypoint, rightAngle: number): MapCableRouteWaypoint | null => {
  const a = leftAngle * Math.PI / 180; const b = rightAngle * Math.PI / 180;
  const dx = Math.cos(a), dy = Math.sin(a), ex = Math.cos(b), ey = Math.sin(b);
  const cross = dx * ey - dy * ex;
  if (Math.abs(cross) < 1e-6) return null;
  const t = ((right.x - left.x) * ey - (right.y - left.y) * ex) / cross;
  return { x: left.x + t * dx, y: left.y + t * dy };
};

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
  const exact = (node: InternalNode<DeviceFlowNode>, connectionPointId: string | undefined): FloatingEndpoint | null => node.data.locationProxy ? null : data?.cableNode
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
      <BaseEdge id={id} path={path} style={style} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={data?.cableNode ? (draft ? 5 : Number(style?.strokeWidth) || 2) : interactionWidth} />
      {draft && !data?.renderRouteEditorInForeground && segmentPoints.slice(0, -1).map((point, index) => {
        const next = segmentPoints[index + 1];
        return <line
          key={`${id}:segment:${index}`}
          className="cable-route-segment-hit"
          x1={point.x} y1={point.y} x2={next.x} y2={next.y}
          stroke="transparent" strokeWidth={22} pointerEvents="stroke"
          onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); event.preventDefault(); draft.onWaypointInsert(index, screenToFlowPosition({ x: event.clientX, y: event.clientY })); }}
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
          onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); draft.onWaypointSelect(index); }}
          onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.stopPropagation(); event.preventDefault(); draft.onWaypointMove(index, screenToFlowPosition({ x: event.clientX, y: event.clientY })); }}
          onPointerUp={(event) => { event.stopPropagation(); event.preventDefault(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        />
      ))}
    </>
  );
}

type GeometryFeedback = { start: MapCableRouteWaypoint; end: MapCableRouteWaypoint; assist: SegmentAssistResult };

function ForegroundCableRoute({ edge, foreignGeometry, onCableClick, onCableContextMenu, onFeedbackChange, onSnapChange }: { edge: LogicalFlowEdge; foreignGeometry: readonly ForeignRouteGeometry[]; onCableClick?: (event: MouseEvent<SVGPathElement>, edge: LogicalFlowEdge) => void; onCableContextMenu?: (event: MouseEvent<SVGElement>, edge: LogicalFlowEdge) => void; onFeedbackChange: (edgeId: string, feedback: readonly GeometryFeedback[]) => void; onSnapChange: (snap: ForeignRouteSnap | null) => void }) {
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  const sourceNode = useInternalNode<DeviceFlowNode>(edge.source);
  const targetNode = useInternalNode<DeviceFlowNode>(edge.target);
  const data = edge.data;
  if (!sourceNode || !targetNode || !data?.cableNode) return null;

  const pair = data.endpointPair;
  const floating = getFloatingEndpoints(rectangle(sourceNode), rectangle(targetNode));
  const endpoints = {
    source: sourceNode.data.locationProxy ? floating.source : getRenderedConnectionPoint(sourceNode.data.projection, rectangle(sourceNode), pair?.from_connection_point_id) ?? floating.source,
    target: targetNode.data.locationProxy ? floating.target : getRenderedConnectionPoint(targetNode.data.projection, rectangle(targetNode), pair?.to_connection_point_id) ?? floating.target,
  };
  const draft = data.cableRouteDraft;
  const waypoints = draft?.waypoints ?? data.cableRoute?.waypoints;
  const path = routedCablePath(endpoints.source, endpoints.target, waypoints ?? []);
  const emphasis = draft ? 'editing' : edge.data?.cablePresentationEmphasis ?? (edge.selected ? 'selected' : 'normal');
  const style = draft ? { stroke: '#8d7aff', strokeWidth: EDITING_CABLE_STROKE_FLOW, opacity: 1 } : edge.style;
  const segmentPoints = [endpoints.source, ...(waypoints ?? []), endpoints.target];
  const setFeedback = (items: readonly GeometryFeedback[]) => onFeedbackChange(edge.id, items);
  const snapFrom = (event: PointerEvent<SVGElement>, boundary?: { locationId: string; bounds: { x: number; y: number; width: number; height: number } }) =>
    findForeignRouteSnap({ x: event.clientX, y: event.clientY }, foreignGeometry, flowToScreenPosition, screenToFlowPosition, boundary);
  const forwardContextMenu = onCableContextMenu ? (event: MouseEvent<SVGElement>) => { event.stopPropagation(); onCableContextMenu(event, edge); } : undefined;
  const assistFrom = (anchor: MapCableRouteWaypoint, event: PointerEvent<SVGElement>) =>
    assistSegment({
      anchor,
      pointerScreen: { x: event.clientX, y: event.clientY },
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      screenToFlowPosition,
      flowToScreenPosition,
      angleFamilies: CABLE_ANGLE_FAMILIES,
    });
  const moveWaypoint = (index: number, event: PointerEvent<SVGElement>) => {
    if (!draft) return;
    if (draft.waypoints[index]?.anchor) {
      const anchor = draft.waypoints[index].anchor;
      const frame = draft.boundaryFrames?.find((item) => item.locationId === anchor.location_id);
      if (!frame) return;
      const neighbors = [segmentPoints[index], segmentPoints[index + 2]];
      const snap = snapFrom(event, frame);
      const point = snap?.point ?? assistBoundaryWaypoint(frame.locationId, frame.bounds, screenToFlowPosition({ x: event.clientX, y: event.clientY }), neighbors, flowToScreenPosition);
      onSnapChange(snap);
      draft.onWaypointMove(index, point);
      setFeedback(neighbors.map((neighbor) => ({ start: neighbor, end: point, assist: assistFrom(neighbor, event) })));
      return;
    }
    const anchors = [segmentPoints[index], segmentPoints[index + 2]];
    const snap = snapFrom(event);
    onSnapChange(snap);
    if (snap) {
      draft.onWaypointMove(index, snap.point);
      setFeedback(anchors.map((anchor) => ({ start: anchor, end: snap.point, assist: assistFrom(anchor, event) })));
      return;
    }
    if (event.ctrlKey) {
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      draft.onWaypointMove(index, point); setFeedback(anchors.map((anchor) => ({ start: anchor, end: point, assist: assistFrom(anchor, event) }))); return;
    }
    if (event.shiftKey) {
      const point = assistFrom(anchors[0], event).point;
      draft.onWaypointMove(index, point); setFeedback(anchors.map((anchor) => ({ start: anchor, end: point, assist: assistFrom(anchor, event) }))); return;
    }
    const pointer = { x: event.clientX, y: event.clientY };
    const dual = (step: number, capturePx: number) => {
      const candidates: MapCableRouteWaypoint[] = [];
      for (let left = 0; left < 360; left += step) for (let right = 0; right < 360; right += step) {
        const point = rayIntersection(anchors[0], left, anchors[1], right);
        if (point && Math.hypot(flowToScreenPosition(point).x - pointer.x, flowToScreenPosition(point).y - pointer.y) <= capturePx) candidates.push(point);
      }
      return candidates.sort((a, b) => Math.hypot(flowToScreenPosition(a).x - pointer.x, flowToScreenPosition(a).y - pointer.y) - Math.hypot(flowToScreenPosition(b).x - pointer.x, flowToScreenPosition(b).y - pointer.y))[0];
    };
    const dualPoint = dual(45, 12) ?? dual(15, 5);
    const assists = anchors.map((anchor) => ({ anchor, assist: assistFrom(anchor, event) }));
    const chosen = assists.reduce((best, candidate) => {
      const bestPoint = flowToScreenPosition(best.assist.point);
      const candidatePoint = flowToScreenPosition(candidate.assist.point);
      const pointerDistance = (point: { x: number; y: number }) => Math.hypot(point.x - event.clientX, point.y - event.clientY);
      return pointerDistance(candidatePoint) < pointerDistance(bestPoint) ? candidate : best;
    });
    const point = dualPoint ?? chosen.assist.point;
    draft.onWaypointMove(index, point);
    setFeedback(anchors.map((anchor) => ({ start: anchor, end: point, assist: assistFrom(anchor, event) })));
  };
  const waypointHandlers = (index: number) => ({
    onPointerDown: (event: PointerEvent<SVGElement>) => { if (event.button !== 0 || !draft) return; event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); draft.onWaypointSelect(index); },
    onPointerMove: (event: PointerEvent<SVGElement>) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.stopPropagation(); event.preventDefault(); moveWaypoint(index, event); },
    onPointerUp: (event: PointerEvent<SVGElement>) => { event.stopPropagation(); event.preventDefault(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setFeedback([]); onSnapChange(null); },
    onPointerCancel: () => { setFeedback([]); onSnapChange(null); },
    onContextMenu: forwardContextMenu,
  });

  return <g data-testid={`foreground-cable-${edge.id}`} data-emphasis={emphasis}>
    <path className={`cable-route-foreground cable-route-foreground--${emphasis}`} d={path} fill="none" style={{ ...style, pointerEvents: onCableClick || onCableContextMenu ? 'stroke' : 'none' }} onClick={onCableClick ? (event) => { event.stopPropagation(); onCableClick(event, edge); } : undefined} onContextMenu={forwardContextMenu} />
    {draft && segmentPoints.slice(0, -1).map((point, index) => {
      const next = segmentPoints[index + 1];
      return <line key={`${edge.id}:foreground-segment:${index}`} className="cable-route-segment-hit" x1={point.x} y1={point.y} x2={next.x} y2={next.y} stroke="transparent" strokeWidth={22} pointerEvents="stroke" onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); event.preventDefault(); const snap = snapFrom(event); const assist = assistFrom(point, event); draft.onWaypointInsert(index, snap?.point ?? assist.point); onSnapChange(null); setFeedback([]); }} onContextMenu={forwardContextMenu} />;
    })}
    {draft?.waypoints.map((waypoint, index) => (
      <g key={`${edge.id}:foreground-waypoint:${index}`}>
        {waypoint.anchor
          ? <rect className={`cable-route-waypoint cable-route-waypoint--editable cable-route-waypoint--boundary${draft.selectedWaypointIndex === index ? ' cable-route-waypoint--selected' : ''}`} x={waypoint.x - EDITABLE_BOUNDARY_HALF_SIDE_FLOW} y={waypoint.y - EDITABLE_BOUNDARY_HALF_SIDE_FLOW} width={EDITABLE_BOUNDARY_HALF_SIDE_FLOW * 2} height={EDITABLE_BOUNDARY_HALF_SIDE_FLOW * 2} transform={`rotate(45 ${waypoint.x} ${waypoint.y})`} pointerEvents="all" style={{ cursor: 'move', strokeWidth: EDITABLE_WAYPOINT_STROKE_FLOW }} {...waypointHandlers(index)} />
          : <circle className={`cable-route-waypoint cable-route-waypoint--editable${draft.selectedWaypointIndex === index ? ' cable-route-waypoint--selected' : ''}`} cx={waypoint.x} cy={waypoint.y} r={EDITABLE_WAYPOINT_RADIUS_FLOW} pointerEvents="all" style={{ cursor: 'move', strokeWidth: EDITABLE_WAYPOINT_STROKE_FLOW }} {...waypointHandlers(index)} />}
      </g>
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
  // A collapsed Location proxy is a presentation anchor, never a PhysicalObject with ports.
  if (!node || node.data.locationProxy || !node.data.projection || node.data.projection.kind !== 'PHYSICAL_OBJECT') return null;
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

const cablePriority = (edge: LogicalFlowEdge) => edge.data?.cableRouteDraft ? 3
  : edge.selected || edge.data?.cablePresentationEmphasis === 'selected' ? 2
    : edge.data?.cablePresentationEmphasis === 'attached' || edge.data?.cablePresentationEmphasis === 'traced' ? 1 : 0;

export function layoutGeometryFeedback(items: readonly GeometryFeedback[], zoom: number) {
  const candidates = items.map((item, index) => {
    const length = segmentLength(item.start, item.end);
    const label = `${Math.round(segmentAngle(item.start, item.end))}° · ${Math.round(length)}`;
    const x = (item.start.x + item.end.x) / 2;
    const y = (item.start.y + item.end.y) / 2 - 10 / zoom;
    return { index, length, label, x, y, width: label.length * 7.5 + 8 };
  }).filter((item) => item.length * zoom >= Math.max(56, item.width + 12));
  const accepted: typeof candidates = [];
  for (const candidate of candidates.sort((a, b) => b.length - a.length || a.index - b.index)) {
    if (accepted.some((other) => Math.abs(candidate.x - other.x) * zoom < (candidate.width + other.width) / 2 + 8 && Math.abs(candidate.y - other.y) * zoom < 20)) continue;
    accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.index - b.index);
}

/** Foreground cable selection and route editing share the same visual stack. */
export function ForegroundCableRoutes({ edges, physicalPortStates, wiringRoute, onCableClick, onCableContextMenu }: { edges: readonly LogicalFlowEdge[]; physicalPortStates?: Record<string, ForegroundPortState>; wiringRoute?: Parameters<typeof WiringRoute>[0]; onCableClick?: (event: MouseEvent<SVGPathElement>, edge: LogicalFlowEdge) => void; onCableContextMenu?: (event: MouseEvent<SVGElement>, edge: LogicalFlowEdge) => void }) {
  const { zoom } = useViewport();
  const nodes = useNodes<DeviceFlowNode>();
  const [feedbackByCable, setFeedbackByCable] = useState<Record<string, readonly GeometryFeedback[]>>({});
  const [activeSnap, setActiveSnap] = useState<{ edgeId: string; snap: ForeignRouteSnap } | null>(null);
  const cables = edges.filter((edge) => Boolean(edge.data?.cableNode));
  const editingCableId = cables.find((edge) => edge.data?.cableRouteDraft)?.id ?? null;
  useEffect(() => { setActiveSnap(null); setFeedbackByCable({}); }, [editingCableId]);
  if (!cables.length && !wiringRoute) return null;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const geometryByCable = new Map(cables.flatMap((edge) => {
    const sourceNode = nodeById.get(edge.source), targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) return [];
    const box = (node: DeviceFlowNode): NodeRectangle => ({
      x: node.position.x, y: node.position.y,
      width: node.measured?.width ?? node.width ?? LAYOUT_NODE_WIDTH,
      height: node.measured?.height ?? node.height ?? LAYOUT_NODE_HEIGHT,
    });
    const sourceBox = box(sourceNode), targetBox = box(targetNode);
    const floating = getFloatingEndpoints(sourceBox, targetBox);
    const pair = edge.data?.endpointPair;
    const source = sourceNode.data.locationProxy ? floating.source : getRenderedConnectionPoint(sourceNode.data.projection, sourceBox, pair?.from_connection_point_id) ?? floating.source;
    const target = targetNode.data.locationProxy ? floating.target : getRenderedConnectionPoint(targetNode.data.projection, targetBox, pair?.to_connection_point_id) ?? floating.target;
    const waypoints = edge.data?.cableRouteDraft?.waypoints ?? edge.data?.cableRoute?.waypoints ?? [];
    const points = [source, ...waypoints, target];
    return [[edge.id, { waypoints, segments: points.slice(0, -1).map((point, index) => [point, points[index + 1]] as const) }] as const];
  }));
  const foreignGeometryFor = (editing: LogicalFlowEdge): ForeignRouteGeometry[] => cables
    .filter((other) => other.id !== editing.id && (!other.data?.cableNode?.source_refs || cableIdForNode(other.data.cableNode) !== editing.data?.cableRouteDraft?.cableId))
    .flatMap((other) => { const geometry = geometryByCable.get(other.id); return geometry ? [geometry] : []; });
  const editingEdge = cables.find((edge) => edge.data?.cableRouteDraft);
  const foreignGeometry = editingEdge ? foreignGeometryFor(editingEdge) : [];
  const ordered = cables.map((edge, index) => ({ edge, index })).sort((a, b) => cablePriority(a.edge) - cablePriority(b.edge) || a.index - b.index);
  const feedback = layoutGeometryFeedback(ordered.flatMap(({ edge }) => edge.data?.cableRouteDraft ? feedbackByCable[edge.id] ?? [] : []), zoom);
  const snap = activeSnap && cables.some((edge) => edge.id === activeSnap.edgeId && edge.data?.cableRouteDraft) ? activeSnap.snap : null;
  return <ViewportPortal>
    <svg className="cable-routes-foreground" aria-hidden="true">
      {ordered.map(({ edge }) => <ForegroundCableRoute key={edge.id} edge={edge} foreignGeometry={edge.data?.cableRouteDraft ? foreignGeometry : []} onCableClick={onCableClick} onCableContextMenu={onCableContextMenu} onFeedbackChange={(edgeId, items) => setFeedbackByCable((current) => ({ ...current, [edgeId]: items }))} onSnapChange={(next) => setActiveSnap(next ? { edgeId: edge.id, snap: next } : null)} />)}
      <ForegroundPortMarkers physicalPortStates={physicalPortStates} />
      {wiringRoute && <g data-testid="foreground-wiring-route"><WiringRoute {...wiringRoute} /></g>}
      <g className="cable-route-feedback-layer" pointerEvents="none">
        {foreignGeometry.flatMap((route) => route.waypoints).map((waypoint, index) => waypoint.anchor
          ? <rect key={`foreign-waypoint:${index}`} className="cable-route-foreign-target-marker cable-route-foreign-target-marker--boundary" x={waypoint.x - FOREIGN_BOUNDARY_HALF_SIDE_FLOW} y={waypoint.y - FOREIGN_BOUNDARY_HALF_SIDE_FLOW} width={FOREIGN_BOUNDARY_HALF_SIDE_FLOW * 2} height={FOREIGN_BOUNDARY_HALF_SIDE_FLOW * 2} transform={`rotate(45 ${waypoint.x} ${waypoint.y})`} fill="none" strokeWidth={FOREIGN_BOUNDARY_STROKE_FLOW} pointerEvents="none" />
          : <circle key={`foreign-waypoint:${index}`} className="cable-route-foreign-target-marker" cx={waypoint.x} cy={waypoint.y} r={FOREIGN_WAYPOINT_RADIUS_FLOW} fill="none" strokeWidth={FOREIGN_WAYPOINT_STROKE_FLOW} pointerEvents="none" />)}
        {snap?.kind === 'segment' && snap.segment && <line className="cable-route-foreign-segment-feedback" x1={snap.segment[0].x} y1={snap.segment[0].y} x2={snap.segment[1].x} y2={snap.segment[1].y} stroke="#ffca66" strokeWidth={4 / zoom} opacity={0.9} pointerEvents="none" />}
        {snap && <circle className={`cable-route-foreign-${snap.kind}-feedback`} cx={snap.point.x} cy={snap.point.y} r={6 / zoom} fill="#ffca66" stroke="#172629" strokeWidth={2 / zoom} pointerEvents="none" />}
        {feedback.map((item) => <text key={item.index} className="cable-route-geometry-feedback" x={item.x} y={item.y} textAnchor="middle" fontSize={12 / zoom} strokeWidth={3 / zoom}>{item.label}</text>)}
      </g>
    </svg>
  </ViewportPortal>;
}
