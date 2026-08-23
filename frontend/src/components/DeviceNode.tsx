import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import type { DeviceNodeData } from '../topology/layout';
import { displayNodeLabel, physicalClassPresentation } from '../topology/presentation';

type DeviceFlowNode = Node<DeviceNodeData, 'device'>;

export function DeviceNode({ data, selected }: NodeProps<DeviceFlowNode>) {
  const { projection } = data;
  const physical = projection.kind === 'PHYSICAL_OBJECT';
  const classPresentation = physicalClassPresentation(projection.attributes.class);
  const blueprint = projection.attributes.blueprint_presentation;
  if (physical && blueprint) return <div className={`blueprint-map-node${selected ? ' blueprint-map-node--selected' : ''}${data.traceHighlighted ? ' blueprint-map-node--trace-highlighted' : ''}`} style={{ width: blueprint.body.width, height: blueprint.body.height, background: blueprint.body.fill_color ?? '#18383a' }}>
    <strong className="blueprint-map-node__label">{displayNodeLabel(projection)}</strong>
    {blueprint.slots.map((slot) => { const style = slot.anchor.side === 'LEFT' ? { left: 0, top: `${slot.anchor.offset * 100}%` } : slot.anchor.side === 'RIGHT' ? { right: 0, top: `${slot.anchor.offset * 100}%` } : slot.anchor.side === 'TOP' ? { left: `${slot.anchor.offset * 100}%`, top: 0 } : { left: `${slot.anchor.offset * 100}%`, bottom: 0 }; return <span key={slot.connection_point_id} className={`blueprint-map-node__port blueprint-map-node__port--${slot.kind.toLowerCase()}`} style={style} data-connection-point-id={slot.connection_point_id} title={`${slot.display_name} · ${slot.kind}`} />; })}
  </div>;
  return (
    <div className={`device-node${physical ? ` device-node--physical device-node--class-${classPresentation.accent}` : ''}${selected ? ' device-node--selected' : ''}${data.traceHighlighted ? ' device-node--trace-highlighted' : ''}`}>
      <Handle type="target" position={Position.Top} className="device-node__handle" />
      <span className="device-node__kind">
        {physical ? classPresentation.label : projection.kind}
      </span>
      <strong>{displayNodeLabel(projection)}</strong>
      <span className="device-node__role">
        {physical
          ? `CP: ${String(projection.attributes.connection_point_count ?? '—')} · NI: ${String(projection.attributes.owned_interface_count ?? '—')}`
          : String(projection.attributes.role ?? 'DEVICE')}
      </span>
      <span className="device-node__status"><i /> {projection.status ?? 'UNKNOWN'}</span>
      <Handle type="source" position={Position.Top} className="device-node__handle" />
    </div>
  );
}
