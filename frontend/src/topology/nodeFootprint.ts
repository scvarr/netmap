import type { XYPosition } from '@xyflow/react';
import { LAYOUT_NODE_HEIGHT, LAYOUT_NODE_WIDTH, type DeviceFlowNode } from './layout';
import type { TopologyProjectionNode } from './types';

export interface FlowRectangle extends XYPosition {
  width: number;
  height: number;
}

export interface NodeFootprintDimensions {
  width: number;
  height: number;
}

// A small, shared flow-coordinate grid keeps nearest-free placement bounded
// without creating a second collision model beside final-drag validation.
export const PLACEMENT_SEARCH_STEP = 24;
export const MAX_PLACEMENT_SEARCH_RING = 32;

export const footprintDimensionsForProjectionNode = (
  node: TopologyProjectionNode,
): NodeFootprintDimensions => {
  const body = node.attributes.blueprint_presentation?.body;
  return {
    width: body?.width ?? LAYOUT_NODE_WIDTH,
    height: body?.height ?? LAYOUT_NODE_HEIGHT,
  };
};

export const projectionNodeFootprint = (
  node: TopologyProjectionNode,
  position: XYPosition,
): FlowRectangle => ({ ...position, ...footprintDimensionsForProjectionNode(node) });

export const nodeFootprint = (
  node: DeviceFlowNode,
  position: XYPosition = node.position,
): FlowRectangle => {
  const dimensions = footprintDimensionsForProjectionNode(node.data.projection);
  return {
    ...position,
    width: node.measured?.width ?? node.width ?? dimensions.width,
    height: node.measured?.height ?? node.height ?? dimensions.height,
  };
};

export const rectanglesOverlap = (left: FlowRectangle, right: FlowRectangle) =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

export const overlapsAnyNode = (candidate: DeviceFlowNode, nodes: Iterable<DeviceFlowNode>) => {
  const footprint = nodeFootprint(candidate);
  return [...nodes].some((node) =>
    node.id !== candidate.id && rectanglesOverlap(footprint, nodeFootprint(node)),
  );
};

const squareRingPositions = (anchor: XYPosition, ring: number): XYPosition[] => {
  const distance = ring * PLACEMENT_SEARCH_STEP;
  const positions: XYPosition[] = [];
  for (let offset = -ring; offset <= ring; offset += 1)
    positions.push({ x: anchor.x + offset * PLACEMENT_SEARCH_STEP, y: anchor.y - distance });
  for (let offset = -ring + 1; offset <= ring; offset += 1)
    positions.push({ x: anchor.x + distance, y: anchor.y + offset * PLACEMENT_SEARCH_STEP });
  for (let offset = ring - 1; offset >= -ring; offset -= 1)
    positions.push({ x: anchor.x + offset * PLACEMENT_SEARCH_STEP, y: anchor.y + distance });
  for (let offset = ring - 1; offset >= -ring + 1; offset -= 1)
    positions.push({ x: anchor.x - distance, y: anchor.y + offset * PLACEMENT_SEARCH_STEP });
  return positions;
};

export const nearestFreePosition = (
  requestedAnchor: XYPosition,
  candidate: NodeFootprintDimensions,
  occupied: Iterable<FlowRectangle>,
): XYPosition | null => {
  const obstacles = [...occupied];
  const isFree = (position: XYPosition) => !obstacles.some((rectangle) =>
    rectanglesOverlap({ ...position, ...candidate }, rectangle),
  );
  if (isFree(requestedAnchor)) return requestedAnchor;
  for (let ring = 1; ring <= MAX_PLACEMENT_SEARCH_RING; ring += 1) {
    const found = squareRingPositions(requestedAnchor, ring).find(isFree);
    if (found) return found;
  }
  return null;
};
