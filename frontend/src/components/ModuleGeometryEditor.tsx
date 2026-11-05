import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { ModuleGeometry, ModuleEndpoint } from '../topology/hardwareModules';
export function ModuleGeometryEditor({ geometry, endpoints, onChange, selectedKeys, onSelectionChange }: { selectedKeys?: Set<string>; onSelectionChange?: (keys: Set<string>) => void; geometry: ModuleGeometry; endpoints: ModuleEndpoint[]; onChange?: (g: ModuleGeometry) => void }) {
 const { t } = useI18n(); const [localSelected, setLocalSelected] = useState<Set<string>>(new Set()); const selected = new Set(endpoints.filter(e => (selectedKeys ?? localSelected).has(e.key)).map(e => e.key)); const select = onSelectionChange ?? setLocalSelected; const [zoom, setZoom] = useState(1);
 const svg = useRef<SVGSVGElement>(null);
 const [viewport, setViewport] = useState({ width: 640, height: 360 });
 useEffect(() => {
  const element = svg.current; if (!element) return;
  const resize = () => { const r = element.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setViewport({ width: r.width, height: r.height }); };
  resize();
  const observer = new ResizeObserver(resize); observer.observe(element);
  return () => observer.disconnect();
 }, []);
 // A uniform model-to-screen scale preserves the body's aspect ratio. Reserve
 // space for screen-sized port glyphs even when an endpoint is on a body edge.
 const scale = Math.min(viewport.width * .72 / geometry.width, viewport.height * .72 / geometry.height) * zoom;
 const viewWidth = viewport.width / scale, viewHeight = viewport.height / scale;
 const drag = useRef<{ x: number; y: number; geometry: ModuleGeometry; keys: string[] } | undefined>(undefined);
 const point = (x: number, y: number) => { const m = svg.current!.getScreenCTM()!; const p = new DOMPoint(x,y).matrixTransform(m.inverse()); return { x: p.x / geometry.width, y: p.y / geometry.height }; };
 const arrange = (axis: 'x' | 'y', distribute: boolean) => {
  const keys = Object.keys(geometry.endpoints).filter(k => selected.has(k)).sort((a,b) => geometry.endpoints[a][axis] - geometry.endpoints[b][axis] || a.localeCompare(b));
  if (keys.length < 2) return; const values = keys.map(k => geometry.endpoints[k][axis]); const positions = { ...geometry.endpoints };
  keys.forEach((k,i) => { positions[k] = { ...positions[k], [axis]: distribute ? values[0] + (values.at(-1)! - values[0]) * i / (keys.length - 1) : values.reduce((a,b) => a+b) / values.length }; }); onChange?.({ ...geometry, endpoints: positions });
 };
 return <section className={`module-geometry ${onChange ? "module-geometry--editable" : ""}`} aria-label={t('moduleGeometry.title')}>
 <div className="module-geometry__toolbar">{onChange && <><div className="module-geometry__tool-group" role="group" aria-label={t('moduleGeometry.body')}>
 {(['width','height'] as const).map(k => <label key={k}>{t(k === 'width' ? 'moduleGeometry.width' : 'moduleGeometry.height')}<input type="number" min="0.01" step="any" value={geometry[k]} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) onChange({ ...geometry, [k]: n }); }} /></label>)}
 <label>{t('moduleGeometry.color')}<input type="color" value={geometry.fill_color} onChange={e => onChange({ ...geometry, fill_color: e.target.value })} /></label>
 </div><div className="module-geometry__tool-group module-geometry__arrange" role="group" aria-label={t('moduleGeometry.arrange')}>
 {(['horizontal','vertical','distributeX','distributeY'] as const).map(a => <button className="secondary-action" type="button" key={a} aria-label={t(`moduleGeometry.${a}`)} title={t(`moduleGeometry.${a}`)} disabled={selected.size < 2} onClick={() => arrange(a === 'horizontal' || a === 'distributeY' ? 'y' : 'x', a.startsWith('distribute'))}>{t(a.startsWith('distribute') ? 'moduleGeometry.distributeShort' : 'moduleGeometry.alignShort')} {a === 'horizontal' || a === 'distributeX' ? '↔' : '↕'}</button>)}
 </div></>}
 <div className="module-geometry__tool-group" role="group" aria-label={t('moduleGeometry.zoom')}><button className="secondary-action" type="button" aria-label={t('moduleGeometry.zoomIn')} disabled={zoom >= 8} onClick={() => setZoom(z => Math.min(8,z*1.25))}>+</button><button className="secondary-action" type="button" aria-label={t('moduleGeometry.zoomOut')} disabled={zoom <= .25} onClick={() => setZoom(z => Math.max(.25,z/1.25))}>−</button><button className="secondary-action" type="button" onClick={() => setZoom(1)}>{t('moduleGeometry.fit')}</button><span>{Math.round(zoom * 100)}%</span></div>
 </div>
 {onChange && <p className="module-geometry__hint">{t('moduleGeometry.hint')}</p>}
 <div className="module-geometry__canvas"><svg ref={svg} aria-label={t('moduleGeometry.title')} viewBox={`${(geometry.width - viewWidth) / 2} ${(geometry.height - viewHeight) / 2} ${viewWidth} ${viewHeight}`} style={{width:'100%',height:'100%',touchAction:'none'}} onPointerMove={e => {
 const d = drag.current; if (!d || !onChange) return; const p = point(e.clientX,e.clientY); const positions = {...d.geometry.endpoints}; const points = d.keys.map(k => positions[k]);
 const dx = Math.max(-Math.min(...points.map(p=>p.x)),Math.min(p.x-d.x,1-Math.max(...points.map(p=>p.x)))); const dy = Math.max(-Math.min(...points.map(p=>p.y)),Math.min(p.y-d.y,1-Math.max(...points.map(p=>p.y))));
 d.keys.forEach(k => { positions[k] = {x:positions[k].x+dx,y:positions[k].y+dy}; }); onChange({...d.geometry,endpoints:positions});
 }} onPointerUp={() => {drag.current=undefined;}} onPointerCancel={() => {drag.current=undefined;}}>
 <rect width={geometry.width} height={geometry.height} fill={geometry.fill_color} stroke="currentColor" vectorEffect="non-scaling-stroke" onPointerDown={() => select(new Set())}/>
 {endpoints.map(e => {const p=geometry.endpoints[e.key]; return p && <g key={e.key} role="button" aria-label={e.display_name} aria-pressed={selected.has(e.key)} tabIndex={onChange ? 0 : undefined} onKeyDown={event => { if (!onChange || !['Enter', ' '].includes(event.key)) return; event.preventDefault(); const keys = event.shiftKey ? new Set(selected) : new Set<string>(); if (keys.has(e.key)) keys.delete(e.key); else keys.add(e.key); select(keys); }} onPointerDown={event => {
 if (!onChange) return; event.stopPropagation(); const toggle=event.shiftKey||event.ctrlKey||event.metaKey; const keys=toggle||selected.has(e.key)?new Set(selected):new Set<string>(); if(toggle&&keys.has(e.key)) keys.delete(e.key); else keys.add(e.key); select(keys); if(!keys.has(e.key))return; drag.current={...point(event.clientX,event.clientY),geometry,keys:[...keys]};svg.current?.setPointerCapture(event.pointerId);
 }}><circle cx={p.x*geometry.width} cy={p.y*geometry.height} r={5 / scale} fill={selected.has(e.key)?'#f59e0b':'white'} stroke="#152d30" strokeWidth={1.5} vectorEffect="non-scaling-stroke"/><text x={p.x*geometry.width} y={p.y*geometry.height-12 / scale} fontSize={12 / scale} fill="#e7f4f1" stroke="#071315" strokeWidth={3 / scale} paintOrder="stroke" textAnchor={p.x < .15 ? "start" : p.x > .85 ? "end" : "middle"}>{e.display_name}</text></g>;})}
 </svg></div></section>;
}
