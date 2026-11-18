import { memo } from 'react';
import { ViewportPortal } from '@xyflow/react';
import { buildLocationChannelGraph, type LocationChannelBoundary, type LocationChannelMember } from '../topology/locationVirtualChannels';

export interface LocationChannelInput {
  locationId: string | null;
  boundary: LocationChannelBoundary | null;
  members: LocationChannelMember[];
}

const ChannelGeometry = memo(function ChannelGeometry({ inputs }: { inputs: LocationChannelInput[] }) {
  return <svg className="location-channel-layer" aria-hidden="true">
    {inputs.map(({ locationId, boundary, members }) => {
      const graph = buildLocationChannelGraph(boundary, members);
      const path = graph.segments.map(({ from, to }) => {
        const a = graph.nodes[from], b = graph.nodes[to];
        return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
      }).join(' ');
      return <g key={locationId ?? 'root'} data-channel-location={locationId ?? ''}>
        {graph.diagnostics.length > 0 && <desc>{JSON.stringify(graph.diagnostics)}</desc>}
        {path && <path d={path} />}
      </g>;
    })}
  </svg>;
  // The canvas rebuilds its presentation arrays on selection and viewport events.
  // Compare the geometry snapshot before repeating the routing work.
}, (previous, next) => JSON.stringify(previous.inputs) === JSON.stringify(next.inputs));

export function LocationChannelLayer({ inputs, visible }: { inputs: LocationChannelInput[]; visible: boolean }) {
  return <ViewportPortal><div hidden={!visible}><ChannelGeometry inputs={inputs} /></div></ViewportPortal>;
}
