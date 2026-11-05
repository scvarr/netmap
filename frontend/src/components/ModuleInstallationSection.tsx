import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BlueprintPresentation } from '../topology/types';
import { panelCompositionBounds } from '../topology/blueprintDisplaySize';
import { useI18n } from '../i18n';
import { hardwareModuleDataSource, type HardwareConfiguration, type HardwareModuleDataSource, type ModuleInstallation, type ModuleTemplate } from '../topology/hardwareModules';

export function ModuleInstallationSection({ objectId, onInstalled, presentation, dataSource = hardwareModuleDataSource }: { objectId: string; presentation?: BlueprintPresentation; onInstalled: () => void | Promise<void>; dataSource?: HardwareModuleDataSource }) {
  const { t } = useI18n(); const [config, setConfig] = useState<HardwareConfiguration>(); const [modules, setModules] = useState<ModuleTemplate[]>([]); const [error, setError] = useState(''); const [pending, setPending] = useState(false); const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState<ModuleInstallation['layout']>();
  const gesture = useRef<{ x: number; y: number; layout: ModuleInstallation['layout']; resize: boolean } | undefined>(undefined);
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 360 });
  useLayoutEffect(() => {
    const element = viewport.current!;
    const update = () => { if (element.clientWidth && element.clientHeight) setSize({ width: element.clientWidth, height: element.clientHeight }); };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  // The projection is the existing Map presentation of the pinned base revision.
  // Do not combine a stale projection with a different configuration revision.
  const image = presentation && config?.base_revision_id === presentation.version_ref.entity_id ? presentation : undefined;
  const bounds = image ? panelCompositionBounds(image.panels) : undefined;
  const scale = bounds ? Math.min(Math.max(1, size.width - 40) / bounds.width, Math.max(1, size.height - 40) / bounds.height) : 1;
  const modulePorts = new Set(config?.bays.flatMap(b => b.installation?.endpoints.map(e => e.connection_point_id) ?? []));
  const selectedBay = config?.bays.find(b => b.installation?.id === selected);
  const installed = selectedBay?.installation;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(installed?.layout);
  const cancel = () => { setDraft(undefined); setSelected(undefined); setError(''); gesture.current = undefined; };
  useEffect(() => { setEditing(false); cancel(); }, [objectId]);
  const save = async () => {
    if (!installed || !draft || !config || !dataSource.saveLayout || pending) return;
    setPending(true); setError('');
    try {
      const confirmed = await dataSource.saveLayout(objectId, installed.id, {
        configuration_id: config.configuration_id, base_revision_id: config.base_revision_id,
        module_revision_id: installed.module_revision_id, bay_key: selectedBay!.bay_key,
        orientation: installed.orientation, expected_layout: installed.layout, layout: draft,
      });
      setConfig(confirmed); setDraft(undefined);
      await onInstalled();
    } catch(e) { setError(t('hardware.failed', { error: String(e) })); }
    finally { setPending(false); }
  };
  const [choices, setChoices] = useState<Record<string, { module: string; orientation: 'HORIZONTAL' | 'VERTICAL' }>>({});
  useEffect(() => { let active = true; setConfig(undefined); setError(''); setChoices({}); void Promise.all([dataSource.loadConfiguration(objectId), dataSource.listModules()]).then(([c, m]) => { if (active) { setConfig(c); setModules(m.modules); } }, e => { if(active) setError(t('hardware.failed', { error: String(e) })); }); return () => { active = false; }; }, [objectId, dataSource, retry, t]);
  const install = async (bayKey: string) => { const choice = choices[bayKey]; if (!choice?.module || pending) return; setPending(true); setError(''); try { setConfig(await dataSource.installModule(objectId, { bay_key: bayKey, module_template_id: choice.module, orientation: choice.orientation })); await onInstalled(); } catch(e) { setError(t('hardware.failed', { error: String(e) })); } finally { setPending(false); } };
  const uninstall = async (installationId: string, name: string, bay: string) => {
    if (pending || !window.confirm(t('hardware.uninstallConfirm', { name, bay }))) return;
    setPending(true); setError('');
    try { setConfig(await dataSource.uninstallModule(objectId, installationId)); await onInstalled(); }
    catch(e) { setError(t('hardware.failed', { error: String(e) })); }
    finally { setPending(false); }
  };
  return <section className="blueprint-editor-controls" aria-label={t('hardware.bays')}><h2>{t('hardware.bays')}</h2>
    {config && dataSource.saveLayout && <div className="module-installation-toolbar">
      <button className="secondary-action" disabled={pending || dirty || !image} onClick={() => { cancel(); setEditing(!editing); }}>{t(editing ? 'layout.done' : 'layout.edit')}</button>
      {editing && <><span>{t(dirty ? 'layout.unsaved' : 'layout.select')}</span>
        <button className="primary-action" disabled={!dirty || pending} onClick={() => void save()}>{t('layout.save')}</button>
        <button className="secondary-action" disabled={pending || !selected} onClick={cancel}>{t('layout.cancel')}</button>
        <button className="secondary-action" disabled={pending || !installed?.initial_layout} onClick={() => setDraft(installed!.initial_layout)}>{t('layout.reset')}</button></>}
    </div>}
    {error && <p role="alert">{error} {!editing && <button type="button" className="secondary-action" onClick={() => setRetry(v => v + 1)}>{t('action.retry')}</button>}</p>}
    {!config && !error && <p>{t('create.blueprintsLoading')}</p>}
    <div ref={viewport} style={{ width: '100%', height: 360, minWidth: 0 }}>
    {config && !image && <p role="status">{t('layout.presentationUnavailable')}</p>}
    {image && bounds && <svg role="img" aria-label={t('blueprint.editor.preview')} width="100%" height="100%" viewBox={`${bounds.x - (size.width / scale - bounds.width) / 2} ${bounds.y - (size.height / scale - bounds.height) / 2} ${size.width / scale} ${size.height / scale}`} preserveAspectRatio="xMidYMid meet">
    {image.panels.map(panel => <svg key={panel.panel_key} role="img" aria-label={panel.display_name} viewBox={`0 0 ${panel.width} ${panel.height}`} x={panel.x} y={panel.y} width={panel.width} height={panel.height} overflow="visible" style={{ touchAction: editing ? 'none' : 'auto' }}
      onPointerMove={e => {
        const g = gesture.current; if (!g || !editing || pending) return;
        const svg = e.currentTarget; const matrix = svg.getScreenCTM(); if (!matrix) return;
        const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
        const dx = point.x / panel.width - g.x, dy = point.y / panel.height - g.y;
        const l = g.layout;
        if (g.resize) {
          const scale = Math.max(.01, Math.min(1 + (dx * l.width + dy * l.height) / (l.width ** 2 + l.height ** 2), (1-l.x)/l.width, (1-l.y)/l.height));
          setDraft({ ...l, width: l.width * scale, height: l.height * scale });
        } else setDraft({ ...l, x: Math.max(0, Math.min(1-l.width, l.x+dx)), y: Math.max(0, Math.min(1-l.height, l.y+dy)) });
      }} onPointerUp={() => { gesture.current = undefined; }} onPointerCancel={() => { gesture.current = undefined; }}>
      <rect data-panel-key={panel.panel_key} width={panel.width} height={panel.height} fill={image.body.fill_color ?? '#18383a'} stroke="#64748b" vectorEffect="non-scaling-stroke"><title>{panel.display_name}</title></rect>
      {image.slots.filter(s => s.panel_key === panel.panel_key && !modulePorts.has(s.connection_point_id)).map(s => <circle key={s.connection_point_id} data-builtin-endpoint-id={s.connection_point_id} cx={s.panel_local_position.x * panel.width} cy={s.panel_local_position.y * panel.height} r={4 / scale} fill="#38bdf8" stroke="#0f172a" strokeWidth={1} vectorEffect="non-scaling-stroke"><title>{s.display_name}</title></circle>)}
      {config!.bays.filter(b => b.panel_key === panel.panel_key).map(b => {
        const i = b.installation; const l = i?.id === selected && draft ? draft : i?.layout;
        const begin = (e: React.PointerEvent<SVGElement>, resize: boolean) => {
          if (!editing || pending || !i || !l || (dirty && selected !== i.id)) return;
          e.preventDefault();
          const svg = e.currentTarget.ownerSVGElement!; const matrix = svg.getScreenCTM(); if (!matrix) return;
          const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
          setSelected(i.id); setDraft(l); svg.setPointerCapture(e.pointerId);
          gesture.current = { x: point.x/panel.width, y: point.y/panel.height, layout: l, resize };
        };
        return <g key={b.bay_key}>
          {b.kind !== "LOGICAL" && <rect x={b.x * panel.width} y={b.y * panel.height} width={b.width * panel.width} height={b.height * panel.height} fill="none" stroke="#94a3b8" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"><title>{b.display_name}</title></rect>}
          {i && l && <g>
            <rect data-installation-id={i.id} onPointerDown={e => begin(e, false)} x={l.x * panel.width} y={l.y * panel.height} width={l.width * panel.width} height={l.height * panel.height} fill={i.fill_color} stroke={editing && selected === i.id ? '#f59e0b' : 'none'} strokeWidth={1.5} vectorEffect="non-scaling-stroke"><title>{i.name}</title></rect>
            {i.endpoints.map(e => <circle key={e.connection_point_id} data-endpoint-id={e.connection_point_id} pointerEvents="none" cx={(l.x + (e.x-i.layout.x)/i.layout.width*l.width)*panel.width} cy={(l.y + (e.y-i.layout.y)/i.layout.height*l.height)*panel.height} r={4 / scale} fill="white" stroke="black" strokeWidth={1} vectorEffect="non-scaling-stroke"><title>{e.contextual_display_name}</title></circle>)}
            {editing && selected === i.id && <rect aria-label={t('layout.resize')} onPointerDown={e => begin(e, true)} x={(l.x+l.width)*panel.width-4/scale} y={(l.y+l.height)*panel.height-4/scale} width={8/scale} height={8/scale} fill="#f59e0b" style={{ cursor: 'nwse-resize' }} />}
          </g>}
        </g>;
      })}
    </svg>)}
    </svg>}
    </div>
    {config?.bays.map(bay => { const compatible = modules.filter(m => m.compatibility === bay.compatibility); const choice = choices[bay.bay_key] ?? { module: '', orientation: 'HORIZONTAL' as const }; return <section className="blueprint-composer__section" key={bay.bay_key} aria-label={bay.display_name}><h3>{bay.display_name}</h3><p>{bay.compatibility} · {bay.installation ? t('hardware.occupied', { name: bay.installation.name }) : t('hardware.free')}</p>
      {bay.installation ? <><ul>{bay.installation.endpoints.map(e => <li key={e.connection_point_id}>{e.contextual_display_name}</li>)}</ul><button type="button" className="text-action" disabled={pending || editing} onClick={() => void uninstall(bay.installation!.id, bay.installation!.name, bay.display_name)}>{t('hardware.uninstall')}</button></> : <>
        <label>{t('hardware.selectModule')}<select disabled={pending || editing} value={choice.module} onChange={e => setChoices(old => ({ ...old, [bay.bay_key]: { ...choice, module: e.target.value } }))}><option value="">{t(compatible.length ? 'hardware.selectModule' : 'hardware.noModules')}</option>{compatible.map(m => <option key={m.template_id} value={m.template_id}>{m.name}</option>)}</select></label>
        <label>{t('hardware.orientation')}<select disabled={pending || editing} value={choice.orientation} onChange={e => setChoices(old => ({ ...old, [bay.bay_key]: { ...choice, orientation: e.target.value as 'HORIZONTAL' | 'VERTICAL' } }))}><option value="HORIZONTAL">{t('hardware.horizontal')}</option><option value="VERTICAL">{t('hardware.vertical')}</option></select></label>
        <button type="button" className="primary-action" disabled={pending || editing || !choice.module} onClick={() => void install(bay.bay_key)}>{t('hardware.install')}</button>
      </>}
    </section>; })}
  </section>;
}
