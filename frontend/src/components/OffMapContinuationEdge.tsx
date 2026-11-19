import {
  BaseEdge,
  Position,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';
import type { DeviceFlowNode, LogicalFlowEdge } from '../topology/layout';
import { absoluteNodeRectangle, getConnectionPointEndpoint, hiddenFaceEndpoint } from './FloatingTopologyEdge';

const vectorFor = (side: Position): { x: number; y: number } => (
  side === Position.Left ? { x: -1, y: 0 }
    : side === Position.Top ? { x: 0, y: -1 }
      : side === Position.Bottom ? { x: 0, y: 1 }
        : { x: 1, y: 0 }
);

export function OffMapContinuationEdge({ id, source, data, selected }: EdgeProps<LogicalFlowEdge>) {
  const sourceNode = useInternalNode<DeviceFlowNode>(source);
  const continuation = data?.continuation;
  if (!sourceNode || !continuation) return null;
  const box = absoluteNodeRectangle(sourceNode);
  const endpoint = sourceNode.data.locationProxy ? {
    x: box.x + box.width,
    y: box.y + box.height / 2,
    side: Position.Right,
  } : hiddenFaceEndpoint(sourceNode, box, continuation.local_connection_point_ref.entity_id) ?? getConnectionPointEndpoint(
    sourceNode.data.projection,
    box,
    continuation.local_connection_point_ref.entity_id,
    sourceNode.data.facePresentation?.visibleBlueprint,
  );
  if (!endpoint) return null;
  const vector = vectorFor(endpoint.side);
  const markerX = endpoint.x + vector.x * 34;
  const markerY = endpoint.y + vector.y * 34;
  const labelX = markerX + (vector.x < 0 ? -7 : 7);
  const labelY = markerY + (vector.y < 0 ? -7 : 13);
  return (
    <g className="off-map-continuation" aria-label={`Продолжение вне карты: ${continuation.remote_display_name}`}>
      <BaseEdge id={id} path={`M ${endpoint.x},${endpoint.y} L ${markerX},${markerY}`} style={{ stroke: selected ? '#54e3b4' : '#d7a960', strokeWidth: selected ? 3 : 2, strokeDasharray: '5 3' }} interactionWidth={18} />
      <circle cx={markerX} cy={markerY} r={7} fill="#0d1b1e" stroke={selected ? '#54e3b4' : '#d7a960'} strokeWidth={2} />
      <path d={`M ${markerX - 2},${markerY} L ${markerX + 2},${markerY}`} stroke={selected ? '#54e3b4' : '#d7a960'} strokeWidth={2} />
      <text x={labelX} y={labelY} fill={selected ? '#dff7ef' : '#d7a960'} fontSize="10" fontWeight="700" textAnchor={vector.x < 0 ? 'end' : 'start'}>вне карты</text>
    </g>
  );
}
