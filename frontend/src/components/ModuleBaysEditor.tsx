import { useI18n } from '../i18n';
import type { ModuleBay } from '../topology/hardwareModules';
import type { PresentationPanel } from '../topology/baseTemplateTypes';

export function ModuleBaysEditor({ bays, panels, onChange }: { bays: ModuleBay[]; panels: PresentationPanel[]; onChange: (bays: ModuleBay[]) => void }) {
  const { t } = useI18n();
  const change = (key: string, patch: Partial<ModuleBay>) => onChange(bays.map(b => b.bay_key === key ? { ...b, ...patch } : b));
  return <section aria-label={t('hardware.bays')} className="creation-form-surface"><h2>{t('hardware.bays')}</h2>
    {bays.map((bay, index) => <fieldset key={bay.bay_key}><legend>{bay.display_name || `${t('hardware.bays')} ${index + 1}`}</legend>
      <label>{t('hardware.name')}<input value={bay.display_name} onChange={e => change(bay.bay_key, { display_name: e.target.value })} /></label>
      <label>{t('hardware.compatibility')}<input value={bay.compatibility} onChange={e => change(bay.bay_key, { compatibility: e.target.value })} /></label>
      <label>{t('hardware.panel')}<select value={bay.panel_key} onChange={e => change(bay.bay_key, { panel_key: e.target.value })}>{panels.map(p => <option key={p.panel_key} value={p.panel_key}>{p.display_name}</option>)}</select></label>
      {(['x', 'y', 'width', 'height'] as const).map(axis => <label key={axis}>{axis}<input type="number" step="0.01" min={0} max={1} value={bay[axis]} onChange={e => change(bay.bay_key, { [axis]: Number(e.target.value) })} /></label>)}
      <button type="button" onClick={() => onChange(bays.filter(b => b.bay_key !== bay.bay_key))}>{t('hardware.remove')}</button>
    </fieldset>)}
    <button type="button" onClick={() => onChange([...bays, { bay_key: crypto.randomUUID(), display_name: '', compatibility: '', panel_key: panels[0].panel_key, x: .1, y: .1, width: .8, height: .8 }])}>{t('hardware.addBay')}</button>
  </section>;
}
