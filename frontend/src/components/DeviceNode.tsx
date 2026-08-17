import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import type { DeviceNodeData } from '../topology/layout';

type DeviceFlowNode = Node<DeviceNodeData, 'device'>;

export function DeviceNode({ data, selected }: NodeProps<DeviceFlowNode>) {
  const { projection } = data;
  return (
    <div className={`device-node${selected ? ' device-node--selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="device-node__handle" />
      <span className="device-node__kind">{projection.kind}</span>
      <strong>{projection.label}</strong>
      <span className="device-node__role">{String(projection.attributes.role ?? 'DEVICE')}</span>
      <span className="device-node__status"><i /> {projection.status ?? 'UNKNOWN'}</span>
      <Handle type="source" position={Position.Right} className="device-node__handle" />
    </div>
  );
}
