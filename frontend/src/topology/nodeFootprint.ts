import type { XYPosition } from '@xyflow/react';
import { LAYOUT_NODE_HEIGHT, LAYOUT_NODE_WIDTH, type DeviceFlowNode } from './layout';

export interface FlowRectangle extends XYPosition {
  width: number;
  height: number;
}

export const nodeFootprint = (
  node: DeviceFlowNode,
  position: XYPosition = node.position,
): FlowRectangle => {
  const body = node.data.projection.attributes.blueprint_presentation?.body;
  return {
    ...position,
    width: node.measured?.width ?? node.width ?? body?.width ?? LAYOUT_NODE_WIDTH,
    height: node.measured?.height ?? node.height ?? body?.height ?? LAYOUT_NODE_HEIGHT,
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
