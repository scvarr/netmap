import { memo, type CSSProperties } from 'react';
import { ViewportPortal } from '@xyflow/react';
import { buildLocationChannelGraph, type LocationChannelBoundary, type LocationChannelMember } from '../topology/locationVirtualChannels';

export interface LocationChannelInput {
  locationId: string | null;
  boundary: LocationChannelBoundary | null;
  members: (LocationChannelMember & { kind: 'generic-object' | 'blueprint-object' | 'location' })[];
}

function ChannelOutlets({ inputs, kind }: {
  inputs: LocationChannelInput[];
  kind: 'generic-object' | 'blueprint-object';
}) {
  return inputs.flatMap(({ members }) => members.filter(member => member.kind === kind).map(({ id, point }) =>
    <circle key={id} className="location-channel-outlet" cx={point.x} cy={point.y} />,
  ));
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
    <ChannelOutlets inputs={inputs} kind="generic-object" />
  </svg>;
  // The canvas rebuilds its presentation arrays on selection and viewport events.
  // Compare the geometry snapshot before repeating the routing work.
}, (previous, next) => JSON.stringify(previous.inputs) === JSON.stringify(next.inputs));

export function LocationChannelLayer({ inputs, visible, zoom }: { inputs: LocationChannelInput[]; visible: boolean; zoom: number }) {
  return <ViewportPortal>
    <div hidden={!visible} style={{ '--location-channel-unit': `${1 / zoom}px` } as CSSProperties}>
      <ChannelGeometry inputs={inputs} />
      <svg className="location-channel-layer location-channel-layer--outlets" aria-hidden="true">
        <ChannelOutlets inputs={inputs} kind="blueprint-object" />
      </svg>
    </div>
  </ViewportPortal>;
}
