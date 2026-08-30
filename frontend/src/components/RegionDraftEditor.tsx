import type { PointerEvent } from 'react';
import type { XYPosition } from '@xyflow/react';

export type RegionDraftPointerTarget = { kind: 'vertex'; index: number } | { kind: 'midpoint'; index: number } | { kind: 'polygon' };

const polygonPoints = (points: readonly XYPosition[]) => points.map((point) => `${point.x},${point.y}`).join(' ');

/** Interactive overlay for the one local, unsaved Region draft only. */
export function RegionDraftEditor({ points, selectedVertexIndex, invalid, onPointerDown }: {
  points: readonly XYPosition[];
  selectedVertexIndex: number | null;
  invalid: boolean;
  onPointerDown: (target: RegionDraftPointerTarget, event: PointerEvent<SVGElement>) => void;
}) {
  return (
    <svg className="region-draft-editor" data-testid="region-draft-editor">
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
    </svg>
  );
}
