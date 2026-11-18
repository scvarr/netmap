import type { CSSProperties } from 'react';
import { ViewportPortal, type XYPosition } from '@xyflow/react';
import type { HierarchicalCableChannels } from '../topology/hierarchicalCableRoutes';

export function LocationChannelLayer({ channels, used, occupiedOutlets, zoom }: {
  channels: HierarchicalCableChannels;
  used: ReadonlyMap<string, unknown>;
  occupiedOutlets: ReadonlyMap<string, XYPosition>;
  zoom: number;
}) {
  return <ViewportPortal>
    <div style={{ '--location-channel-unit': `${1 / zoom}px` } as CSSProperties}>
      <svg className="location-channel-layer" aria-hidden="true">
        {[...channels.locations].map(([locationId, { graph }]) => {
          const path = graph.segments.flatMap(({ from, to }, index) => {
            if (used.has(locationSegmentKey(locationId, index))) return [];
            const a = graph.nodes[from], b = graph.nodes[to];
            return [`M ${a.x} ${a.y} L ${b.x} ${b.y}`];
          }).join(' ');
          return <g key={locationId ?? 'root'} data-channel-location={locationId ?? ''}>
            {graph.diagnostics.length > 0 && <desc>{JSON.stringify(graph.diagnostics)}</desc>}
            {path && <path d={path} />}
          </g>;
        })}
        <ChannelOutlets channels={channels} kind="generic-object" occupiedOutlets={occupiedOutlets} />
      </svg>
      <svg className="location-channel-layer location-channel-layer--outlets" aria-hidden="true">
        <ChannelOutlets channels={channels} kind="blueprint-object" occupiedOutlets={occupiedOutlets} />
      </svg>
    </div>
  </ViewportPortal>;
}

export const locationSegmentKey = (id: string | null, index: number) => JSON.stringify(['location', id, index]);

function ChannelOutlets({ channels, kind, occupiedOutlets }: {
  channels: HierarchicalCableChannels;
  kind: 'generic-object' | 'blueprint-object';
  occupiedOutlets: ReadonlyMap<string, XYPosition>;
}) {
  return [...channels.locations.values()].flatMap(({ input }) =>
    input.members.filter(member => member.kind === kind && !occupiedOutlets.has(member.id)).map(({ id, point }) =>
      <circle key={id} className="location-channel-outlet" cx={point.x} cy={point.y} />,
    ),
  );
}
