import { useRef, useState, type PointerEvent } from 'react';
import type { BlueprintFace, BlueprintInternalLink, BlueprintSlot } from '../topology/objectBlueprintTypes';
import { useI18n } from '../i18n';

interface Props {
  body: { width: number; height: number; fillColor: string }; face: BlueprintFace;
  slots: BlueprintSlot[]; links: BlueprintInternalLink[]; selectedKey?: string;
  onSelect: (key: string) => void; onPosition: (key: string, position: { x: number; y: number }) => void;
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function BlueprintCompositionCanvas({ body, face, slots, links, selectedKey, onSelect, onPosition }: Props) {
  const { t } = useI18n();
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string>();
  const height = 1000 * (body.height > 0 && body.width > 0 ? body.height / body.width : 1);
  const radius = Math.min(13, height / 55);
  const visible = slots.filter((slot) => slot.face === face);
  const points = new Map(visible.map((slot) => [slot.key, { x: slot.rendered_position.x * 1000, y: slot.rendered_position.y * height }]));
  const position = (event: PointerEvent<SVGElement>) => {
    const rect = svg.current!.getBoundingClientRect();
    const scale = Math.min(rect.width / 1000, rect.height / height);
    const left = rect.left + (rect.width - 1000 * scale) / 2;
    const top = rect.top + (rect.height - height * scale) / 2;
    return { x: clamp((event.clientX - left) / (1000 * scale)), y: clamp((event.clientY - top) / (height * scale)) };
  };
  return <svg ref={svg} className="blueprint-composition-canvas" viewBox={`0 0 1000 ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('blueprint.composition.canvas', { face: t(face === 'FRONT' ? 'blueprint.face.front' : 'blueprint.face.rear') })} onPointerMove={(event) => { if (dragging) onPosition(dragging, position(event)); }} onPointerUp={() => setDragging(undefined)} onPointerCancel={() => setDragging(undefined)}>
    <rect className="blueprint-composition-canvas__body" width="1000" height={height} fill={body.fillColor} />
    {links.map((link) => { const from = points.get(link.from_slot_key); const to = points.get(link.to_slot_key); return from && to ? <line key={`${link.from_slot_key}-${link.to_slot_key}`} className="blueprint-composition-canvas__link" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null; })}
    {visible.map((slot) => { const point = points.get(slot.key)!; return <g key={slot.key} data-slot-key={slot.key} className="blueprint-composition-canvas__port" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); (event.currentTarget as SVGElement & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(event.pointerId); onSelect(slot.key); setDragging(slot.key); }}>
      <circle cx={point.x} cy={point.y} r={slot.key === selectedKey ? radius * 1.25 : radius} fill={slot.kind === 'NETWORK_PORT' ? '#60d4c9' : '#f2d081'} stroke={slot.key === selectedKey ? '#fff' : '#1c3135'} strokeWidth="2"><title>{slot.display_name}</title></circle>
    </g>; })}
  </svg>;
}
