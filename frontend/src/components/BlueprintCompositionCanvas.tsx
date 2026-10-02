import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { BlueprintInternalLink, BlueprintSlot, PresentationPanel } from '../topology/objectBlueprintTypes';
import { useI18n } from '../i18n';
import { panelGestureGeometry, snapSelectionTranslation, type PanelHandle, type PanelRectangle } from '../blueprints/editorModel';

interface Props {
  body: { width: number; height: number; fillColor: string }; panels: PresentationPanel[]; activePanelKey: string;
  slots: BlueprintSlot[]; links: BlueprintInternalLink[]; selectedKeys: ReadonlySet<string>;
  onSelect: (key: string, toggle: boolean) => void; onMarquee: (keys: string[]) => void;
  onTranslate: (keys: ReadonlySet<string>, dx: number, dy: number) => void;
  onContextMenu: (key: string | undefined, clientX: number, clientY: number) => void;
  onActivatePanel: (key: string) => void;
  onPanelGeometry?: (key: string, rectangle: PanelRectangle) => void;
}
type Point = { x: number; y: number };
type Gesture = { kind: 'move'; key: string; keys: ReadonlySet<string>; start: Point; applied: Point; slots: BlueprintSlot[]; moved: boolean } | { kind: 'marquee'; start: Point; end: Point } | { kind: 'panel'; handle: 'move' | PanelHandle; panel: PresentationPanel; start: Point; pixelsPerUnit: number };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const markerPixels = { regular: 5, selected: 6, hit: 11 };

export function endpointMarkerRadii(scale: number) {
  return {
    regular: markerPixels.regular / scale,
    selected: markerPixels.selected / scale,
    hit: markerPixels.hit / scale,
  };
}

