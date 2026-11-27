import type { InternalL1Segment } from '../topology/internalL1Presentation';
import { opticalHighlightColors, opticalHighlightPriority, type OpticalHighlight } from '../topology/interfacePhysicalTraceOverlay';

interface InternalL1ContinuityProps {
  width: number;
  height: number;
  segments: InternalL1Segment[];
  opticalHighlights?: ReadonlyMap<string, OpticalHighlight>;
}

export function InternalL1Continuity({ width, height, segments, opticalHighlights }: InternalL1ContinuityProps) {
  if (segments.length === 0) return null;
  const opticalSegments = segments.flatMap(segment => {
    const highlight = opticalHighlights?.get(segment.connectionMemberId);
    return highlight ? [{ segment, highlight }] : [];
  }).sort((a, b) => opticalHighlightPriority[a.highlight] - opticalHighlightPriority[b.highlight]);
  return (
    <svg
      className="internal-l1-continuity"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {segments.map(segment => <line
          key={segment.connectionMemberId}
          className={`internal-l1-continuity__line internal-l1-continuity__line--${segment.state}`}
          data-testid={`internal-l1-line-${segment.connectionMemberId}`}
          data-connection-member-id={segment.connectionMemberId}
          x1={segment.from.x}
          y1={segment.from.y}
          x2={segment.to.x}
          y2={segment.to.y}
      />)}
      {opticalSegments.map(({ segment, highlight }) => <line key={segment.connectionMemberId}
        className="optical-trace-line" data-optical-member={segment.connectionMemberId}
        x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y}
        stroke={opticalHighlightColors[highlight]} />)}
    </svg>
  );
}
