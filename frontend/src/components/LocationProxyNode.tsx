import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DeviceFlowNode } from '../topology/layout';

/** A derived presentation target. It has no canonical topology identity. */
export function LocationProxyNode({ data }: NodeProps<DeviceFlowNode>) {
  const proxy = data.locationProxy;
  if (!proxy) return null;
  return <div className={`location-proxy${proxy.traced ? ' location-proxy--traced' : ''}`} data-location-id={proxy.locationId}>
    <Handle type="target" position={Position.Left} className="location-proxy__handle" />
    <span>{proxy.label}</span><small>{proxy.hiddenObjectCount}</small>
    <Handle type="source" position={Position.Right} className="location-proxy__handle" />
  </div>;
}
