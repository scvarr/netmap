import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { BlueprintBody, BlueprintInternalLink, BlueprintSlot } from '../topology/objectBlueprintTypes';
import { useI18n } from '../i18n';

interface BlueprintPreviewProps { body: BlueprintBody; slots: BlueprintSlot[]; internalLinks?: BlueprintInternalLink[]; label?: string; style?: CSSProperties; }
const pointFor = (slot: BlueprintSlot, body: BlueprintBody) => {
  const offset = slot.anchor.offset;
  if (slot.anchor.side === 'LEFT') return { x: 0, y: offset * body.height };
  if (slot.anchor.side === 'RIGHT') return { x: body.width, y: offset * body.height };
  if (slot.anchor.side === 'TOP') return { x: offset * body.width, y: 0 };
  return { x: offset * body.width, y: body.height };
};

export function BlueprintPreview({ body, slots, internalLinks = [], label, style }: BlueprintPreviewProps) {
  const { t } = useI18n();
  const [face, setFace] = useState<'FRONT' | 'REAR'>('FRONT');
  const visibleSlots = slots.filter((slot) => (slot.face ?? 'FRONT') === face);
  const points = new Map(visibleSlots.map((slot) => [slot.key, pointFor(slot, body)]));
  const padding = Math.max(body.width, body.height) * .08;
  return <svg className="blueprint-preview" style={style} viewBox={`${-padding} ${-padding} ${body.width + padding * 2} ${body.height + padding * 2}`} role="img" aria-label={label ?? t('blueprint.editor.preview')} preserveAspectRatio="xMidYMid meet" data-ratio={body.width / body.height}>
    <rect className="blueprint-preview__body" x="0" y="0" width={body.width} height={body.height} rx={Math.min(body.width, body.height) * .04} fill={body.fill_color || '#18383a'} />
    {internalLinks.map((link) => { const from = points.get(link.from_slot_key); const to = points.get(link.to_slot_key); return from && to ? <line key={`${link.from_slot_key}-${link.to_slot_key}`} className="blueprint-preview__link" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null; })}
    {visibleSlots.map((slot) => { const point = pointFor(slot, body); return <g key={slot.key} data-slot-key={slot.key} data-anchor-side={slot.anchor.side}><circle className={`blueprint-preview__port blueprint-preview__port--${slot.kind.toLowerCase()}`} cx={point.x} cy={point.y} r={Math.max(body.width, body.height) * .018} /><title>{slot.display_name}</title></g>; })}
    <foreignObject x="0" y="0" width={body.width} height="20"><div className="blueprint-preview__faces"><button type="button" aria-pressed={face === 'FRONT'} onClick={() => setFace('FRONT')}>FRONT</button><button type="button" aria-pressed={face === 'REAR'} onClick={() => setFace('REAR')}>REAR</button></div></foreignObject>
  </svg>;
}

interface BlueprintPreviewViewportProps extends Omit<BlueprintPreviewProps, 'style'> { scale: number; }

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
  const fit = bounds.width > 0 && bounds.height > 0
    ? Math.min((bounds.width - 32) / body.width, (bounds.height - 32) / body.height)
    : 1;
  const fittedWidth = Math.max(1, body.width * fit * scale);
  const fittedHeight = Math.max(1, body.height * fit * scale);
  return <div ref={ref} className="blueprint-preview-viewport" data-preview-scale={scale} data-preview-fit={fit}>
    <BlueprintPreview {...preview} body={body} style={{ width: `${fittedWidth}px`, height: `${fittedHeight}px`, flex: '0 0 auto' }} />
  </div>;
}
