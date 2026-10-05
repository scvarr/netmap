import { useState } from 'react';
import { useI18n } from '../i18n';
import type { ModuleBay } from '../topology/hardwareModules';
import type { PresentationPanel } from '../topology/baseTemplateTypes';

import { bayNumericGeometry, minimumBaySize, type BayRectangle } from '../blueprints/moduleBayGeometry';

const signature = (bay: BayRectangle) => [bay.x, bay.y, bay.width, bay.height].join(':');

export function ModuleBaysEditor({ bay, panels, onChange, onRemove, onDuplicate }: {
  bay: ModuleBay; panels: PresentationPanel[]; onChange: (patch: Partial<ModuleBay>) => void; onRemove: () => void; onDuplicate: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<{ axis: keyof BayRectangle; raw: string; geometry: string }>();
  return <section aria-label={t('hardware.bays')} className="blueprint-composer__selected blueprint-composer__selected--bay">
    <label>{t('hardware.name')}<input value={bay.display_name} onChange={e => onChange({ display_name: e.target.value })} /></label>
    <label>{t('hardware.compatibility')}<input value={bay.compatibility} onChange={e => onChange({ compatibility: e.target.value })} /></label>
    <label>{t('hardware.panel')}<select value={bay.panel_key} onChange={e => onChange({ panel_key: e.target.value })}>{panels.map(p => <option key={p.panel_key} value={p.panel_key}>{p.display_name}</option>)}</select></label>
    {(['x', 'y', 'width', 'height'] as const).map(axis => <label key={axis}>{axis}<input type="number" step="0.01" min={axis === 'width' || axis === 'height' ? minimumBaySize : 0} max={1}
      value={draft?.axis === axis && draft.geometry === signature(bay) ? draft.raw : Number(bay[axis].toFixed(4))}
      onChange={e => {
        const raw = e.target.value, value = Number(raw);
        const geometry = raw.trim() && Number.isFinite(value) ? bayNumericGeometry(bay, axis, value) : bay;
        if (geometry !== bay) onChange(geometry);
        setDraft({ axis, raw, geometry: signature(geometry) });
      }} onBlur={() => setDraft(undefined)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>)}
    <button type="button" className="secondary-action" onClick={onDuplicate}>{t('hardware.duplicateBay')}</button>
    <button type="button" className="text-action" onClick={onRemove}>{t('hardware.remove')}</button>
  </section>;
}
