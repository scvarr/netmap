import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { hardwareModuleDataSource, type HardwareConfiguration, type HardwareModuleDataSource, type ModuleInstallation, type ModuleTemplate } from '../topology/hardwareModules';

export function ModuleInstallationSection({ objectId, onInstalled, dataSource = hardwareModuleDataSource }: { objectId: string; onInstalled: () => void | Promise<void>; dataSource?: HardwareModuleDataSource }) {
  const { t } = useI18n(); const [config, setConfig] = useState<HardwareConfiguration>(); const [modules, setModules] = useState<ModuleTemplate[]>([]); const [error, setError] = useState(''); const [pending, setPending] = useState(false); const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState<ModuleInstallation['layout']>();
  const gesture = useRef<{ x: number; y: number; layout: ModuleInstallation['layout']; resize: boolean } | undefined>(undefined);
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
    {config && dataSource.saveLayout && <div>
      <button disabled={pending || dirty} onClick={() => { cancel(); setEditing(!editing); }}>{t(editing ? 'layout.done' : 'layout.edit')}</button>
      {editing && <><span>{t(dirty ? 'layout.unsaved' : 'layout.select')}</span>
        <button disabled={!dirty || pending} onClick={() => void save()}>{t('layout.save')}</button>
        <button disabled={pending || !selected} onClick={cancel}>{t('layout.cancel')}</button>
        <button disabled={pending || !installed?.initial_layout} onClick={() => setDraft(installed!.initial_layout)}>{t('layout.reset')}</button></>}
    </div>}
    {error && <p role="alert">{error} {!editing && <button type="button" className="secondary-action" onClick={() => setRetry(v => v + 1)}>{t('action.retry')}</button>}</p>}
    {!config && !error && <p>{t('create.blueprintsLoading')}</p>}
    {config?.panels?.map(panel => <svg key={panel.panel_key} role="img" aria-label={panel.display_name} viewBox={`0 0 ${panel.width} ${panel.height}`} style={{ width: '100%', maxHeight: 300, touchAction: editing ? 'none' : 'auto' }}
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
      {config.bays.filter(b => b.panel_key === panel.panel_key).map(b => {
        const i = b.installation; const l = i?.id === selected && draft ? draft : i?.layout;
        const begin = (e: React.PointerEvent<SVGElement>, resize: boolean) => {
          if (!editing || pending || !i || !l || (dirty && selected !== i.id)) return;
          const svg = e.currentTarget.ownerSVGElement!; const matrix = svg.getScreenCTM(); if (!matrix) return;
          const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
          setSelected(i.id); setDraft(l); svg.setPointerCapture(e.pointerId);
          gesture.current = { x: point.x/panel.width, y: point.y/panel.height, layout: l, resize };
        };
        return <g key={b.bay_key}>
          <rect x={b.x * panel.width} y={b.y * panel.height} width={b.width * panel.width} height={b.height * panel.height} fill="none" stroke="#94a3b8" />
          {i && l && <g>
            <rect data-installation-id={i.id} onPointerDown={e => begin(e, false)} x={l.x * panel.width} y={l.y * panel.height} width={l.width * panel.width} height={l.height * panel.height} fill={i.fill_color} stroke={editing && selected === i.id ? '#f59e0b' : 'none'} strokeWidth={3}><title>{i.name}</title></rect>
            {i.endpoints.map(e => <circle key={e.connection_point_id} data-endpoint-id={e.connection_point_id} pointerEvents="none" cx={(l.x + (e.x-i.layout.x)/i.layout.width*l.width)*panel.width} cy={(l.y + (e.y-i.layout.y)/i.layout.height*l.height)*panel.height} r={3} fill="white" stroke="black"><title>{e.contextual_display_name}</title></circle>)}
            {editing && selected === i.id && <rect aria-label={t('layout.resize')} onPointerDown={e => begin(e, true)} x={(l.x+l.width)*panel.width-5} y={(l.y+l.height)*panel.height-5} width={10} height={10} fill="#f59e0b" style={{ cursor: 'nwse-resize' }} />}
          </g>}
        </g>;
      })}
    </svg>)}
    {config?.bays.map(bay => { const compatible = modules.filter(m => m.compatibility === bay.compatibility); const choice = choices[bay.bay_key] ?? { module: '', orientation: 'HORIZONTAL' as const }; return <section className="blueprint-composer__section" key={bay.bay_key} aria-label={bay.display_name}><h3>{bay.display_name}</h3><p>{bay.compatibility} · {bay.installation ? t('hardware.occupied', { name: bay.installation.name }) : t('hardware.free')}</p>
      {bay.installation ? <><ul>{bay.installation.endpoints.map(e => <li key={e.connection_point_id}>{e.contextual_display_name}</li>)}</ul><button type="button" className="text-action" disabled={pending || editing} onClick={() => void uninstall(bay.installation!.id, bay.installation!.name, bay.display_name)}>{t('hardware.uninstall')}</button></> : <>
        <label>{t('hardware.selectModule')}<select disabled={pending || editing} value={choice.module} onChange={e => setChoices(old => ({ ...old, [bay.bay_key]: { ...choice, module: e.target.value } }))}><option value="">{t(compatible.length ? 'hardware.selectModule' : 'hardware.noModules')}</option>{compatible.map(m => <option key={m.template_id} value={m.template_id}>{m.name}</option>)}</select></label>
        <label>{t('hardware.orientation')}<select disabled={pending || editing} value={choice.orientation} onChange={e => setChoices(old => ({ ...old, [bay.bay_key]: { ...choice, orientation: e.target.value as 'HORIZONTAL' | 'VERTICAL' } }))}><option value="HORIZONTAL">{t('hardware.horizontal')}</option><option value="VERTICAL">{t('hardware.vertical')}</option></select></label>
        <button type="button" className="primary-action" disabled={pending || editing || !choice.module} onClick={() => void install(bay.bay_key)}>{t('hardware.install')}</button>
      </>}
    </section>; })}
  </section>;
}
