import type { PointerEvent } from 'react';
import type { MapTextAnnotation } from '../topology/savedMapTypes';

export function MapTextAnnotationLayer({ annotations, previewAnnotation, selectedAnnotationId, interactiveAnnotationId, onAnnotationPointerDown, onAnnotationClick }: {
  annotations: readonly MapTextAnnotation[];
  previewAnnotation?: MapTextAnnotation;
  selectedAnnotationId?: string | null;
  interactiveAnnotationId?: string | null;
  onAnnotationPointerDown?: (annotationId: string, event: PointerEvent<SVGTextElement>) => void;
  onAnnotationClick?: (annotationId: string) => void;
}) {
  return <svg className="map-text-annotation-layer" aria-hidden="true" data-testid="map-text-annotation-layer">
    {[...annotations.filter((annotation) => annotation.annotation_ref.entity_id !== previewAnnotation?.annotation_ref.entity_id), ...(previewAnnotation ? [previewAnnotation] : [])].map((annotation) => {
      const id = annotation.annotation_ref.entity_id;
      return <text key={id} data-testid={`map-text-annotation-${id}`} className={selectedAnnotationId === id ? 'map-text-annotation--selected' : undefined} x={annotation.position.x} y={annotation.position.y} fill={annotation.text_color} fontSize={annotation.font_size} dominantBaseline="hanging" onClick={(event) => { event.stopPropagation(); onAnnotationClick?.(id); }} onPointerDown={interactiveAnnotationId === id ? (event) => onAnnotationPointerDown?.(id, event) : undefined}>{annotation.text.split('\n').map((line, index) => <tspan key={index} x={annotation.position.x} dy={index === 0 ? 0 : '1.2em'}>{line}</tspan>)}</text>;
    })}
  </svg>;
}
