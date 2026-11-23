import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import type { CableSpecification } from '../topology/physicalEndpointConnectionWriteTypes';
import type { CableType } from './PortTypeSelect';

async function loadActiveTypes(signal: AbortSignal): Promise<CableType[]> {
  const response = await fetch('/api/v1/cable-types', { signal });
  if (!response.ok) throw new Error();
  const items: CableType[] = await response.json();
  return items.filter(type => type.is_active);
}

export function CableSpecificationFields({ value, onChange, disabled }: {
  value: CableSpecification;
  onChange: (value: CableSpecification) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [types, setTypes] = useState<CableType[]>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const reportFailure = () => {
      if (!controller.signal.aborted) setFailed(true);
    };
    void loadActiveTypes(controller.signal).then(items => {
      if (!controller.signal.aborted) setTypes(items);
    }, reportFailure);
    return () => controller.abort();
  }, []);

  return <>
    <label className="physical-panel-picker">{t('cableSpec.type')}
      <select required value={value.cable_type_id} disabled={disabled || !types?.length}
        onChange={event => onChange({ ...value, cable_type_id: event.target.value })}>
        <option value="" disabled>{t('cableSpec.select')}</option>
        {types?.map(type => <option key={type.id} value={type.id}>{type.name}{type.fiber_mode && ` · ${type.fiber_mode}`}</option>)}
      </select>
    </label>
    {failed && <p role="alert">{t('cableSpec.loadFailed')}</p>}
    {types?.length === 0 && <p role="status">{t('cableSpec.noActive')}</p>}
  </>;
}
