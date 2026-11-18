import { useRuntimePortTypes } from './RuntimePortTypes';
import {
  BaseEdge,
  Position,
  ViewportPortal,
  getStraightPath,
  useInternalNode,
  useNodes,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import { useMemo, type MouseEvent } from 'react';
import {
  LAYOUT_NODE_HEIGHT,
  LAYOUT_NODE_WIDTH,
  type DeviceFlowNode,
  type LogicalFlowEdge,
} from '../topology/layout';
import { genericConnectionPoints, genericEndpointOffset } from '../topology/genericEndpointPresentation';
import { BLUEPRINT_PORT_SIZE, BLUEPRINT_PORT_STROKE, OBJECT_NAME_ZONE_WIDTH, blueprintNodeDisplayDimensions } from '../topology/blueprintDisplaySize';
import { cableIdForNode, physicalObjectIdForNode } from '../topology/projection';
import { objectVirtualChannels, type VirtualChannelSegment } from '../topology/objectVirtualChannels';
import type { BlueprintPresentation } from '../topology/types';

export interface NodeRectangle {
  compositionDisplayWidth?: number;
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
  compositionDisplayWidth: node.data.compositionDisplayWidth,
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
    const composition = blueprintNodeDisplayDimensions(presentation, box.compositionDisplayWidth);
    return {
      x: box.x + OBJECT_NAME_ZONE_WIDTH + composition.width * slot.external_attachment.x,
      y: box.y + composition.height * slot.external_attachment.y,
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
  const composition = blueprintNodeDisplayDimensions(presentation, box.compositionDisplayWidth);
  const side = slot.external_attachment.side;
  return {
    x: box.x + OBJECT_NAME_ZONE_WIDTH + composition.width * slot.rendered_position.x,
    y: box.y + composition.height * slot.rendered_position.y,
    side: side === 'LEFT' ? Position.Left : side === 'RIGHT' ? Position.Right : side === 'TOP' ? Position.Top : Position.Bottom,
  };
};

interface WiringPort {
  physicalObjectId: string;
  connectionPointId: string;
}

interface WiringRouteDraft {
  source: WiringPort;
  target?: WiringPort;
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
  const sourceNode = useInternalNode<DeviceFlowNode>(source);
  const targetNode = useInternalNode<DeviceFlowNode>(target);
  if (!sourceNode || !targetNode || data?.renderCableInForegroundOnly) return null;

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
  return <BaseEdge id={id} path={straightPath} style={style} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={data?.cableNode ? Number(style?.strokeWidth) || 2 : interactionWidth} />;
}

function ForegroundCableRoute({ edge, channelExits, onCableClick, onCableContextMenu }: { edge: LogicalFlowEdge; channelExits?: { source?: FloatingEndpoint; target?: FloatingEndpoint }; onCableClick?: (event: MouseEvent<SVGPathElement>, edge: LogicalFlowEdge) => void; onCableContextMenu?: (event: MouseEvent<SVGElement>, edge: LogicalFlowEdge) => void }) {
  const sourceNode = useInternalNode<DeviceFlowNode>(edge.source);
  const targetNode = useInternalNode<DeviceFlowNode>(edge.target);
  const data = edge.data;
  if (!sourceNode || !targetNode || !data?.cableNode) return null;

  const pair = data.endpointPair;
  const floating = getFloatingEndpoints(rectangle(sourceNode), rectangle(targetNode));
  const endpoints = {
    source: channelExits?.source ?? (sourceNode.data.locationProxy ? floating.source : getRenderedConnectionPoint(sourceNode.data.projection, rectangle(sourceNode), pair?.from_connection_point_id) ?? floating.source),
    target: channelExits?.target ?? (targetNode.data.locationProxy ? floating.target : getRenderedConnectionPoint(targetNode.data.projection, rectangle(targetNode), pair?.to_connection_point_id) ?? floating.target),
  };
  const path = `M ${endpoints.source.x} ${endpoints.source.y} L ${endpoints.target.x} ${endpoints.target.y}`;
  const emphasis = data.cablePresentationEmphasis ?? (edge.selected ? 'selected' : 'normal');
  const forwardContextMenu = onCableContextMenu ? (event: MouseEvent<SVGElement>) => { event.stopPropagation(); onCableContextMenu(event, edge); } : undefined;

  return <g data-testid={`foreground-cable-${edge.id}`} data-emphasis={emphasis}>
    <path className={`cable-route-foreground cable-route-foreground--${emphasis}`} d={path} fill="none" style={{ ...edge.style, pointerEvents: onCableClick || onCableContextMenu ? 'stroke' : 'none' }} onClick={onCableClick ? (event) => { event.stopPropagation(); onCableClick(event, edge); } : undefined} onContextMenu={forwardContextMenu} />
  </g>;
}

export type ForegroundPortState = 'eligible' | 'source' | 'destination' | 'unavailable';

function ForegroundPortMarkers({ physicalPortStates, bulkPortNumbers }: { physicalPortStates?: Record<string, ForegroundPortState>; bulkPortNumbers?: Record<string, number> }) {
  const nodes = useNodes<DeviceFlowNode>();
  return <>{nodes.map((node) => <ForegroundNodePortMarkers key={node.id} nodeId={node.id} physicalPortStates={physicalPortStates} bulkPortNumbers={bulkPortNumbers} />)}</>;
}

function ForegroundNodePortMarkers({ nodeId, physicalPortStates, bulkPortNumbers }: { nodeId: string; physicalPortStates?: Record<string, ForegroundPortState>; bulkPortNumbers?: Record<string, number> }) {
  const portTypes = useRuntimePortTypes();
  const node = useInternalNode<DeviceFlowNode>(nodeId);
  // A collapsed Location proxy is a presentation anchor, never a PhysicalObject with ports.
  if (!node || node.data.locationProxy || !node.data.projection || node.data.projection.kind !== 'PHYSICAL_OBJECT') return null;
  const projection = node.data.projection;
  const blueprint = projection.attributes.blueprint_presentation;
  const ports = blueprint
    ? blueprint.slots.map((slot) => ({ id: slot.connection_point_id, network: slot.kind === 'NETWORK_PORT', portTypeId: slot.port_type_id }))
    : genericConnectionPoints(projection).map((point) => ({ id: point.connection_point_id, network: false, portTypeId: undefined }));
  return <g className="cable-route-port-markers" pointerEvents="none">
    {ports.map((port) => {
      const endpoint = getRenderedConnectionPoint(projection, rectangle(node), port.id);
      const fill = portTypes?.find((type) => type.id === port.portTypeId)?.color ?? '#18383a';
      const state = physicalPortStates?.[port.id];
      const traced = (projection.attributes.internal_l1_links ?? []).some(link => node.data.traceHighlightedConnectionMemberIds?.has(link.connection_member_id) && [link.from_connection_point_id, link.to_connection_point_id].includes(port.id));
      const stroke = state === 'source' || state === 'destination' ? '#fff' : state === 'eligible' ? '#7be6ff' : traced ? '#fff2bc' : '#e6fffb';
      const radius = blueprint ? (BLUEPRINT_PORT_SIZE - BLUEPRINT_PORT_STROKE) / 2 : 3.5;
      const className = `cable-route-port-marker${blueprint ? ' cable-route-port-marker--blueprint' : ''}${port.network ? ' cable-route-port-marker--network' : ''}${state ? ` cable-route-port-marker--wiring-${state}` : ''}`;
      return endpoint && <g key={port.id}>{port.network
        ? <rect className={className} style={{ fill, stroke: blueprint ? stroke : undefined, strokeWidth: blueprint ? BLUEPRINT_PORT_STROKE : undefined }} data-connection-point-id={port.id} x={endpoint.x - radius} y={endpoint.y - radius} width={radius * 2} height={radius * 2} rx={0} pointerEvents="none" />
        : <circle className={className} style={{ fill, stroke: blueprint ? stroke : undefined, strokeWidth: blueprint ? BLUEPRINT_PORT_STROKE : undefined }} data-connection-point-id={port.id} cx={endpoint.x} cy={endpoint.y} r={radius} pointerEvents="none" />}{bulkPortNumbers?.[port.id] && <text x={endpoint.x} y={endpoint.y - 8} textAnchor="middle" fontSize={8} fontWeight={700} fill="#ffca66" stroke="#172629" strokeWidth={1} paintOrder="stroke">{bulkPortNumbers[port.id]}</text>}</g>;
    })}
  </g>;
}

const cablePriority = (edge: LogicalFlowEdge) => edge.selected || edge.data?.cablePresentationEmphasis === 'selected' ? 2
    : edge.data?.cablePresentationEmphasis === 'attached' || edge.data?.cablePresentationEmphasis === 'traced' ? 1 : 0;

const virtualCablePriority = (edge: LogicalFlowEdge) =>
  2 * cablePriority(edge) + Number(edge.data?.cablePresentationEmphasis === 'traced');

export function ForegroundCableRoutes({ edges, virtualChannels, showAllVirtualChannels, physicalPortStates, bulkPortNumbers, bulkPairs, wiringRoute, onCableClick, onCableContextMenu }: { edges: readonly LogicalFlowEdge[]; virtualChannels?: boolean; showAllVirtualChannels?: boolean; physicalPortStates?: Record<string, ForegroundPortState>; bulkPortNumbers?: Record<string, number>; bulkPairs?: readonly { source: WiringPort; target: WiringPort }[]; wiringRoute?: WiringRouteDraft; onCableClick?: (event: MouseEvent<SVGPathElement>, edge: LogicalFlowEdge) => void; onCableContextMenu?: (event: MouseEvent<SVGElement>, edge: LogicalFlowEdge) => void }) {
  const nodes = useNodes<DeviceFlowNode>();
  const graphCache = useMemo(() => new WeakMap<BlueprintPresentation, {
    width: number;
    compositionWidth: number | undefined;
    graph: ReturnType<typeof objectVirtualChannels>;
  }>(), []);
  const channelObjects = useMemo(() => new Map(virtualChannels ? nodes.flatMap(node => {
    const presentation = node.data.projection?.attributes.blueprint_presentation;
    if (!presentation) return [];
    const width = node.width ?? node.measured?.width ?? 0;
    const compositionWidth = node.data.compositionDisplayWidth;
    let entry = graphCache.get(presentation);
    if (!entry || entry.width !== width || entry.compositionWidth !== compositionWidth) {
      entry = { width, compositionWidth, graph: objectVirtualChannels(presentation, compositionWidth, width) };
      graphCache.set(presentation, entry);
    }
    return [[node.id, { position: node.position, graph: entry.graph }] as const];
  }) : []), [nodes, virtualChannels, graphCache]);
  const cables = edges.filter((edge) => Boolean(edge.data?.cableNode));
  if (!cables.length && !wiringRoute && !physicalPortStates && !bulkPortNumbers && !bulkPairs && !(showAllVirtualChannels && channelObjects.size)) return null;
  const priority = virtualChannels ? virtualCablePriority : cablePriority;
  const ordered = cables.map((edge, index) => ({ edge, index })).sort((a, b) => priority(a.edge) - priority(b.edge) || a.index - b.index);
  type ChannelUsage = { cables: Map<string, LogicalFlowEdge>; preview?: boolean };
  const channelUsers = new Map<string, Map<VirtualChannelSegment, ChannelUsage>>();
  const allocate = (nodeId: string, pointId: string, register: (usage: ChannelUsage) => void): FloatingEndpoint | undefined => {
    const object = channelObjects.get(nodeId);
    const first = object?.graph.paths.get(pointId);
    if (!object || !first) return undefined;
    let usage = channelUsers.get(nodeId);
    if (!usage) channelUsers.set(nodeId, usage = new Map());
    for (let segment: VirtualChannelSegment | null = first; segment; segment = segment.next) {
      let users = usage.get(segment);
      if (!users) usage.set(segment, users = { cables: new Map() });
      register(users);
    }
    return { x: object.position.x + object.graph.exit.x, y: object.position.y + object.graph.exit.y, side: Position.Right };
  };
  const channelExits = new Map(virtualChannels ? ordered.flatMap(({ edge }) => {
    const pair = edge.data?.endpointPair;
    const cableId = edge.data?.cableNode && cableIdForNode(edge.data.cableNode);
    if (!pair || !cableId) return [];
    const register = (usage: ChannelUsage) => usage.cables.set(cableId, edge);
    return [[edge.id, {
      source: allocate(edge.source, pair.from_connection_point_id, register),
      target: allocate(edge.target, pair.to_connection_point_id, register),
    }] as const];
  }) : []);
  const previewEndpoint = ({ physicalObjectId, connectionPointId }: WiringPort) => {
    const node = nodes.find(node => node.data.projection && physicalObjectIdForNode(node.data.projection) === physicalObjectId);
    if (!node) return undefined;
    return allocate(node.id, connectionPointId, usage => { usage.preview = true; })
      ?? getRenderedConnectionPoint(node.data.projection, {
        ...node.position, compositionDisplayWidth: node.data.compositionDisplayWidth,
        width: node.measured?.width ?? node.width ?? LAYOUT_NODE_WIDTH,
        height: node.measured?.height ?? node.height ?? LAYOUT_NODE_HEIGHT,
      }, connectionPointId);
  };
  const wiringSource = wiringRoute && previewEndpoint(wiringRoute.source);
  const wiringTarget = wiringSource && wiringRoute?.target && previewEndpoint(wiringRoute.target);
  const bulkLines = bulkPairs?.flatMap((pair, index) => {
    const a = previewEndpoint(pair.source), b = previewEndpoint(pair.target);
    return a && b ? [<line key={index} data-testid="bulk-pair-preview" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffca66" strokeWidth={2} strokeDasharray="7 5" opacity={0.9} pointerEvents="none" />] : [];
  });
  return <ViewportPortal>
    <svg className="cable-routes-foreground" aria-hidden="true">
      {ordered.map(({ edge }) => <ForegroundCableRoute key={edge.id} edge={edge} channelExits={channelExits.get(edge.id)} onCableClick={onCableClick} onCableContextMenu={onCableContextMenu} />)}
      {[...channelObjects].map(([nodeId, { graph, position }]) => {
        const usage = channelUsers.get(nodeId);
        if (!usage && !showAllVirtualChannels) return null;
        return <g key={nodeId} transform={`translate(${position.x} ${position.y})`}>
          {(showAllVirtualChannels ? graph.segments : [...usage!.keys()]).map(segment => {
            const users = usage?.get(segment);
            let emphasis: LogicalFlowEdge | undefined;
            for (const user of users?.cables.values() ?? []) {
              if (!emphasis || priority(user) >= priority(emphasis)) emphasis = user;
            }
            const cable = users?.cables.size === 1 ? emphasis : undefined;
            const preview = users?.preview && (!emphasis || priority(emphasis) === 0);
            return <path key={`${segment.from.x},${segment.from.y}`}
              className={`object-virtual-channel ${preview ? 'wiring-route-preview' : `cable-route-foreground--${emphasis?.data?.cablePresentationEmphasis ?? 'free'}`}`}
              d={`M ${segment.from.x} ${segment.from.y} L ${segment.to.x} ${segment.to.y}`}
              fill="none" style={preview ? { stroke: '#8d7aff', strokeWidth: 3 } : emphasis?.style} pointerEvents={cable && (onCableClick || onCableContextMenu) ? 'stroke' : 'none'}
              onClick={cable && onCableClick ? event => { event.stopPropagation(); onCableClick(event, cable); } : undefined}
              onContextMenu={cable && onCableContextMenu ? event => { event.stopPropagation(); onCableContextMenu(event, cable); } : undefined} />;
          })}
        </g>;
      })}
      <ForegroundPortMarkers physicalPortStates={physicalPortStates} bulkPortNumbers={bulkPortNumbers} />
      {bulkLines}
      {wiringRoute && <g data-testid="foreground-wiring-route">
        {wiringSource && wiringTarget && <path className="wiring-route-preview" d={`M ${wiringSource.x} ${wiringSource.y} L ${wiringTarget.x} ${wiringTarget.y}`} fill="none" stroke="#8d7aff" strokeWidth={3} pointerEvents="none" />}
      </g>}
    </svg>
  </ViewportPortal>;
}
