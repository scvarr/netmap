import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { hardwareModuleDataSource, type HardwareConfiguration, type HardwareModuleDataSource, type ModuleTemplate } from '../topology/hardwareModules';

export function ModuleInstallationSection({ objectId, onInstalled, dataSource = hardwareModuleDataSource }: { objectId: string; onInstalled: () => void | Promise<void>; dataSource?: HardwareModuleDataSource }) {
  const { t } = useI18n(); const [config, setConfig] = useState<HardwareConfiguration>(); const [modules, setModules] = useState<ModuleTemplate[]>([]); const [error, setError] = useState(''); const [pending, setPending] = useState(false); const [retry, setRetry] = useState(0);
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
    {error && <p role="alert">{error} <button type="button" className="secondary-action" onClick={() => setRetry(v => v + 1)}>{t('action.retry')}</button></p>}
    {!config && !error && <p>{t('create.blueprintsLoading')}</p>}
    {config?.panels?.map(panel => <svg key={panel.panel_key} role="img" aria-label={panel.display_name} viewBox={`0 0 ${panel.width} ${panel.height}`} style={{ width: '100%', maxHeight: 300 }}>
      {config.bays.filter(b => b.panel_key === panel.panel_key).map(b => <g key={b.bay_key}>
        <rect x={b.x * panel.width} y={b.y * panel.height} width={b.width * panel.width} height={b.height * panel.height} fill="none" stroke="#94a3b8" />
        {b.installation && <g><rect x={b.installation.layout.x * panel.width} y={b.installation.layout.y * panel.height} width={b.installation.layout.width * panel.width} height={b.installation.layout.height * panel.height} fill={b.installation.fill_color}><title>{b.installation.name}</title></rect>
          {b.installation.endpoints.map(e => <circle key={e.connection_point_id} data-endpoint-id={e.connection_point_id} cx={e.x * panel.width} cy={e.y * panel.height} r={3} fill="white" stroke="black"><title>{e.contextual_display_name}</title></circle>)}
        </g>}
      </g>)}
    </svg>)}
    {config?.bays.map(bay => { const compatible = modules.filter(m => m.compatibility === bay.compatibility); const choice = choices[bay.bay_key] ?? { module: '', orientation: 'HORIZONTAL' as const }; return <section className="blueprint-composer__section" key={bay.bay_key} aria-label={bay.display_name}><h3>{bay.display_name}</h3><p>{bay.compatibility} · {bay.installation ? t('hardware.occupied', { name: bay.installation.name }) : t('hardware.free')}</p>
      {bay.installation ? <><ul>{bay.installation.endpoints.map(e => <li key={e.connection_point_id}>{e.contextual_display_name}</li>)}</ul><button type="button" className="text-action" disabled={pending} onClick={() => void uninstall(bay.installation!.id, bay.installation!.name, bay.display_name)}>{t('hardware.uninstall')}</button></> : <>
        <label>{t('hardware.selectModule')}<select disabled={pending} value={choice.module} onChange={e => setChoices(old => ({ ...old, [bay.bay_key]: { ...choice, module: e.target.value } }))}><option value="">{t(compatible.length ? 'hardware.selectModule' : 'hardware.noModules')}</option>{compatible.map(m => <option key={m.template_id} value={m.template_id}>{m.name}</option>)}</select></label>
        <label>{t('hardware.orientation')}<select disabled={pending} value={choice.orientation} onChange={e => setChoices(old => ({ ...old, [bay.bay_key]: { ...choice, orientation: e.target.value as 'HORIZONTAL' | 'VERTICAL' } }))}><option value="HORIZONTAL">{t('hardware.horizontal')}</option><option value="VERTICAL">{t('hardware.vertical')}</option></select></label>
        <button type="button" className="primary-action" disabled={pending || !choice.module} onClick={() => void install(bay.bay_key)}>{t('hardware.install')}</button>
      </>}
    </section>; })}
  </section>;
}
