import { useI18n } from '../i18n';
import type { BlueprintSlotKind } from '../topology/baseTemplateTypes';

export type TemplateElementKind = BlueprintSlotKind | 'MODULE_PORT';

export function TemplateElementKindSelect({ value, onChange }: {
  value: TemplateElementKind;
  onChange: (kind: TemplateElementKind) => void;
}) {
  const { t } = useI18n();
  return <label>{t('blueprint.endpoint.kind')}<select value={value} onChange={event => onChange(event.target.value as TemplateElementKind)}>
    <option value="NETWORK_PORT">{t('blueprint.endpoint.networkPort')}</option>
    <option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option>
    <option value="MODULE_PORT">{t('blueprint.endpoint.modulePort')}</option>
  </select></label>;
}
