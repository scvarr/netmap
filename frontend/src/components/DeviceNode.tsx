import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import type { DeviceNodeData } from '../topology/layout';
import { displayNodeLabel, physicalClassPresentation } from '../topology/presentation';
import { genericConnectionPoints, genericEndpointOffset } from '../topology/genericEndpointPresentation';
import { internalL1Segments } from '../topology/internalL1Presentation';
import { InternalL1Continuity } from './InternalL1Continuity';

type DeviceFlowNode = Node<DeviceNodeData, 'device'>;

export function DeviceNode({ data, selected }: NodeProps<DeviceFlowNode>) {
  const { projection } = data;
  const physical = projection.kind === 'PHYSICAL_OBJECT';
  const classPresentation = physicalClassPresentation(projection.attributes.class);
  const blueprint = projection.attributes.blueprint_presentation;
  const internalSegments = internalL1Segments(
    projection,
    selected,
    data.traceHighlightedConnectionMemberIds,
  );
  const traceHighlightedConnectionPointIds = new Set(
    internalSegments
      .filter((segment) => segment.state === 'trace-highlighted')
      .flatMap((segment) => [segment.fromConnectionPointId, segment.toConnectionPointId]),
  );
  if (physical && blueprint) return <div className={`blueprint-map-node${selected ? ' blueprint-map-node--selected' : ''}${data.traceHighlighted ? ' blueprint-map-node--trace-highlighted' : ''}`} style={{ width: blueprint.body.width, height: blueprint.body.height, background: blueprint.body.fill_color ?? '#18383a' }}>
    <Handle type="target" position={Position.Top} className="device-node__handle" />
    <InternalL1Continuity width={blueprint.body.width} height={blueprint.body.height} segments={internalSegments} />
    <strong className="blueprint-map-node__label">{displayNodeLabel(projection)}</strong>
    {blueprint.slots.map((slot) => { const style = slot.anchor.side === 'LEFT' ? { left: 0, top: `${slot.anchor.offset * 100}%`, transform: 'translate(-50%, -50%)' } : slot.anchor.side === 'RIGHT' ? { right: 0, top: `${slot.anchor.offset * 100}%`, transform: 'translate(50%, -50%)' } : slot.anchor.side === 'TOP' ? { left: `${slot.anchor.offset * 100}%`, top: 0, transform: 'translate(-50%, -50%)' } : { left: `${slot.anchor.offset * 100}%`, bottom: 0, transform: 'translate(-50%, 50%)' }; return <span key={slot.connection_point_id} className={`blueprint-map-node__port blueprint-map-node__port--${slot.kind.toLowerCase()}${traceHighlightedConnectionPointIds.has(slot.connection_point_id) ? ' blueprint-map-node__port--trace-highlighted' : ''}`} style={style} data-connection-point-id={slot.connection_point_id} title={`${slot.display_name} · ${slot.kind}`} />; })}
    <Handle type="source" position={Position.Top} className="device-node__handle" />
  </div>;
  const genericPoints = physical ? genericConnectionPoints(projection) : [];
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
      {genericPoints.map((point, index) => {
        const offset = genericEndpointOffset(index, genericPoints.length);
        return <span key={point.connection_point_id} className="generic-map-node__endpoint" style={{ top: `${offset * 100}%` }} title={`${point.display_name} · внешних подключений: ${point.external_connection_count}`} data-connection-point-id={point.connection_point_id}>
          <Handle id={point.connection_point_id} type="source" position={Position.Right} className="generic-map-node__handle" />
          {genericPoints.length <= 8 && <small>{point.display_name}</small>}
        </span>;
      })}
      <Handle type="source" position={Position.Top} className="device-node__handle" />
    </div>
  );
}
