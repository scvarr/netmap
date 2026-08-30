import type { MapRegion, MapTextAnnotation } from '../topology/savedMapTypes';
import type { XYPosition } from '@xyflow/react';
import type { SegmentAssistResult } from '../topology/geometryAssist';
import type { PointerEvent } from 'react';

export interface MapReferenceOutline {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ephemeral authoring geometry; it is deliberately not a Saved Map Region. */
export interface MapRegionDraft {
  status: 'drawing' | 'editing';
  points: readonly XYPosition[];
  selectedVertexIndex?: number | null;
  previewPoint?: XYPosition;
  closingTarget?: boolean;
  assist?: SegmentAssistResult;
}

const points = (region: MapRegion) => region.points.map((point) => `${point.x},${point.y}`).join(' ');

const polygonCentroid = (region: MapRegion) => {
  let doubledArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < region.points.length; index += 1) {
    const point = region.points[index];
    const next = region.points[(index + 1) % region.points.length];
    const cross = point.x * next.y - next.x * point.y;
    doubledArea += cross;
    x += (point.x + next.x) * cross;
    y += (point.y + next.y) * cross;
  }
  if (Math.abs(doubledArea) > Number.EPSILON)
    return { x: x / (3 * doubledArea), y: y / (3 * doubledArea) };
  return region.points.reduce(
    (center, point) => ({ x: center.x + point.x / region.points.length, y: center.y + point.y / region.points.length }),
    { x: 0, y: 0 },
  );
};

const dashArray = (style: MapRegion['style']['stroke_style']) =>
  style === 'dashed' ? '10 6' : style === 'dotted' ? '2 5' : undefined;

