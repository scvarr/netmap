import type { InternalL1Segment } from '../topology/internalL1Presentation';
import { opticalHighlightColors, type OpticalHighlight } from '../topology/interfacePhysicalTraceOverlay';

interface InternalL1ContinuityProps {
  width: number;
  height: number;
  segments: InternalL1Segment[];
  opticalHighlights?: ReadonlyMap<string, OpticalHighlight>;
}

const geometryKey = ({ from, to }: InternalL1Segment) =>
  [`${from.x},${from.y}`, `${to.x},${to.y}`].sort().join('/');

export function InternalL1Continuity({ width, height, segments, opticalHighlights }: InternalL1ContinuityProps) {
  if (segments.length === 0) return null;
  const counts = new Map<string, number>();
  for (const segment of segments) {
    const key = geometryKey(segment);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return (
    <svg
      className="internal-l1-continuity"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {segments.map(segment => {
        const highlight = counts.get(geometryKey(segment)) === 1 && opticalHighlights?.get(segment.connectionMemberId);
        return <line
          key={segment.connectionMemberId}
          className={`internal-l1-continuity__line internal-l1-continuity__line--${segment.state}`}
          data-testid={`internal-l1-line-${segment.connectionMemberId}`}
          data-connection-member-id={segment.connectionMemberId}
          style={highlight ? { stroke: opticalHighlightColors[highlight], opacity: 1 } : undefined}
          x1={segment.from.x}
          y1={segment.from.y}
          x2={segment.to.x}
          y2={segment.to.y}
        />;
      })}
    </svg>
  );
}
