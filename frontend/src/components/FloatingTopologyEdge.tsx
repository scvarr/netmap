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
  type XYPosition,
} from '@xyflow/react';
import { useEffect, useId, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import {
  type DeviceFlowNode,
  type LogicalFlowEdge,
} from '../topology/layout';
import { genericConnectionPoints, genericEndpointOffset } from '../topology/genericEndpointPresentation';
import { BLUEPRINT_PORT_HIT_SIZE, BLUEPRINT_PORT_SIZE, BLUEPRINT_PORT_STROKE, OBJECT_NAME_ZONE_WIDTH, blueprintNodeDisplayDimensions } from '../topology/blueprintDisplaySize';
import { cableIdForNode, physicalObjectIdForNode } from '../topology/projection';
import { objectVirtualChannels, type ObjectVirtualChannels, type VirtualChannelSegment } from '../topology/objectVirtualChannels';
import { buildHierarchicalCableChannels, hierarchicalLocationPath, type LocationChannelInput } from '../topology/hierarchicalCableRoutes';
import { LocationChannelLayer, locationSegmentKey } from './LocationChannelLayer';
import { physicalPortPaint, tracedPortIds } from '../topology/physicalPortPresentation';
import { useI18n } from '../i18n';
import { displayNodeLabelForLocale } from '../topology/presentation';
import { CableRouteInteraction, cableHitClip, type CablePortBounds, type CableTarget } from './CableRouteInteraction';
import { nodeFootprint } from '../topology/nodeFootprint';
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

export const absoluteNodeRectangle = (node: InternalNode<DeviceFlowNode>): NodeRectangle => ({
  ...nodeFootprint(node, node.internals.positionAbsolute),
  compositionDisplayWidth: node.data.compositionDisplayWidth,
});

export const getConnectionPointEndpoint = (
  projection: DeviceFlowNode['data']['projection'],
  box: NodeRectangle,
  connectionPointId: string | undefined,
  presentation = projection.attributes.blueprint_presentation,
): FloatingEndpoint | null => {
  if (!connectionPointId) return null;
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
  presentation = projection.attributes.blueprint_presentation,
): FloatingEndpoint | null => {
  if (!connectionPointId) return null;
  const slot = presentation?.slots.find((item) => item.connection_point_id === connectionPointId);
  if (!slot || !presentation) return getConnectionPointEndpoint(projection, box, connectionPointId, presentation);
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

export function hiddenFaceEndpoint(node: DeviceFlowNode, box: NodeRectangle, pointId?: string): FloatingEndpoint | null {
  if (!pointId || !node.data.facePresentation?.hiddenPorts.has(pointId)) return null;
  return { x: box.x + box.width, y: box.y + box.height / 2, side: Position.Right };
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
  const exact = (node: InternalNode<DeviceFlowNode>, connectionPointId: string | undefined): FloatingEndpoint | null => node.data.locationProxy ? null : hiddenFaceEndpoint(node, absoluteNodeRectangle(node), connectionPointId) ?? (data?.cableNode
    ? getRenderedConnectionPoint(node.data.projection, absoluteNodeRectangle(node), connectionPointId, node.data.facePresentation?.visibleBlueprint)
    : getConnectionPointEndpoint(node.data.projection, absoluteNodeRectangle(node), connectionPointId, node.data.facePresentation?.visibleBlueprint));
  const floating = getFloatingEndpoints(absoluteNodeRectangle(sourceNode), absoluteNodeRectangle(targetNode));
  const endpoints = { source: exact(sourceNode, pair?.from_connection_point_id) ?? floating.source, target: exact(targetNode, pair?.to_connection_point_id) ?? floating.target };
  const [straightPath] = getStraightPath({
    sourceX: endpoints.source.x,
    sourceY: endpoints.source.y,
    targetX: endpoints.target.x,
    targetY: endpoints.target.y,
  });
  return <BaseEdge id={id} path={straightPath} style={style} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={data?.cableNode ? Number(style?.strokeWidth) || 2 : interactionWidth} />;
}

export type ForegroundPortState = 'eligible' | 'source' | 'destination' | 'unavailable';

type EndpointEmphasis = 'hovered' | 'selected';
interface ForegroundPortMarkersProps {
  physicalPortStates?: Record<string, ForegroundPortState>;
  bulkPortNumbers?: Record<string, number>;
  endpointEmphasis: ReadonlyMap<string, EndpointEmphasis>;
  zoom: number;
}

function ForegroundPortMarkers(props: ForegroundPortMarkersProps) {
  const nodes = useNodes<DeviceFlowNode>();
  return <>{nodes.map(node => <ForegroundNodePortMarkers key={node.id} nodeId={node.id} {...props} />)}</>;
}

function ForegroundNodePortMarkers({ nodeId, physicalPortStates, bulkPortNumbers, endpointEmphasis, zoom }: ForegroundPortMarkersProps & { nodeId: string }) {
  const portTypes = useRuntimePortTypes();
  const maskId = useId();
  const node = useInternalNode<DeviceFlowNode>(nodeId);
  // A collapsed Location proxy is a presentation anchor, never a PhysicalObject with ports.
  if (!node || node.data.locationProxy || !node.data.projection || node.data.projection.kind !== 'PHYSICAL_OBJECT') return null;
  const projection = node.data.projection;
  const blueprint = projection.attributes.blueprint_presentation;
  const tracedPorts = tracedPortIds(projection, node.data.traceHighlightedConnectionMemberIds);
  const ports = blueprint
    ? (node.data.facePresentation?.visibleBlueprint ?? blueprint).slots.map((slot) => ({ id: slot.connection_point_id, network: slot.kind === 'NETWORK_PORT', portTypeId: slot.port_type_id }))
    : genericConnectionPoints(projection).map((point) => ({ id: point.connection_point_id, network: false, portTypeId: undefined }));
  const box = absoluteNodeRectangle(node);
  const portStroke = blueprint ? BLUEPRINT_PORT_STROKE : 1.25;
  const radius = blueprint ? (BLUEPRINT_PORT_SIZE - portStroke) / 2 : 3.5;
  const visiblePorts = ports.flatMap(port => {
    const endpoint = getRenderedConnectionPoint(projection, box, port.id, node.data.facePresentation?.visibleBlueprint);
    return endpoint ? [{ ...port, endpoint }] : [];
  });
  // React Flow scales the viewport via CSS. Convert screen pixels before painting.
  const unit = 1 / zoom;
  const haloRadius = radius + portStroke / 2 + unit;
  const haloBounds = haloRadius + 4 * unit;
  const exclusionRadius = radius + portStroke / 2 + .5 * unit;
  return <g className="cable-route-port-markers" aria-hidden="true" pointerEvents="none">
    {visiblePorts.map((port, index) => {
      const { endpoint } = port;
      const state = physicalPortStates?.[port.id];
      const { fill, outline } = physicalPortPaint(portTypes?.find(type => type.id === port.portTypeId)?.color,
        node.data.cableOccupiedPortIds?.has(port.id) ?? false, tracedPorts.has(port.id), state);
      const className = `cable-route-port-marker${blueprint ? ' cable-route-port-marker--blueprint' : ''}${port.network ? ' cable-route-port-marker--network' : ''}${state ? ` cable-route-port-marker--wiring-${state}` : ''}`;
      const style = { fill, stroke: outline, strokeWidth: blueprint ? BLUEPRINT_PORT_STROKE : undefined };
      const emphasis = state === 'source' || state === 'destination' ? undefined : endpointEmphasis.get(port.id);
      const neighbours = emphasis ? visiblePorts.filter(other => other !== port &&
        Math.abs(other.endpoint.x - endpoint.x) < haloBounds + exclusionRadius &&
        Math.abs(other.endpoint.y - endpoint.y) < haloBounds + exclusionRadius) : [];
      const cutoutId = neighbours.length ? `${maskId}-${index}` : undefined;
      const halo = {
        'data-cable-endpoint': port.id, 'data-emphasis': emphasis, className: 'cable-endpoint-halo',
        fill: 'none', strokeWidth: 2 * unit, opacity: state === 'unavailable' ? .35 : undefined,
      };
      return <g key={port.id}>
        {cutoutId && <mask id={cutoutId} maskUnits="userSpaceOnUse"
          x={endpoint.x - haloBounds} y={endpoint.y - haloBounds} width={2 * haloBounds} height={2 * haloBounds}>
          <rect x={endpoint.x - haloBounds} y={endpoint.y - haloBounds} width={2 * haloBounds} height={2 * haloBounds} fill="white" />
          {neighbours.map(other => <rect key={other.id} x={other.endpoint.x - exclusionRadius} y={other.endpoint.y - exclusionRadius}
            width={2 * exclusionRadius} height={2 * exclusionRadius} fill="black" />)}
        </mask>}
        {emphasis && <g mask={cutoutId ? `url(#${cutoutId})` : undefined}>
          {port.network
            ? <rect {...halo} x={endpoint.x - haloRadius} y={endpoint.y - haloRadius} width={2 * haloRadius} height={2 * haloRadius} />
            : <circle {...halo} cx={endpoint.x} cy={endpoint.y} r={haloRadius} />}
        </g>}
        {port.network
          ? <rect className={className} style={style} data-connection-point-id={port.id} x={endpoint.x - radius} y={endpoint.y - radius} width={radius * 2} height={radius * 2} rx={0} pointerEvents="none" />
          : <circle className={className} style={style} data-connection-point-id={port.id} cx={endpoint.x} cy={endpoint.y} r={radius} pointerEvents="none" />}
        {bulkPortNumbers?.[port.id] && <text x={endpoint.x} y={endpoint.y - 8} textAnchor="middle" fontSize={8} fontWeight={700} fill="#ffca66" stroke="#172629" strokeWidth={1} paintOrder="stroke">{bulkPortNumbers[port.id]}</text>}
      </g>;
    })}
  </g>;
}

const cablePriority = (edge: LogicalFlowEdge) => edge.selected || edge.data?.cablePresentationEmphasis === 'selected' ? 2
    : edge.data?.cablePresentationEmphasis === 'attached' || edge.data?.cablePresentationEmphasis === 'traced' ? 1 : 0;

const virtualCablePriority = (edge: LogicalFlowEdge) =>
  2 * cablePriority(edge) + Number(edge.data?.cablePresentationEmphasis === 'traced');

const flowRectangle = (node: DeviceFlowNode): NodeRectangle => ({
  ...nodeFootprint(node),
  compositionDisplayWidth: node.data.compositionDisplayWidth,
});

const cableEmphasis = (edge?: LogicalFlowEdge) => edge
  ? edge.data?.cablePresentationEmphasis ?? (edge.selected ? 'selected' : 'normal')
  : 'free';

interface RouteSegment extends CableTarget {
  cables: Map<string, LogicalFlowEdge>;
  preview?: boolean;
  bulk?: boolean;
}

// Generic ports already sit on the right edge. Share their on-edge leads to
// the Location terminal without changing the displayed endpoint positions.
function genericChannelPaths(node: DeviceFlowNode): ObjectVirtualChannels {
  const box = flowRectangle(node);
  const exit = { x: box.width, y: box.height / 2 };
  const ports = genericConnectionPoints(node.data.projection);
  const segments: VirtualChannelSegment[] = [];
  const paths = new Map<string, VirtualChannelSegment>();
  for (const upper of [true, false]) {
    let to = exit;
    let next: VirtualChannelSegment | null = null;
    const indices = ports.map((_, index) => index).filter(index => (genericEndpointOffset(index, ports.length) < .5) === upper);
    if (upper) indices.reverse();
    for (const index of indices) {
      const from = { x: exit.x, y: box.height * genericEndpointOffset(index, ports.length) };
      next = { from, to, next };
      segments.push(next);
      paths.set(ports[index].connection_point_id, next);
      to = from;
    }
  }
  return { exit, paths, segments };
}

export function ForegroundCableRoutes({ edges, virtualChannels, locationInputs, zoom = 1, showChannelTerminals = true, showAllVirtualChannels, physicalPortStates, bulkPortNumbers, bulkPairs, wiringRoute, traceActive, onCableSelect, onCableContextMenu }: {
  edges: readonly LogicalFlowEdge[];
  virtualChannels?: boolean;
  locationInputs?: readonly LocationChannelInput[];
  zoom?: number;
  showChannelTerminals?: boolean;
  showAllVirtualChannels?: boolean;
  physicalPortStates?: Record<string, ForegroundPortState>;
  bulkPortNumbers?: Record<string, number>;
  bulkPairs?: readonly { source: WiringPort; target: WiringPort }[];
  wiringRoute?: WiringRouteDraft;
  traceActive?: boolean;
  onCableSelect?: (edge: LogicalFlowEdge) => void;
  onCableContextMenu?: (event: MouseEvent<SVGElement>, edge: LogicalFlowEdge) => void;
}) {
  const nodes = useNodes<DeviceFlowNode>();
  const { locale, t } = useI18n();
  const [hoveredCable, setHoveredCable] = useState<string | null>(null);
  const interactive = !physicalPortStates && !bulkPortNumbers && !bulkPairs && !wiringRoute && Boolean(onCableSelect || onCableContextMenu);
  useEffect(() => { if (!interactive) setHoveredCable(null); }, [interactive]);
  const activeHover = interactive && !traceActive ? hoveredCable : null;
  const endpointEmphasis = useMemo(() => {
    const result = new Map<string, EndpointEmphasis>();
    for (const edge of edges) {
      const { cableNode, endpointPair, continuation } = edge.data ?? {};
      const selected = cableEmphasis(edge) === 'selected';
      if (selected && continuation) {
        result.set(continuation.local_connection_point_ref.entity_id, 'selected');
      }
      if (!cableNode || !endpointPair) continue;
      const cableId = cableIdForNode(cableNode);
      if (!cableId || (!selected && activeHover !== cableId)) continue;
      for (const portId of [endpointPair.from_connection_point_id, endpointPair.to_connection_point_id]) {
        if (result.get(portId) !== 'selected') result.set(portId, selected ? 'selected' : 'hovered');
      }
    }
    return result;
  }, [edges, activeHover]);
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const locationSnapshot = locationInputs && JSON.stringify(locationInputs);
  const locationChannels = useMemo(() => locationSnapshot === undefined ? undefined
    : buildHierarchicalCableChannels(JSON.parse(locationSnapshot) as LocationChannelInput[]), [locationSnapshot]);
  const ports = useMemo(() => interactive ? nodes.flatMap(node => {
    const projection = node.data.projection;
    if (!projection || projection.kind !== 'PHYSICAL_OBJECT') return [];
    const box = flowRectangle(node);
    const blueprint = node.data.facePresentation?.visibleBlueprint ?? projection.attributes.blueprint_presentation;
    if (blueprint) {
      const body = blueprintNodeDisplayDimensions(blueprint, box.compositionDisplayWidth);
      return blueprint.slots.map(slot => ({
        x: box.x + OBJECT_NAME_ZONE_WIDTH + body.width * slot.rendered_position.x,
        y: box.y + body.height * slot.rendered_position.y,
        radius: BLUEPRINT_PORT_HIT_SIZE / 2,
      }));
    }
    const points = genericConnectionPoints(projection);
    return points.map((_, index): CablePortBounds => ({
      x: box.x + box.width, y: box.y + genericEndpointOffset(index, points.length) * box.height, radius: 5,
    }));
  }) : [], [nodes, interactive]);
  const graphCache = useMemo(() => new WeakMap<BlueprintPresentation, {
    width: number;
    compositionWidth: number | undefined;
    graph: ReturnType<typeof objectVirtualChannels>;
  }>(), []);
  const channelObjects = useMemo(() => new Map(virtualChannels ? nodes.flatMap(node => {
    const presentation = node.data.facePresentation?.visibleBlueprint ?? node.data.projection?.attributes.blueprint_presentation;
    if (!presentation) return locationChannels && node.data.projection?.kind === 'PHYSICAL_OBJECT'
      ? [[node.id, { position: node.position, graph: genericChannelPaths(node) }] as const] : [];
    const width = nodeFootprint(node).width;
    const compositionWidth = node.data.compositionDisplayWidth;
    let entry = graphCache.get(presentation);
    if (!entry || entry.width !== width || entry.compositionWidth !== compositionWidth) {
      entry = { width, compositionWidth, graph: objectVirtualChannels(presentation, compositionWidth, width) };
      graphCache.set(presentation, entry);
    }
    return [[node.id, { position: node.position, graph: entry.graph }] as const];
  }) : []), [nodes, virtualChannels, graphCache, locationChannels]);
  const { channels, connectors, locationSegments, occupiedOutlets, failures, bulkLines, wiringSource, wiringTarget } = useMemo(() => {

    const priority = virtualChannels ? virtualCablePriority : cablePriority;
    const ordered = edges.flatMap((edge) => {
      const cableId = edge.data?.cableNode && cableIdForNode(edge.data.cableNode);
      return cableId ? [{ edge, cableId }] : [];
    }).sort((a, b) => priority(a.edge) - priority(b.edge));
    type ChannelUsage = { cables: Map<string, LogicalFlowEdge>; preview?: boolean; bulk?: boolean };
    const channelUsers = new Map<string, Map<VirtualChannelSegment, ChannelUsage>>();
    const registerObject = (nodeId: string, segment: VirtualChannelSegment, register: (usage: ChannelUsage) => void) => {
      let usage = channelUsers.get(nodeId);
      if (!usage) channelUsers.set(nodeId, usage = new Map());
      let users = usage.get(segment);
      if (!users) usage.set(segment, users = { cables: new Map() });
      register(users);
    };
    const allocate = (nodeId: string, pointId: string, register: (usage: ChannelUsage) => void): FloatingEndpoint | undefined => {
      const object = channelObjects.get(nodeId);
      const first = object?.graph.paths.get(pointId);
      if (!object) return undefined;
      if (!first) {
        const node = nodeById.get(nodeId);
        return node ? hiddenFaceEndpoint(node, flowRectangle(node), pointId) ?? undefined : undefined;
      }
      for (let segment: VirtualChannelSegment | null = first; segment; segment = segment.next) {
        registerObject(nodeId, segment, register);
      }
      return { x: object.position.x + object.graph.exit.x, y: object.position.y + object.graph.exit.y, side: Position.Right };
    };
    const locationSegments = new Map<string, RouteSegment>();
    const occupiedOutlets = new Map<string, XYPosition>();
    const failures: { id: string; reason: string }[] = [];
    const objectNodes = new Map(nodes.flatMap(node => {
      const id = node.data.projection && physicalObjectIdForNode(node.data.projection);
      return id ? [[id, node] as const] : [];
    }));
    const route = (source: DeviceFlowNode | undefined, a: string | undefined, target: DeviceFlowNode | undefined,
      b: string | undefined, register: (usage: ChannelUsage) => void, id: string) => {
      if (!locationChannels) return;
      const anchor = (node: DeviceFlowNode) => {
        const proxy = node.data.locationProxy;
        if (proxy) {
          const terminalId = 'Boundary:' + (proxy.boundaryPointId ?? proxy.locationId);
          return proxy.partial ? { locationId: proxy.locationId, terminalId } : locationChannels.terminals.get(terminalId);
        }
        return locationChannels.terminals.get('PhysicalObject:' + physicalObjectIdForNode(node.data.projection));
      };
      const from = source && anchor(source), to = target && anchor(target);
      const first = source && a ? channelObjects.get(source.id)?.graph.paths.get(a) : undefined;
      const last = target && b ? channelObjects.get(target.id)?.graph.paths.get(b) : undefined;
      const sourceHidden = Boolean(a && source?.data.facePresentation?.hiddenPorts.has(a));
      const targetHidden = Boolean(b && target?.data.facePresentation?.hiddenPorts.has(b));
      if (!source || !target || (!first && !sourceHidden && !source.data.locationProxy)
        || (!last && !targetHidden && !target.data.locationProxy) || !from || !to) {
        failures.push({ id, reason: 'missing-terminal' });
        return;
      }
      const path = hierarchicalLocationPath(locationChannels, from, to);
      if (!path.segments) {
        const leg = path.failure;
        const diagnostics = locationChannels.locations.get(leg.locationId)?.graph.diagnostics ?? [];
        failures.push({ id, reason: JSON.stringify({ ...leg, diagnostics }) });
        return;
      }
      const localPath = (segment: VirtualChannelSegment | undefined) => {
        const result: VirtualChannelSegment[] = [];
        for (let current = segment ?? null; current; current = current.next) result.push(current);
        return result;
      };
      const start = localPath(first), end = localPath(last);
      if (source.id === target.id) {
        while (start.length && end.length && start.at(-1) === end.at(-1)) {
          start.pop();
          end.pop();
        }
      }
      // Both hidden ends on one object share its boundary. Give the cable
      // a selectable mark along the edge even when the path has zero length.
      if (source.id === target.id && sourceHidden && targetHidden) {
        const point = hiddenFaceEndpoint(source, flowRectangle(source), a)!;
        const key = 'face-boundary:' + source.id;
        let segment = locationSegments.get(key);
        if (!segment) locationSegments.set(key, segment = {
          key, from: point, to: { x: point.x, y: point.y - 6 }, cables: new Map(),
        });
        register(segment);
      }
      for (const segment of start) registerObject(source.id, segment, register);
      for (const ref of path.segments) {
        const key = locationSegmentKey(ref.locationId, ref.segment);
        let segment = locationSegments.get(key);
        if (!segment) {
          const graph = locationChannels.locations.get(ref.locationId)!.graph;
          const { from, to } = graph.segments[ref.segment];
          locationSegments.set(key, segment = { key, from: graph.nodes[from], to: graph.nodes[to], cables: new Map() });
        }
        register(segment);
      }
      for (const segment of end.reverse()) registerObject(target.id, segment, register);
      if (source.id !== target.id) {
        for (const [node, terminal] of [[source, from], [target, to]] as const) {
          const graph = locationChannels.locations.get(terminal.locationId)!.graph;
          if (node.data.locationProxy) continue;
          occupiedOutlets.set(terminal.terminalId, graph.nodes[graph.terminals.get(terminal.terminalId)!]);
        }
      }
    };
    const channelExits = new Map(virtualChannels && !locationChannels ? ordered.flatMap(({ edge, cableId }) => {
      const pair = edge.data?.endpointPair;
      if (!pair) return [];
      const register = (usage: ChannelUsage) => usage.cables.set(cableId, edge);
      return [[edge.id, {
        source: allocate(edge.source, pair.from_connection_point_id, register),
        target: allocate(edge.target, pair.to_connection_point_id, register),
      }] as const];
    }) : []);
    const previewEndpoint = ({ physicalObjectId, connectionPointId }: WiringPort) => {
      const node = objectNodes.get(physicalObjectId);
      if (!node) return undefined;
      return allocate(node.id, connectionPointId, usage => { usage.preview = true; })
        ?? getRenderedConnectionPoint(node.data.projection, flowRectangle(node), connectionPointId, node.data.facePresentation?.visibleBlueprint);
    };
    const previewPair = (source: WiringPort, target: WiringPort, bulk: boolean) => route(
      objectNodes.get(source.physicalObjectId), source.connectionPointId,
      objectNodes.get(target.physicalObjectId), target.connectionPointId,
      usage => { if (bulk) usage.bulk = true; else usage.preview = true; }, t('map.cableRoute.preview'),
    );
    if (locationChannels && wiringRoute?.target) previewPair(wiringRoute.source, wiringRoute.target, false);
    const wiringSource = wiringRoute && (!locationChannels || !wiringRoute.target) && previewEndpoint(wiringRoute.source);
    const wiringTarget = wiringSource && wiringRoute?.target && previewEndpoint(wiringRoute.target);
    const bulkLines = bulkPairs?.flatMap((pair, index) => {
      if (locationChannels) {
        previewPair(pair.source, pair.target, true);
        return [];
      }
      const a = previewEndpoint(pair.source), b = previewEndpoint(pair.target);
      return a && b ? [<line key={index} data-testid="bulk-pair-preview" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffca66" strokeWidth={2} strokeDasharray="7 5" opacity={0.9} pointerEvents="none" />] : [];
    });
    const connectors = new Map<string, RouteSegment>();
    for (const { edge, cableId } of ordered) {
      const source = nodeById.get(edge.source), target = nodeById.get(edge.target);
      const pair = edge.data?.endpointPair;
      if (locationChannels) {
        route(source, pair?.from_connection_point_id, target, pair?.to_connection_point_id,
          usage => usage.cables.set(cableId, edge), cableId);
        continue;
      }
      if (!source || !target) continue;
      const sourceBox = flowRectangle(source), targetBox = flowRectangle(target);
      const floating = getFloatingEndpoints(sourceBox, targetBox);
      const exits = channelExits.get(edge.id);
      const exact = (node: DeviceFlowNode, box: NodeRectangle, pointId?: string) => node.data.locationProxy
        ? null : hiddenFaceEndpoint(node, box, pointId) ?? getRenderedConnectionPoint(node.data.projection, box, pointId, node.data.facePresentation?.visibleBlueprint);
      const from = exits?.source ?? exact(source, sourceBox, pair?.from_connection_point_id) ?? floating.source;
      const to = exits?.target ?? exact(target, targetBox, pair?.to_connection_point_id) ?? floating.target;
      const key = [`${from.x},${from.y}`, `${to.x},${to.y}`].sort().join('/');
      let segment = connectors.get(key);
      if (!segment) connectors.set(key, segment = { key: `connector:${key}`, from, to, cables: new Map() });
      segment.cables.set(cableId, edge);
    }

    const channels = [...channelObjects].flatMap(([nodeId, { graph, position }]) => {
      const usage = channelUsers.get(nodeId);
      if (!usage && !showAllVirtualChannels) return [];
      const translate = (point: XYPosition) => ({ x: point.x + position.x, y: point.y + position.y });
      const segments = showAllVirtualChannels ? graph.segments : [...usage!.keys()];
      // Adjacent parallel leads can be closer than the screen-space hit width.
      // End each hit area at the midpoint so every lead keeps its centreline.
      const leadColumns = [...new Set(segments.flatMap(({ from, to }) =>
        from.x === to.x ? [from.x] : [],
      ))].sort((a, b) => a - b);
      const leadWidths = new Map(leadColumns.map((x, i) => [x, Math.min(
        x - (leadColumns[i - 1] ?? -Infinity), (leadColumns[i + 1] ?? Infinity) - x,
      )]));
      const indices = new Map(graph.segments.map((segment, index) => [segment, index]));
      return segments.map(segment => ({
        key: JSON.stringify([nodeId, indices.get(segment)]),
        from: translate(segment.from), to: translate(segment.to),
        maxHitWidth: segment.from.x === segment.to.x ? leadWidths.get(segment.from.x) : undefined,
        cables: usage?.get(segment)?.cables ?? new Map<string, LogicalFlowEdge>(),
        preview: usage?.get(segment)?.preview,
        bulk: usage?.get(segment)?.bulk,
      }));
    });
    return { channels, connectors, locationSegments, occupiedOutlets, failures, bulkLines, wiringSource, wiringTarget };
  }, [edges, virtualChannels, showAllVirtualChannels, channelObjects, wiringRoute, bulkPairs, nodes, nodeById, locationChannels, t]);

  const priority = virtualChannels ? virtualCablePriority : cablePriority;
  const emphasisFor = (segment: RouteSegment) => {
    let edge: LogicalFlowEdge | undefined;
    for (const user of segment.cables.values()) {
      if (!edge || priority(user) >= priority(edge)) edge = user;
    }
    return edge;
  };
  const connectorSegments = [...connectors.values()];
  const hovered = (segment: RouteSegment) => activeHover !== null && segment.cables.has(activeHover);
  const visiblePath = (segment: RouteSegment, channel: boolean) => {
    const edge = emphasisFor(segment);
    const emphasis = cableEmphasis(edge);
    const preview = segment.preview && (!edge || priority(edge) === 0);
    const bulk = segment.bulk && !edge && !preview;
    const hover = hovered(segment) && emphasis !== 'selected' && emphasis !== 'traced';
    return <path key={segment.key} d={`M ${segment.from.x} ${segment.from.y} L ${segment.to.x} ${segment.to.y}`} fill="none"
      className={`${channel ? 'object-virtual-channel' : 'cable-route-foreground'} ${preview ? 'wiring-route-preview' : bulk ? 'wiring-bulk-preview' : `cable-route-foreground--${emphasis}`}${hover ? ' cable-route-foreground--hovered' : ''}`}
      data-route-segment={segment.key} data-cable-ids={JSON.stringify([...segment.cables.keys()].sort())}
      data-preview={segment.preview || undefined} data-testid={segment.bulk ? 'bulk-pair-preview' : undefined}
      pointerEvents="none" />;
  };

  // Local leads win hit testing where their endpoints meet the wider shared routes.
  const targets = useMemo(() => interactive ? [...connectors.values(), ...locationSegments.values(), ...channels].filter(segment =>
    segment.cables.size && (segment.from.x !== segment.to.x || segment.from.y !== segment.to.y))
    .sort((a, b) => b.cables.size - a.cables.size) : [], [interactive, connectors, locationSegments, channels]);
  const boundaries = useMemo(() => {
    const points = new Map<string, XYPosition>();
    for (const { input, graph } of locationChannels?.locations.values() ?? []) {
      const ids = input.members.filter(member => member.kind === 'location').map(member => member.id);
      if (input.boundary) ids.push(input.boundary.id);
      for (const id of ids) points.set(id, graph.nodes[graph.terminals.get(id)!]);
    }
    return [...points];
  }, [locationChannels]);
  const boundaryScale = Math.min(1, 1 / zoom);
  const clip = useMemo(() => targets.length ? cableHitClip(targets, [
    ...ports,
    ...boundaries.map(([, point]) => ({ ...point, radius: 7 * boundaryScale })),
  ]) : '', [targets, ports, boundaries, boundaryScale]);
  const terminalPoints = useMemo(() => new Set([...locationSegments.values()].flatMap(({ from, to }) =>
    [`${from.x},${from.y}`, `${to.x},${to.y}`])), [locationSegments]);
  const labelFor = useMemo(() => {
    const labels = new Map<LogicalFlowEdge, { name: string; endpoints: string }>();
    return (edge: LogicalFlowEdge) => {
      const cached = labels.get(edge);
      if (cached) return cached;
      const pair = edge.data?.endpointPair;
      const endpoint = (nodeId: string, pointId: string | undefined) => {
        const projection = nodeById.get(nodeId)?.data.projection;
        if (!projection || !pointId) return '';
        const point = projection.attributes.blueprint_presentation?.slots.find(slot => slot.connection_point_id === pointId)
          ?? projection.attributes.connection_points?.find(candidate => candidate.connection_point_id === pointId);
        return point ? `${displayNodeLabelForLocale(projection, locale)} / ${point.display_name}` : '';
      };
      const label = {
        name: edge.data!.cableNode!.label,
        endpoints: [endpoint(edge.source, pair?.from_connection_point_id), endpoint(edge.target, pair?.to_connection_point_id)].filter(Boolean).join(' → '),
      };
      labels.set(edge, label);
      return label;
    };
  }, [nodeById, locale, edges]);
  if (!locationChannels && !connectors.size && !channels.length && !wiringRoute && !physicalPortStates && !bulkPortNumbers && !bulkPairs && !endpointEmphasis.size) return null;

  const markers = new Map<string, RouteSegment>();
  const visibleSegments = [...connectorSegments, ...locationSegments.values(), ...channels];
  for (const segment of visibleSegments) {
    for (const [id, edge] of segment.cables) {
      if (cableEmphasis(edge) !== 'selected') continue;
      const current = markers.get(id);
      if (!current || (current.cables.size > 1 && segment.cables.size === 1)) markers.set(id, segment);
    }
  }

  const paintPriority = (segment: RouteSegment) => {
    const edge = emphasisFor(segment);
    const emphasis = cableEmphasis(edge);
    return emphasis === 'selected' ? 4 : emphasis === 'traced' ? 3 : hovered(segment) ? 2 : edge || segment.preview || segment.bulk ? 1 : 0;
  };
  return <>
    {locationChannels && showAllVirtualChannels && <LocationChannelLayer channels={locationChannels}
      used={locationSegments} occupiedOutlets={occupiedOutlets} zoom={zoom} showTerminals={showChannelTerminals} />}
    {failures.length > 0 && <details className="map-cable-route-diagnostics">
      <summary>{t('map.cableRoute.unavailable', { count: failures.length })}</summary>
      <ul>{failures.map(({ id, reason }, index) => <li key={index}>{id} · {reason}</li>)}</ul>
    </details>}
    <ViewportPortal>
    <svg className="cable-routes-foreground" style={{ '--location-channel-unit': `${1 / zoom}px` } as CSSProperties}>
      {visibleSegments.sort((a, b) => paintPriority(a) - paintPriority(b)).map(segment => {
        if (!segment.key.startsWith('connector:')) return visiblePath(segment, !locationSegments.has(segment.key));
        const edge = emphasisFor(segment)!;
        return <g key={segment.key} data-testid={`foreground-cable-${edge.id}`} data-emphasis={cableEmphasis(edge)}>{visiblePath(segment, false)}</g>;
      })}
      {showChannelTerminals && [...occupiedOutlets].map(([id, point]) => <circle key={id} className="location-channel-outlet" cx={point.x} cy={point.y} />)}
      {showChannelTerminals && boundaries.map(([id, { x, y }]) => terminalPoints.has(`${x},${y}`) &&
        <circle key={id} cx={x} cy={y} r={6 * boundaryScale} fill="var(--location-terminal-fill)" aria-hidden="true" />)}
      {(interactive || markers.size > 0) && <CableRouteInteraction targets={targets}
        clip={clip}
        selectedMarkers={[...new Set(markers.values())]} labelFor={labelFor} onHover={setHoveredCable}
        onSelect={onCableSelect} onContextMenu={onCableContextMenu} />}
      <ForegroundPortMarkers physicalPortStates={physicalPortStates} bulkPortNumbers={bulkPortNumbers} endpointEmphasis={endpointEmphasis} zoom={zoom} />
      {bulkLines}
      {wiringRoute && <g data-testid="foreground-wiring-route">
        {wiringSource && wiringTarget && <path className="wiring-route-preview" d={`M ${wiringSource.x} ${wiringSource.y} L ${wiringTarget.x} ${wiringTarget.y}`} fill="none" pointerEvents="none" />}
      </g>}
    </svg>
    </ViewportPortal>
  </>;
}
