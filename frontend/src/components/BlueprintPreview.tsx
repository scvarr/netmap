import type { BlueprintBody, BlueprintInternalLink, BlueprintSlot } from '../topology/objectBlueprintTypes';

interface BlueprintPreviewProps { body: BlueprintBody; slots: BlueprintSlot[]; internalLinks?: BlueprintInternalLink[]; label?: string; }
const pointFor = (slot: BlueprintSlot, body: BlueprintBody) => {
  const offset = slot.anchor.offset;
  if (slot.anchor.side === 'LEFT') return { x: 0, y: offset * body.height };
  if (slot.anchor.side === 'RIGHT') return { x: body.width, y: offset * body.height };
  if (slot.anchor.side === 'TOP') return { x: offset * body.width, y: 0 };
  return { x: offset * body.width, y: body.height };
};

export function BlueprintPreview({ body, slots, internalLinks = [], label = 'Схематический preview шаблона' }: BlueprintPreviewProps) {
  const points = new Map(slots.map((slot) => [slot.key, pointFor(slot, body)]));
  const padding = Math.max(body.width, body.height) * .08;
  return <svg className="blueprint-preview" viewBox={`${-padding} ${-padding} ${body.width + padding * 2} ${body.height + padding * 2}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet" data-ratio={body.width / body.height}>
    <rect className="blueprint-preview__body" x="0" y="0" width={body.width} height={body.height} rx={Math.min(body.width, body.height) * .04} fill={body.fill_color || '#18383a'} />
    {internalLinks.map((link) => { const from = points.get(link.from_slot_key); const to = points.get(link.to_slot_key); return from && to ? <line key={`${link.from_slot_key}-${link.to_slot_key}`} className="blueprint-preview__link" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null; })}
    {slots.map((slot) => { const point = pointFor(slot, body); return <g key={slot.key} data-slot-key={slot.key} data-anchor-side={slot.anchor.side}><circle className={`blueprint-preview__port blueprint-preview__port--${slot.kind.toLowerCase()}`} cx={point.x} cy={point.y} r={Math.max(body.width, body.height) * .018} /><title>{slot.display_name}</title></g>; })}
  </svg>;
}
