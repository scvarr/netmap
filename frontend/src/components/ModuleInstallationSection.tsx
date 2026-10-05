import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { hardwareModuleDataSource, type HardwareConfiguration, type HardwareModuleDataSource, type ModuleTemplate } from '../topology/hardwareModules';

export function ModuleInstallationSection({ objectId, onInstalled, dataSource = hardwareModuleDataSource }: { objectId: string; onInstalled: () => void | Promise<void>; dataSource?: HardwareModuleDataSource }) {
  const { t } = useI18n(); const [config, setConfig] = useState<HardwareConfiguration>(); const [modules, setModules] = useState<ModuleTemplate[]>([]); const [error, setError] = useState(''); const [pending, setPending] = useState(false); const [retry, setRetry] = useState(0);
  const [choices, setChoices] = useState<Record<string, { module: string; orientation: 'HORIZONTAL' | 'VERTICAL' }>>({});
  useEffect(() => { let active = true; setConfig(undefined); setError(''); setChoices({}); void Promise.all([dataSource.loadConfiguration(objectId), dataSource.listModules()]).then(([c, m]) => { if (active) { setConfig(c); setModules(m.modules); } }, e => { if(active) setError(t('hardware.failed', { error: String(e) })); }); return () => { active = false; }; }, [objectId, dataSource, retry, t]);
  const install = async (bayKey: string) => { const choice = choices[bayKey]; if (!choice?.module || pending) return; setPending(true); setError(''); try { setConfig(await dataSource.installModule(objectId, { bay_key: bayKey, module_template_id: choice.module, orientation: choice.orientation })); await onInstalled(); } catch(e) { setError(t('hardware.failed', { error: String(e) })); } finally { setPending(false); } };
  return <section className="creation-form-surface" aria-label={t('hardware.bays')}><h2>{t('hardware.bays')}</h2>
    {error && <p role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>{t('action.retry')}</button></p>}
    {!config && !error && <p>{t('create.blueprintsLoading')}</p>}
    {config?.bays.map(bay => { const compatible = modules.filter(m => m.compatibility === bay.compatibility); const choice = choices[bay.bay_key] ?? { module: '', orientation: 'HORIZONTAL' as const }; return <fieldset key={bay.bay_key}><legend>{bay.display_name}</legend><p>{bay.compatibility} · {bay.installation ? t('hardware.occupied', { name: bay.installation.name }) : t('hardware.free')}</p>
      {bay.installation ? <ul>{bay.installation.endpoints.map(e => <li key={e.connection_point_id}>{e.display_name}</li>)}</ul> : <>
        <label>{t('hardware.selectModule')}<select disabled={pending} value={choice.module} onChange={e => setChoices(old => ({ ...old, [bay.bay_key]: { ...choice, module: e.target.value } }))}><option value="">{t(compatible.length ? 'hardware.selectModule' : 'hardware.noModules')}</option>{compatible.map(m => <option key={m.template_id} value={m.template_id}>{m.name}</option>)}</select></label>
        <label>{t('hardware.orientation')}<select disabled={pending} value={choice.orientation} onChange={e => setChoices(old => ({ ...old, [bay.bay_key]: { ...choice, orientation: e.target.value as 'HORIZONTAL' | 'VERTICAL' } }))}><option value="HORIZONTAL">{t('hardware.horizontal')}</option><option value="VERTICAL">{t('hardware.vertical')}</option></select></label>
        <button disabled={pending || !choice.module} onClick={() => void install(bay.bay_key)}>{t('hardware.install')}</button>
      </>}
    </fieldset>; })}
  </section>;
}
