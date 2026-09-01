import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import type { CableLabelDataSource, CableNamingInput } from '../topology/cableLabelTypes';

export function CableNamingFields({ dataSource, disabled, value, onChange, variant = 'create' }: { dataSource?: CableLabelDataSource; disabled: boolean; value: CableNamingInput; onChange: (value: CableNamingInput) => void; variant?: 'create' | 'rename' }) {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<{ id: string; name: string; description?: string | null; pattern: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!dataSource) return; let current = true; void dataSource.loadCableLabelTemplates().then((document) => { if (current) setTemplates(document.templates); }, () => { if (current) setError(t('cableNaming.templatesLoadFailed')); }); return () => { current = false; }; }, [dataSource, t]);
  const generate = value.generate_cable_label === true;
  const selectedTemplate = templates.find((item) => item.id === value.cable_label_template_id);
  if (variant === 'rename') return <fieldset className="cable-naming-fields cable-naming-fields--rename" disabled={disabled}>
    <legend>{t('cableNaming.renameMethod')}</legend>
    <div className="cable-naming-fields__modes" role="radiogroup" aria-label={t('cableNaming.renameMethod')}>
      <label><input type="radio" name="cable-naming-mode" checked={!generate} onChange={() => onChange({ ...value, generate_cable_label: false })} /> {t('cableNaming.renameManual')}</label>
      <label><input type="radio" name="cable-naming-mode" checked={generate} onChange={() => onChange({ ...value, generate_cable_label: true })} /> {t('cableNaming.renameGenerated')}</label>
    </div>
    {!generate ? <label><span>{t('cableNaming.renameManualLabel')}</span><input autoFocus aria-label={t('cableNaming.renameManualLabel')} value={value.cable_label ?? ''} onChange={(event) => onChange({ ...value, cable_label: event.target.value })} /></label> : <>
      <label><span>{t('cableNaming.template')}</span><select aria-label={t('cableNaming.template')} value={value.cable_label_template_id ?? ''} onChange={(event) => onChange({ ...value, cable_label_template_id: event.target.value || null })}><option value="">{t('cableNaming.selectTemplate')}</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {selectedTemplate && <div className="cable-naming-fields__template" aria-label={selectedTemplate.name}><strong>{selectedTemplate.name}</strong>{selectedTemplate.description && <small>{selectedTemplate.description}</small>}<code>{selectedTemplate.pattern}</code></div>}
      <small>{t('cableNaming.renameGeneratedHint')}</small>
    </>}
    {error && <p className="connect-interface__error" role="alert">{error}</p>}
  </fieldset>;
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
