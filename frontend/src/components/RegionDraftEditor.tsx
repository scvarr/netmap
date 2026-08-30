import type { PointerEvent } from 'react';
import type { XYPosition } from '@xyflow/react';

export type RegionDraftPointerTarget = { kind: 'vertex'; index: number } | { kind: 'midpoint'; index: number } | { kind: 'polygon' };
export interface RegionDraftSegmentFeedback {
  start: XYPosition;
  end: XYPosition;
  snappedAngle: boolean;
  snappedLength: boolean;
}

const polygonPoints = (points: readonly XYPosition[]) => points.map((point) => `${point.x},${point.y}`).join(' ');

/** Interactive overlay for the one local, unsaved Region draft only. */
export function RegionDraftEditor({ points, selectedVertexIndex, invalid, interactive, feedback = [], onPointerDown }: {
  points: readonly XYPosition[];
  selectedVertexIndex: number | null;
  invalid: boolean;
  interactive: boolean;
  feedback?: readonly RegionDraftSegmentFeedback[];
  onPointerDown: (target: RegionDraftPointerTarget, event: PointerEvent<SVGElement>) => void;
}) {
  return (
    <svg className={interactive ? 'region-draft-editor region-draft-editor--interactive' : 'region-draft-editor'} data-testid="region-draft-editor">
      <g className={`region-draft-editor__polygon${invalid ? ' region-draft-editor__polygon--invalid' : ''}`}>
        <polygon points={polygonPoints(points)} onPointerDown={(event) => onPointerDown({ kind: 'polygon' }, event)} />
        <polyline points={`${polygonPoints(points)} ${points[0]?.x},${points[0]?.y}`} />
      </g>
      {points.map((point, index) => {
        const next = points[(index + 1) % points.length];
        const midpoint = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
        return <circle key={`midpoint-${index}`} className="region-draft-editor__midpoint" data-testid={`region-draft-midpoint-${index}`} cx={midpoint.x} cy={midpoint.y} r={5} onPointerDown={(event) => onPointerDown({ kind: 'midpoint', index }, event)} />;
      })}
      {points.map((point, index) => <circle key={`vertex-${index}`} className={selectedVertexIndex === index ? 'region-draft-editor__vertex region-draft-editor__vertex--selected' : 'region-draft-editor__vertex'} data-testid={`region-draft-editor-vertex-${index}`} cx={point.x} cy={point.y} r={6} onPointerDown={(event) => onPointerDown({ kind: 'vertex', index }, event)} />)}
      {feedback.map((segment, index) => {
        const midpoint = { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 };
        const angle = Math.round((Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x) * 180 / Math.PI + 360) % 360);
        const length = Math.round(Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y));
        return <g key={`feedback-${index}`} className={`region-draft-editor__feedback${segment.snappedAngle || segment.snappedLength ? ' region-draft-editor__feedback--snapped' : ''}`} data-testid={`region-draft-assist-feedback-${index}`} data-snapped-angle={segment.snappedAngle || undefined} data-snapped-length={segment.snappedLength || undefined} transform={`translate(${midpoint.x} ${midpoint.y - 10})`}>
          <text textAnchor="middle">{angle}° · {length}</text>
          {(segment.snappedAngle || segment.snappedLength) && <circle cx={0} cy={-13} r={2.5} />}
        </g>;
      })}
    </svg>
  );
}
