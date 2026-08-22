import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import type { DeviceNodeData } from '../topology/layout';
import { displayNodeLabel } from '../topology/presentation';

type DeviceFlowNode = Node<DeviceNodeData, 'device'>;

export function DeviceNode({ data, selected }: NodeProps<DeviceFlowNode>) {
  const { projection } = data;
  const physical = projection.kind === 'PHYSICAL_OBJECT';
  return (
    <div className={`device-node${physical ? ' device-node--physical' : ''}${selected ? ' device-node--selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="device-node__handle" />
      <span className="device-node__kind">{projection.kind}</span>
      <strong>{displayNodeLabel(projection)}</strong>
      <span className="device-node__role">
        {physical
          ? `CP: ${String(projection.attributes.connection_point_count ?? '—')} · NI: ${String(projection.attributes.owned_interface_count ?? '—')}`
          : String(projection.attributes.role ?? 'DEVICE')}
      </span>
      <span className="device-node__status"><i /> {projection.status ?? 'UNKNOWN'}</span>
      <Handle type="source" position={Position.Right} className="device-node__handle" />
    </div>
  );
}