/** Presentation-only Physical Saved Map layer; it never becomes React Flow topology. */
export function MapRegionLayer({
  regions,
  referenceOutlines,
  showReferenceOutlines,
  draft,
  selectedRegionId,
  hiddenRegionId,
  previewRegion,
  interactiveLabelRegionId,
  onLabelPointerDown,
  annotations = [],
  previewAnnotation,
  selectedAnnotationId,
  interactiveAnnotationId,
  onAnnotationPointerDown,
  onAnnotationClick,
}: {
  regions: readonly MapRegion[];
  referenceOutlines: readonly MapReferenceOutline[];
  showReferenceOutlines: boolean;
  draft?: MapRegionDraft;
  selectedRegionId?: string | null;
  /** The authoritative target stays passive but is suppressed behind its active local editor. */
  hiddenRegionId?: string | null;
  /** Local-only properties preview; it is never substituted into authoritative map state. */
  previewRegion?: MapRegion;
  interactiveLabelRegionId?: string | null;
  onLabelPointerDown?: (event: PointerEvent<SVGTextElement>) => void;
  annotations?: readonly MapTextAnnotation[];
  previewAnnotation?: MapTextAnnotation;
  selectedAnnotationId?: string | null;
  interactiveAnnotationId?: string | null;
  onAnnotationPointerDown?: (annotationId: string, event: PointerEvent<SVGTextElement>) => void;
  onAnnotationClick?: (annotationId: string) => void;
}) {
  const displayedRegions = previewRegion
    ? [...regions.filter((region) => region.region_ref.entity_id !== previewRegion.region_ref.entity_id), previewRegion]
    : regions;
  return (
    <svg className="map-region-layer" aria-hidden="true" data-testid="map-region-layer">
      <g className="map-region-layer__regions">
        {[...displayedRegions]
          .sort((left, right) => left.z_order - right.z_order || left.region_ref.entity_id.localeCompare(right.region_ref.entity_id))
          .filter((region) => region.region_ref.entity_id !== hiddenRegionId)
          .map((region) => {
            const label = region.label_position ?? polygonCentroid(region);
            return (
              <g key={region.region_ref.entity_id} className={selectedRegionId === region.region_ref.entity_id ? 'map-region-layer__region map-region-layer__region--selected' : 'map-region-layer__region'} data-testid={`map-region-${region.region_ref.entity_id}`} data-selected={selectedRegionId === region.region_ref.entity_id || undefined}>
                <polygon
                  points={points(region)}
                  fill={region.style.fill_color}
                  fillOpacity={region.style.fill_opacity}
                  stroke={region.style.stroke_color}
                  strokeWidth={region.style.stroke_width}
                  strokeDasharray={dashArray(region.style.stroke_style)}
                />
                <text className={interactiveLabelRegionId === region.region_ref.entity_id ? 'map-region-layer__label--interactive' : undefined} data-testid={`map-region-label-${region.region_ref.entity_id}`} x={label.x} y={label.y} fill={region.style.label_color ?? region.style.stroke_color} textAnchor="middle" dominantBaseline="central" onPointerDown={interactiveLabelRegionId === region.region_ref.entity_id ? onLabelPointerDown : undefined}>
                  {region.label}
                </text>
              </g>
            );
          })}
      </g>
      <g className="map-text-annotation-layer" data-testid="map-text-annotation-layer">
        {[...annotations.filter((annotation) => annotation.annotation_ref.entity_id !== previewAnnotation?.annotation_ref.entity_id), ...(previewAnnotation ? [previewAnnotation] : [])].map((annotation) => {
          const id = annotation.annotation_ref.entity_id;
          return <text key={id} data-testid={`map-text-annotation-${id}`} className={selectedAnnotationId === id ? 'map-text-annotation--selected' : undefined} x={annotation.position.x} y={annotation.position.y} fill={annotation.text_color} fontSize={annotation.font_size} dominantBaseline="hanging" onClick={(event) => { event.stopPropagation(); onAnnotationClick?.(id); }} onPointerDown={interactiveAnnotationId === id ? (event) => onAnnotationPointerDown?.(id, event) : undefined}>{annotation.text.split('\n').map((line, index) => <tspan key={index} x={annotation.position.x} dy={index === 0 ? 0 : '1.2em'}>{line}</tspan>)}</text>;
        })}
      </g>
      {draft?.status === 'drawing' && (
        <g className={`map-region-layer__draft map-region-layer__draft--${draft.status}`} data-testid="map-region-draft">
          {draft.points.length >= 3 && <polygon data-testid="map-region-draft-fill" points={draft.points.map((point) => `${point.x},${point.y}`).join(' ')} />}
          {draft.points.length >= 2 && <polyline data-testid="map-region-draft-segments" points={draft.points.map((point) => `${point.x},${point.y}`).join(' ')} />}
          {draft.status === 'drawing' && draft.previewPoint && draft.points.length > 0 && (
            <line data-testid="map-region-draft-preview" x1={draft.points.at(-1)!.x} y1={draft.points.at(-1)!.y} x2={draft.previewPoint.x} y2={draft.previewPoint.y} />
          )}
          {draft.status === 'drawing' && draft.previewPoint && draft.assist && draft.points.length > 0 && (() => {
            const start = draft.points.at(-1)!;
            const midpoint = { x: (start.x + draft.previewPoint.x) / 2, y: (start.y + draft.previewPoint.y) / 2 };
            return <g className={`map-region-layer__assist${draft.assist.snappedAngle || draft.assist.snappedLength ? ' map-region-layer__assist--snapped' : ''}`} data-testid="map-region-draft-assist-feedback" data-snapped-angle={draft.assist.snappedAngle || undefined} data-snapped-length={draft.assist.snappedLength || undefined} transform={`translate(${midpoint.x} ${midpoint.y - 10})`}>
              <text textAnchor="middle">{Math.round(draft.assist.angle)}° · {Math.round(draft.assist.length)}</text>
              {(draft.assist.snappedAngle || draft.assist.snappedLength) && <circle cx={0} cy={-13} r={2.5} />}
            </g>;
          })()}
          {draft.points.length >= 3 && <line data-testid="map-region-draft-close" x1={draft.points.at(-1)!.x} y1={draft.points.at(-1)!.y} x2={draft.points[0].x} y2={draft.points[0].y} />}
          {draft.points.map((point, index) => <circle key={index} data-testid={`map-region-draft-vertex-${index}`} data-closing-target={index === 0 && draft.closingTarget ? 'true' : undefined} cx={point.x} cy={point.y} r={index === 0 && draft.closingTarget ? 7 : 5} />)}
        </g>
      )}
      {showReferenceOutlines && (
        <g className="map-region-layer__reference-outlines" data-testid="map-reference-outlines">
          {referenceOutlines.map((outline) => (
            <rect key={outline.id} data-testid={`map-reference-outline-${outline.id}`} x={outline.x} y={outline.y} width={outline.width} height={outline.height} />
          ))}
        </g>
      )}
    </svg>
  );
}
