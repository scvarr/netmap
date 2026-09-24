import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DeviceFlowNode } from '../topology/layout';

/** A derived presentation target. It has no canonical topology identity. */
export function LocationProxyNode({ data }: NodeProps<DeviceFlowNode>) {
  const proxy = data.locationProxy;
  if (!proxy) return null;
  return <div className={`location-proxy${proxy.traced ? ' location-proxy--traced' : ''}`} data-location-id={proxy.locationId} title={`${proxy.label} — скрыто объектов: ${proxy.hiddenObjectCount}`}>
    <Handle type="target" position={Position.Left} className="location-proxy__handle" />
    <span className="location-proxy__label">{proxy.label}</span>
    {proxy.onExpand && proxy.onConfigure && <span className="location-proxy__actions"><button className="location-action nodrag" type="button" aria-label={proxy.expandLabel} title={proxy.expandLabel} onClick={proxy.onExpand}>+</button><button className="location-action nodrag" type="button" aria-label={proxy.configureLabel} title={proxy.configureLabel} onClick={proxy.onConfigure}>⚙</button></span>}
    <Handle type="source" position={Position.Right} className="location-proxy__handle" />
  </div>;
}
