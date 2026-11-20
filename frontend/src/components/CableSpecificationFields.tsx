import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import type { CableSpecification } from '../topology/physicalEndpointConnectionWriteTypes';
import type { CatalogType } from './PortTypeSelect';

async function loadActiveTypes(catalog: string, signal: AbortSignal): Promise<CatalogType[]> {
  const response = await fetch('/api/v1/' + catalog, { signal });
  if (!response.ok) throw new Error();
  const items: CatalogType[] = await response.json();
  return items.filter(type => type.is_active);
}

export function CableSpecificationFields({ value, onChange, disabled }: {
  value: CableSpecification;
  onChange: (value: CableSpecification) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [types, setTypes] = useState<CatalogType[]>();
  const [connectors, setConnectors] = useState<CatalogType[]>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const reportFailure = () => {
      if (!controller.signal.aborted) setFailed(true);
    };
    void loadActiveTypes('cable-types', controller.signal).then(items => {
      if (!controller.signal.aborted) setTypes(items);
    }, reportFailure);
    void loadActiveTypes('connector-types', controller.signal).then(items => {
      if (!controller.signal.aborted) setConnectors(items);
    }, reportFailure);
    return () => controller.abort();
  }, []);

  return <>
    <label className="physical-panel-picker">{t('cableSpec.type')}
      <select required value={value.cable_type_id} disabled={disabled || !types?.length}
        onChange={event => onChange({ ...value, cable_type_id: event.target.value })}>
        <option value="" disabled>{t('cableSpec.select')}</option>
        {types?.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
      </select>
    </label>
    {(['connector_a_type_id', 'connector_b_type_id'] as const).map(field =>
      <label key={field} className="physical-panel-picker">
        {t(field === 'connector_a_type_id' ? 'cableSpec.connectorA' : 'cableSpec.connectorB')}
        <select value={value[field] ?? ''} disabled={disabled || !connectors?.length}
          onChange={event => onChange({ ...value, [field]: event.target.value || null })}>
          <option value="">{t('cableSpec.unspecified')}</option>
          {connectors?.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
        </select>
      </label>
    )}
    {failed && <p role="alert">{t('cableSpec.loadFailed')}</p>}
    {types?.length === 0 && <p role="status">{t('cableSpec.noActive')}</p>}
  </>;
}
