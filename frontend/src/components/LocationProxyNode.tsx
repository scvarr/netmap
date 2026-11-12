import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DeviceFlowNode } from '../topology/layout';

/** A derived presentation target. It has no canonical topology identity. */
export function LocationProxyNode({ data }: NodeProps<DeviceFlowNode>) {
  const proxy = data.locationProxy;
  if (!proxy) return null;
  if (proxy.partial) return <div className="location-proxy-anchor" aria-hidden="true"><Handle type="target" position={Position.Left} /><Handle type="source" position={Position.Right} /></div>;
  const edge = proxy.boundaryEdge ?? 'right', offset = proxy.boundaryOffset ?? .5;
  return <div className={`location-proxy${proxy.traced ? ' location-proxy--traced' : ''}`} data-location-id={proxy.locationId} title={`${proxy.label} — скрыто объектов: ${proxy.hiddenObjectCount}`}>
    <Handle type="target" position={Position.Left} className="location-proxy__handle" />
    <span className="location-proxy__label">{proxy.label}</span>
    {(proxy.onExpand || proxy.onConfigure) && <span className="location-proxy__actions">{proxy.onExpand && <button className="location-action nodrag" type="button" aria-label={proxy.expandLabel} title={proxy.expandLabel} onClick={proxy.onExpand}>+</button>}{proxy.onConfigure && <button className="location-action nodrag" type="button" aria-label={proxy.configureLabel} title={proxy.configureLabel} onClick={proxy.onConfigure}>⚙</button>}</span>}
    <span className="location-boundary-point location-boundary-point--compact" data-boundary-point-id={proxy.boundaryPointId} style={{ left: edge === 'left' ? '0%' : edge === 'right' ? '100%' : (offset * 100) + '%', top: edge === 'top' ? '0%' : edge === 'bottom' ? '100%' : (offset * 100) + '%' }} />
    <Handle type="source" position={Position.Right} className="location-proxy__handle" />
  </div>;
}
