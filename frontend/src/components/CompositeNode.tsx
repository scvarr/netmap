import type { Node, NodeProps } from '@xyflow/react';
import type { DeviceNodeData } from '../topology/layout';

type CompositeFlowNode = Node<DeviceNodeData, 'composite'>;

/** Presentation-only map grouping. It carries no topology identity or endpoints. */
export function CompositeNode({ data, selected }: NodeProps<CompositeFlowNode>) {
  return <div className={`map-composite-node${selected ? ' map-composite-node--selected' : ''}`} data-testid="map-composite-node">
    <span>Составной блок</span>
    <strong>{data.projection.label}</strong>
  </div>;
}
