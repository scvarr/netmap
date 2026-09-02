import type { MouseEvent } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { DeviceNodeData } from '../topology/layout';

type CompositeFlowNode = Node<DeviceNodeData, 'composite'>;

/** Presentation-only map grouping. It carries no topology identity or endpoints. */
export function CompositeNode({ data, selected }: NodeProps<CompositeFlowNode>) {
  const collapsed = Boolean(data.projection.attributes.collapsed);
  const name = data.projection.label;
  const onToggle = data.onCompositeToggle;
  const stop = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle?.();
  };
  return <div className={`map-composite-node${selected ? ' map-composite-node--selected' : ''}${collapsed ? ' map-composite-node--collapsed' : ' map-composite-node--expanded'}`} data-testid="map-composite-node">
    <div className="map-composite-node__header">
      <strong className="map-composite-node__legend">{name}</strong>
      <span className="map-composite-node__stereotype">«составной блок»</span>
      <button type="button" className="map-composite-node__toggle nodrag nopan" aria-label={`${collapsed ? 'Развернуть' : 'Свернуть'} составной блок «${name}»`} onClick={stop}>{collapsed ? '+' : '−'}</button>
    </div>
  </div>;
}