export function BlueprintCompositionCanvas({ body, panels, activePanelKey, slots, links, selectedKeys, onSelect, onMarquee, onTranslate, onContextMenu, onActivatePanel, onPanelGeometry }: Props) {
  const { t } = useI18n();
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  const [marquee, setMarquee] = useState<{ start: Point; end: Point }>();
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [panelGuides, setPanelGuides] = useState<{ x?: number; y?: number }>({});
  const [frozenView, setFrozenView] = useState<{ minX: number; minY: number; unit: number; height: number }>();
  const liveMinX = Math.min(...panels.map((panel) => panel.x));
  const liveMinY = Math.min(...panels.map((panel) => panel.y));
  const width = Math.max(...panels.map((panel) => panel.x + panel.width)) - liveMinX;
  const compositionHeight = Math.max(...panels.map((panel) => panel.y + panel.height)) - liveMinY;
  const liveUnit = 1000 / Math.max(width, 1);
  const liveHeight = Math.max(compositionHeight, 1) * liveUnit;
  const { minX, minY, unit, height } = frozenView ?? { minX: liveMinX, minY: liveMinY, unit: liveUnit, height: liveHeight };
  const activePanel = panels.find((panel) => panel.panel_key === activePanelKey)!;
  const panelRect = (panel: PresentationPanel) => ({ x: (panel.x - minX) * unit, y: (panel.y - minY) * unit, width: panel.width * unit, height: panel.height * unit });
  const activeRect = panelRect(activePanel);
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
  const visible = slots.filter((slot) => slot.panel_key === activePanelKey);
  const points = new Map(slots.map((slot) => { const panel = panels.find((item) => item.panel_key === slot.panel_key)!; const rect = panelRect(panel); return [slot.key, { x: rect.x + slot.rendered_position.x * rect.width, y: rect.y + slot.rendered_position.y * rect.height }] as const; }));
  const position = (event: PointerEvent<SVGElement>): Point => {
    const rect = svg.current!.getBoundingClientRect();
    const scale = Math.min(rect.width / 1000, rect.height / height);
    const left = rect.left + (rect.width - 1000 * scale) / 2;
    const top = rect.top + (rect.height - height * scale) / 2;
    return { x: clamp(((event.clientX - left) / scale - activeRect.x) / Math.max(activeRect.width, 1)), y: clamp(((event.clientY - top) / scale - activeRect.y) / Math.max(activeRect.height, 1)) };
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
    setFrozenView(undefined);
    setPanelGuides({});
    setMarquee(undefined);
    setGuides({});
  };
  const startPanelGesture = (event: PointerEvent<SVGElement>, panel: PresentationPanel, handle: 'move' | PanelHandle) => {
    if (event.button !== 0 || panel.panel_key !== activePanelKey) return;
    event.preventDefault(); event.stopPropagation();
    svg.current?.setPointerCapture?.(event.pointerId);
    const rect = svg.current!.getBoundingClientRect();
    const scale = Math.min(rect.width / 1000, rect.height / height);
    gesture.current = { kind: 'panel', handle, panel, start: { x: event.clientX, y: event.clientY }, pixelsPerUnit: unit * scale };
    setFrozenView({ minX, minY, unit, height });
  };
  return <svg ref={svg} className="blueprint-composition-canvas" viewBox={`0 0 1000 ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('blueprint.editor.preview')} onPointerMove={(event) => {
    const current = gesture.current;
    if (!current) return;
    if (current.kind === 'panel') {
      const { rectangle, guides: snappedGuides } = panelGestureGeometry(current.panel, panels.filter((panel) => panel.panel_key !== current.panel.panel_key), current.handle,
        (event.clientX - current.start.x) / current.pixelsPerUnit, (event.clientY - current.start.y) / current.pixelsPerUnit,
        7 / current.pixelsPerUnit, 40 / current.pixelsPerUnit);
      onPanelGeometry?.(current.panel.panel_key, rectangle);
      setPanelGuides(snappedGuides);
      return;
    }
    const next = position(event);
    if (current.kind === 'move') {
      const rawDx = next.x - current.start.x;
      const rawDy = next.y - current.start.y;
      const rect = svg.current!.getBoundingClientRect();
      const scale = Math.min(rect.width / 1000, rect.height / height);
      if (Math.hypot(rawDx * scale * activeRect.width, rawDy * scale * activeRect.height) > 3) current.moved = true;
      if (!current.moved) return;
      const snapped = snapSelectionTranslation(current.slots, current.keys, rawDx, rawDy, 7 / (scale * activeRect.width), 7 / (scale * activeRect.height));
      onTranslate(current.keys, snapped.dx - current.applied.x, snapped.dy - current.applied.y);
      current.applied = { x: snapped.dx, y: snapped.dy };
      setGuides({ x: snapped.guideX, y: snapped.guideY });
    }
    else { current.end = next; setMarquee({ start: current.start, end: next }); }
  }} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onContextMenu={(event) => {
    event.preventDefault();
    const key = (event.target as Element).closest('[data-slot-key]')?.getAttribute('data-slot-key') ?? undefined;
    const panel = (event.target as Element).closest('[data-panel-key]')?.getAttribute('data-panel-key') ?? slots.find((slot) => slot.key === key)?.panel_key;
    if (panel && panel !== activePanelKey) { onActivatePanel(panel); return; }
    onContextMenu(key, event.clientX, event.clientY);
  }}>
    {panels.map((panel) => { const rect = panelRect(panel); const active = panel.panel_key === activePanelKey; return <g key={panel.panel_key} data-panel-key={panel.panel_key} data-active={active}>
      <rect className="blueprint-composition-canvas__body" x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill={body.fillColor} onPointerDown={(event) => {
        if (event.button !== 0) return;
        if (!active) { onActivatePanel(panel.panel_key); return; }
        svg.current?.setPointerCapture?.(event.pointerId);
        const start = position(event);
        gesture.current = { kind: 'marquee', start, end: start };
        setMarquee({ start, end: start });
      }}><title>{panel.display_name}</title></rect>
    </g>; })}
    <rect data-panel-move-border={activePanelKey} className="blueprint-composition-canvas__move-border" x={activeRect.x} y={activeRect.y} width={activeRect.width} height={activeRect.height} strokeWidth={10 / canvasScale} onPointerDown={(event) => startPanelGesture(event, activePanel, 'move')} />
    {links.map((link) => { const from = points.get(link.from_slot_key); const to = points.get(link.to_slot_key); return from && to ? <line key={`${link.from_slot_key}-${link.to_slot_key}`} className="blueprint-composition-canvas__link" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null; })}
    {slots.map((slot) => { const point = points.get(slot.key)!; const selected = selectedKeys.has(slot.key); return <g key={slot.key} data-slot-key={slot.key} data-selected={selected} className="blueprint-composition-canvas__port" onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      if (slot.panel_key !== activePanelKey) { onActivatePanel(slot.panel_key); onSelect(slot.key, false); return; }
      svg.current?.setPointerCapture?.(event.pointerId);
      const toggle = event.ctrlKey || event.metaKey;
      if (toggle || !selected) onSelect(slot.key, toggle);
      gesture.current = toggle ? undefined : { kind: 'move', key: slot.key, keys: selected ? new Set(selectedKeys) : new Set([slot.key]), start: position(event), applied: { x: 0, y: 0 }, slots: visible, moved: false };
    }}>
      <circle data-endpoint-hit-target cx={point.x} cy={point.y} r={marker.hit} fill="transparent" pointerEvents="all" />
      <circle data-endpoint-marker cx={point.x} cy={point.y} r={selected ? marker.selected : marker.regular} fill={slot.kind === 'NETWORK_PORT' ? '#60d4c9' : '#f2d081'} stroke={selected ? '#fff' : '#1c3135'} strokeWidth="2" vectorEffect="non-scaling-stroke"><title>{slot.display_name}</title></circle>
    </g>; })}
    {(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const).map((handle) => {
      const x = activeRect.x + activeRect.width * (handle.includes('w') ? 0 : handle.includes('e') ? 1 : .5);
      const y = activeRect.y + activeRect.height * (handle.includes('n') ? 0 : handle.includes('s') ? 1 : .5);
      return <circle key={handle} data-panel-resize={handle} className={`blueprint-composition-canvas__resize blueprint-composition-canvas__resize--${handle}`} cx={x} cy={y} r={7 / canvasScale} stroke="#071315" strokeWidth={3 / canvasScale} onPointerDown={(event) => startPanelGesture(event, activePanel, handle)} />;
    })}
    {panelGuides.x !== undefined && <line data-panel-guide-x className="blueprint-composition-canvas__guide" x1={(panelGuides.x - minX) * unit} x2={(panelGuides.x - minX) * unit} y1={0} y2={height} />}
    {panelGuides.y !== undefined && <line data-panel-guide-y className="blueprint-composition-canvas__guide" x1={0} x2={1000} y1={(panelGuides.y - minY) * unit} y2={(panelGuides.y - minY) * unit} />}
    {guides.y !== undefined && <line data-guide-y className="blueprint-composition-canvas__guide" x1={activeRect.x} x2={activeRect.x + activeRect.width} y1={activeRect.y + guides.y * activeRect.height} y2={activeRect.y + guides.y * activeRect.height} />}
    {guides.x !== undefined && <line data-guide-x className="blueprint-composition-canvas__guide" x1={activeRect.x + guides.x * activeRect.width} x2={activeRect.x + guides.x * activeRect.width} y1={activeRect.y} y2={activeRect.y + activeRect.height} />}
    {marquee && <rect className="blueprint-composition-canvas__marquee" x={activeRect.x + Math.min(marquee.start.x, marquee.end.x) * activeRect.width} y={activeRect.y + Math.min(marquee.start.y, marquee.end.y) * activeRect.height} width={Math.abs(marquee.end.x - marquee.start.x) * activeRect.width} height={Math.abs(marquee.end.y - marquee.start.y) * activeRect.height} />}
  </svg>;
}
