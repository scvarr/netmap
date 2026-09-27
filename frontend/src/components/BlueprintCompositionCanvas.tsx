import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { BlueprintFace, BlueprintInternalLink, BlueprintSlot } from '../topology/objectBlueprintTypes';
import { useI18n } from '../i18n';
import { snapSelectionTranslation } from '../blueprints/editorModel';

interface Props {
  body: { width: number; height: number; fillColor: string }; face: BlueprintFace;
  slots: BlueprintSlot[]; links: BlueprintInternalLink[]; selectedKeys: ReadonlySet<string>;
  onSelect: (key: string, toggle: boolean) => void; onMarquee: (keys: string[]) => void;
  onTranslate: (keys: ReadonlySet<string>, dx: number, dy: number) => void;
  onContextMenu: (key: string | undefined, clientX: number, clientY: number) => void;
}
type Point = { x: number; y: number };
type Gesture = { kind: 'move'; key: string; keys: ReadonlySet<string>; start: Point; applied: Point; slots: BlueprintSlot[]; moved: boolean } | { kind: 'marquee'; start: Point; end: Point };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const markerPixels = { regular: 5, selected: 6, hit: 11 };

export function endpointMarkerRadii(scale: number) {
  return {
    regular: markerPixels.regular / scale,
    selected: markerPixels.selected / scale,
    hit: markerPixels.hit / scale,
  };
}

export function BlueprintCompositionCanvas({ body, face, slots, links, selectedKeys, onSelect, onMarquee, onTranslate, onContextMenu }: Props) {
  const { t } = useI18n();
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  const [marquee, setMarquee] = useState<{ start: Point; end: Point }>();
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const height = 1000 * (body.height > 0 && body.width > 0 ? body.height / body.width : 1);
  const [canvasScale, setCanvasScale] = useState(1);
  useLayoutEffect(() => {
    const element = svg.current;
    if (!element) return undefined;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const scale = Math.min(rect.width / 1000, rect.height / height);
      if (Number.isFinite(scale) && scale > 0) setCanvasScale(scale);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [height]);
  const marker = endpointMarkerRadii(canvasScale);
  const visible = slots.filter((slot) => slot.face === face);
  const points = new Map(visible.map((slot) => [slot.key, { x: slot.rendered_position.x * 1000, y: slot.rendered_position.y * height }]));
  const position = (event: PointerEvent<SVGElement>): Point => {
    const rect = svg.current!.getBoundingClientRect();
    const scale = Math.min(rect.width / 1000, rect.height / height);
    const left = rect.left + (rect.width - 1000 * scale) / 2;
    const top = rect.top + (rect.height - height * scale) / 2;
    return { x: clamp((event.clientX - left) / (1000 * scale)), y: clamp((event.clientY - top) / (height * scale)) };
  };
  const finish = (cancel = false) => {
    const current = gesture.current;
    if (!cancel && current?.kind === 'move' && !current.moved) onSelect(current.key, false);
    if (!cancel && current?.kind === 'marquee') {
      const { start, end } = current;
      onMarquee(visible.filter((slot) => {
        const { x, y } = slot.rendered_position;
        return x >= Math.min(start.x, end.x) && x <= Math.max(start.x, end.x) && y >= Math.min(start.y, end.y) && y <= Math.max(start.y, end.y);
      }).map((slot) => slot.key));
    }
    gesture.current = undefined;
    setMarquee(undefined);
    setGuides({});
  };
  return <svg ref={svg} className="blueprint-composition-canvas" viewBox={`0 0 1000 ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('blueprint.composition.canvas', { face: t(face === 'FRONT' ? 'blueprint.face.front' : 'blueprint.face.rear') })} onPointerMove={(event) => {
    const current = gesture.current;
    if (!current) return;
    const next = position(event);
    if (current.kind === 'move') {
      const rawDx = next.x - current.start.x;
      const rawDy = next.y - current.start.y;
      const rect = svg.current!.getBoundingClientRect();
      const scale = Math.min(rect.width / 1000, rect.height / height);
      if (Math.hypot(rawDx * scale * 1000, rawDy * scale * height) > 3) current.moved = true;
      if (!current.moved) return;
      const snapped = snapSelectionTranslation(current.slots, current.keys, rawDx, rawDy, 7 / (scale * 1000), 7 / (scale * height));
      onTranslate(current.keys, snapped.dx - current.applied.x, snapped.dy - current.applied.y);
      current.applied = { x: snapped.dx, y: snapped.dy };
      setGuides({ x: snapped.guideX, y: snapped.guideY });
    }
    else { current.end = next; setMarquee({ start: current.start, end: next }); }
  }} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onContextMenu={(event) => {
    event.preventDefault();
    const key = (event.target as Element).closest('[data-slot-key]')?.getAttribute('data-slot-key') ?? undefined;
    onContextMenu(key, event.clientX, event.clientY);
  }}>
    <rect className="blueprint-composition-canvas__body" width="1000" height={height} fill={body.fillColor} onPointerDown={(event) => {
      if (event.button !== 0) return;
      svg.current?.setPointerCapture?.(event.pointerId);
      const start = position(event);
      gesture.current = { kind: 'marquee', start, end: start };
      setMarquee({ start, end: start });
    }} />
    {links.map((link) => { const from = points.get(link.from_slot_key); const to = points.get(link.to_slot_key); return from && to ? <line key={`${link.from_slot_key}-${link.to_slot_key}`} className="blueprint-composition-canvas__link" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null; })}
    {visible.map((slot) => { const point = points.get(slot.key)!; const selected = selectedKeys.has(slot.key); return <g key={slot.key} data-slot-key={slot.key} data-selected={selected} className="blueprint-composition-canvas__port" onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      svg.current?.setPointerCapture?.(event.pointerId);
      const toggle = event.ctrlKey || event.metaKey;
      if (toggle || !selected) onSelect(slot.key, toggle);
      gesture.current = toggle ? undefined : { kind: 'move', key: slot.key, keys: selected ? new Set(selectedKeys) : new Set([slot.key]), start: position(event), applied: { x: 0, y: 0 }, slots: visible, moved: false };
    }}>
      <circle data-endpoint-hit-target cx={point.x} cy={point.y} r={marker.hit} fill="transparent" pointerEvents="all" />
      <circle data-endpoint-marker cx={point.x} cy={point.y} r={selected ? marker.selected : marker.regular} fill={slot.kind === 'NETWORK_PORT' ? '#60d4c9' : '#f2d081'} stroke={selected ? '#fff' : '#1c3135'} strokeWidth="2" vectorEffect="non-scaling-stroke"><title>{slot.display_name}</title></circle>
    </g>; })}
    {guides.y !== undefined && <line data-guide-y className="blueprint-composition-canvas__guide" x1="0" x2="1000" y1={guides.y * height} y2={guides.y * height} />}
    {guides.x !== undefined && <line data-guide-x className="blueprint-composition-canvas__guide" x1={guides.x * 1000} x2={guides.x * 1000} y1="0" y2={height} />}
    {marquee && <rect className="blueprint-composition-canvas__marquee" x={Math.min(marquee.start.x, marquee.end.x) * 1000} y={Math.min(marquee.start.y, marquee.end.y) * height} width={Math.abs(marquee.end.x - marquee.start.x) * 1000} height={Math.abs(marquee.end.y - marquee.start.y) * height} />}
  </svg>;
}
