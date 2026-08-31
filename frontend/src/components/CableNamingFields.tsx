import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import type { CableLabelDataSource, CableNamingInput } from '../topology/cableLabelTypes';

export function CableNamingFields({ dataSource, disabled, value, onChange }: { dataSource?: CableLabelDataSource; disabled: boolean; value: CableNamingInput; onChange: (value: CableNamingInput) => void }) {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<{ id: string; name: string; pattern: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!dataSource) return; let current = true; void dataSource.loadCableLabelTemplates().then((document) => { if (current) setTemplates(document.templates); }, () => { if (current) setError(t('cableNaming.templatesLoadFailed')); }); return () => { current = false; }; }, [dataSource, t]);
  const generate = value.generate_cable_label === true;
  return <fieldset className="connect-interface__naming" disabled={disabled}>
    <legend>{t('cableNaming.title')}</legend>
    <label><span>{t('cableNaming.manualLabel')}</span><input aria-label={t('cableNaming.manualLabel')} value={value.cable_label ?? ''} onChange={(event) => onChange({ ...value, cable_label: event.target.value })} /></label>
    <label><span>{t('cableNaming.template')}</span><select aria-label={t('cableNaming.template')} value={value.cable_label_template_id ?? ''} onChange={(event) => onChange({ ...value, cable_label_template_id: event.target.value || null })}><option value="">{t('cableNaming.selectTemplate')}</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.pattern}</option>)}</select></label>
    <label><input type="checkbox" checked={generate} onChange={(event) => onChange({ ...value, generate_cable_label: event.target.checked })} /> {t('cableNaming.generate')}</label>
    <small>{t('cableNaming.hint')}</small>
    {generate && !value.cable_label_template_id && <p className="connect-interface__error" role="alert">{t('cableNaming.templateRequired')}</p>}
    {error && <p className="connect-interface__error" role="alert">{error}</p>}
  </fieldset>;
}
