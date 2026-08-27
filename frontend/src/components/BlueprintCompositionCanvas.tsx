import { useRef, useState, type PointerEvent } from 'react';
import type { BlueprintFace, BlueprintInternalLink } from '../topology/objectBlueprintTypes';
import { clampPlacement, fallbackPlacement, type BlueprintBlockInstance } from '../blueprints/editorModel';

interface Props {
  body: { width: number; height: number; fillColor: string };
  face: BlueprintFace;
  instances: BlueprintBlockInstance[];
  links: BlueprintInternalLink[];
  selectedKey?: string;
  onSelect: (key: string) => void;
  onPlacement: (key: string, placement: ReturnType<typeof fallbackPlacement>) => void;
}

const surface = 1000;
const pointForPort = (item: BlueprintBlockInstance, localId: string, fallbackIndex: number) => {
  const placement = item.placement ?? fallbackPlacement(fallbackIndex);
  const port = item.ports.find((value) => value.local_id === localId);
  if (!port) return undefined;
  const columns = Math.max(...item.ports.filter((value) => value.row === port.row).map((value) => value.column), 1);
  const rows = Math.max(...item.ports.map((value) => value.row), 1);
  return { x: (placement.x + placement.width * (port.column - .5) / columns) * surface, y: (placement.y + placement.height * (port.row - .5) / rows) * surface };
};

export function BlueprintCompositionCanvas({ body, face, instances, links, selectedKey, onSelect, onPlacement }: Props) {
  const svg = useRef<SVGSVGElement>(null); const [gesture, setGesture] = useState<{ key: string; mode: 'drag' | 'resize'; startX: number; startY: number; placement: ReturnType<typeof fallbackPlacement> }>();
  const visible = instances.map((item, index) => ({ item, index })).filter(({ item }) => (item.face ?? 'FRONT') === face);
  const coordinate = (event: PointerEvent<SVGElement>) => { const rect = svg.current!.getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }; };
  const update = (event: PointerEvent<SVGElement>) => { if (!gesture) return; const point = coordinate(event); const dx = point.x - gesture.startX; const dy = point.y - gesture.startY; const next = gesture.mode === 'drag' ? { ...gesture.placement, x: gesture.placement.x + dx, y: gesture.placement.y + dy } : { ...gesture.placement, width: gesture.placement.width + dx, height: gesture.placement.height + dy }; onPlacement(gesture.key, clampPlacement(next)); };
  const portPoints = new Map<string, { x: number; y: number }>();
  visible.forEach(({ item, index }) => item.ports.forEach((port) => { const key = item.resolvedSlotKeys[port.local_id]; const point = pointForPort(item, port.local_id, index); if (key && point) portPoints.set(key, point); }));
  return <svg ref={svg} className="blueprint-composition-canvas" viewBox={`0 0 ${surface} ${surface * body.height / body.width}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Композиция: ${face === 'FRONT' ? 'передняя' : 'задняя'} панель`} onPointerMove={update} onPointerUp={() => setGesture(undefined)} onPointerCancel={() => setGesture(undefined)}>
    <rect className="blueprint-composition-canvas__body" width={surface} height={surface * body.height / body.width} fill={body.fillColor} />
    {links.map((link) => { const from = portPoints.get(link.from_slot_key); const to = portPoints.get(link.to_slot_key); return from && to ? <line key={`${link.from_slot_key}-${link.to_slot_key}`} className="blueprint-composition-canvas__link" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null; })}
    {visible.map(({ item, index }) => { const placement = item.placement ?? fallbackPlacement(index); const selected = item.instanceKey === selectedKey; const height = surface * body.height / body.width; return <g key={item.instanceKey} data-instance-key={item.instanceKey} className={selected ? 'blueprint-composition-canvas__block is-selected' : 'blueprint-composition-canvas__block'} onPointerDown={(event) => { event.stopPropagation(); const point = coordinate(event); onSelect(item.instanceKey); event.currentTarget.setPointerCapture(event.pointerId); setGesture({ key:item.instanceKey, mode:'drag', startX:point.x, startY:point.y, placement }); }}>
      <rect x={placement.x * surface} y={placement.y * height} width={placement.width * surface} height={placement.height * height} rx="8" />
      {item.ports.map((port) => { const point = pointForPort(item, port.local_id, index)!; return <g key={port.local_id} className="blueprint-composition-canvas__port"><circle cx={point.x} cy={point.y} r="9" /><text x={point.x} y={point.y + 25}>{port.display_label}</text></g>; })}
      {selected && <rect data-resize-handle={item.instanceKey} className="blueprint-composition-canvas__resize" x={(placement.x + placement.width) * surface - 13} y={(placement.y + placement.height) * height - 13} width="26" height="26" onPointerDown={(event) => { event.stopPropagation(); const point = coordinate(event); event.currentTarget.setPointerCapture(event.pointerId); setGesture({ key:item.instanceKey, mode:'resize', startX:point.x, startY:point.y, placement }); }} />}
    </g>; })}
  </svg>;
}
