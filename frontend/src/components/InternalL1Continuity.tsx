import type { InternalL1Segment } from '../topology/internalL1Presentation';

interface InternalL1ContinuityProps {
  width: number;
  height: number;
  segments: InternalL1Segment[];
}

export function InternalL1Continuity({ width, height, segments }: InternalL1ContinuityProps) {
  if (segments.length === 0) return null;
  return (
    <svg
      className="internal-l1-continuity"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {segments.map((segment) => (
        <line
          key={segment.connectionMemberId}
          className={`internal-l1-continuity__line internal-l1-continuity__line--${segment.state}`}
          data-testid={`internal-l1-line-${segment.connectionMemberId}`}
          data-connection-member-id={segment.connectionMemberId}
          x1={segment.from.x}
          y1={segment.from.y}
          x2={segment.to.x}
          y2={segment.to.y}
        />
      ))}
    </svg>
  );
}
