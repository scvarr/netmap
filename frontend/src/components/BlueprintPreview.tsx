import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { BlueprintBody, BlueprintInternalLink, BlueprintSlot } from '../topology/objectBlueprintTypes';
import { useI18n } from '../i18n';
import { blueprintThumbnailGeometry } from '../topology/blueprintThumbnailGeometry';

interface BlueprintPreviewProps { body: BlueprintBody; slots: BlueprintSlot[]; internalLinks?: BlueprintInternalLink[]; label?: string; style?: CSSProperties; viewportWidth?: number; viewportHeight?: number; }
const pointFor = (slot: BlueprintSlot, body: BlueprintBody) => {
  const offset = slot.anchor.offset;
  if (slot.anchor.side === 'LEFT') return { x: 0, y: offset * body.height };
  if (slot.anchor.side === 'RIGHT') return { x: body.width, y: offset * body.height };
  if (slot.anchor.side === 'TOP') return { x: offset * body.width, y: 0 };
  return { x: offset * body.width, y: body.height };
};

/** Non-interactive, intrinsic-aspect library thumbnail. */
export function BlueprintPreview({ body, slots, internalLinks = [], label, style, viewportWidth = 120, viewportHeight = 120 }: BlueprintPreviewProps) {
  const { t } = useI18n();
  const geometry = blueprintThumbnailGeometry(body, slots, { width: viewportWidth, height: viewportHeight });
  return <div className="blueprint-thumbnail" style={{ width: viewportWidth, height: viewportHeight, ...style }} data-testid="blueprint-thumbnail" data-preview-width={geometry.width} data-preview-height={geometry.height}>
    <svg className="blueprint-preview" style={{ width: geometry.width, height: geometry.height }} viewBox={`0 0 ${geometry.intrinsicWidth} ${geometry.intrinsicHeight}`} role="img" aria-label={label ?? t('blueprint.editor.preview')} preserveAspectRatio="xMidYMid meet" data-ratio={geometry.intrinsicWidth / geometry.intrinsicHeight}>
      {geometry.faces.map((face, faceIndex) => {
        const faceSlots = slots.filter((slot) => (slot.face ?? 'FRONT') === face);
        const points = new Map(faceSlots.map((slot) => [slot.key, pointFor(slot, body)]));
        return <g key={face} transform={`translate(0 ${faceIndex * body.height})`} data-testid={`blueprint-thumbnail-face-${face}`}>
          <rect className="blueprint-preview__body" x="0" y="0" width={body.width} height={body.height} rx={Math.min(body.width, body.height) * .04} fill={body.fill_color || '#18383a'} />
          {internalLinks.map((link) => { const from = points.get(link.from_slot_key); const to = points.get(link.to_slot_key); return from && to ? <line key={`${link.from_slot_key}-${link.to_slot_key}`} className="blueprint-preview__link" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null; })}
          {faceSlots.map((slot) => { const point = pointFor(slot, body); return <g key={slot.key} data-slot-key={slot.key} data-anchor-side={slot.anchor.side}><circle className={`blueprint-preview__port blueprint-preview__port--${slot.kind.toLowerCase()}`} cx={point.x} cy={point.y} r={Math.max(body.width, body.height) * .018} /><title>{slot.display_name}</title></g>; })}
        </g>;
      })}
    </svg>
  </div>;
}

interface BlueprintPreviewViewportProps extends Omit<BlueprintPreviewProps, 'style' | 'viewportWidth' | 'viewportHeight'> { scale: number; }

export function BlueprintPreviewViewport({ body, scale, ...preview }: BlueprintPreviewViewportProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => setBounds({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  const viewportWidth = Math.max(1, (bounds.width - 32) * scale);
  const viewportHeight = Math.max(1, (bounds.height - 32) * scale);
  return <div ref={ref} className="blueprint-preview-viewport" data-preview-scale={scale}>
    <BlueprintPreview {...preview} body={body} viewportWidth={viewportWidth} viewportHeight={viewportHeight} />
  </div>;
}
