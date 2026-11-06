import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

export type PortType = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  is_active: boolean;
};

export const portTypesUrl = '/api/v1/port-types';

export function usePortTypes() {
  const [types, setTypes] = useState<PortType[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(portTypesUrl, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const items: unknown = await response.json();
      if (!Array.isArray(items)) throw new Error();
      if (!controller.signal.aborted) setTypes(items as PortType[]);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, []);
  return { types, failed };
}

export function PortTypeNotice({ types, failed }: ReturnType<typeof usePortTypes>) {
  const { t } = useI18n();
  if (failed) return <p role="alert" className="blueprint-editor__error">{t('portTypes.request')}</p>;
  if (!types || types.some(type => type.is_active)) return null;
  return <p role="status" className="catalog-note">{t('portTypes.noActive')}{' '}
    <Link to="/catalogs/port-types">{t('portTypes.section')} → {t('portTypes.title')}</Link>
  </p>;
}

export function PortTypeSelect({ types, value, onChange, bulk = false }: {
  types: PortType[] | undefined;
  value: string;
  onChange: (id: string) => void;
  bulk?: boolean;
}) {
  const { t } = useI18n();
  const current = types?.find(type => type.id === value);
  return <label>{t(bulk ? 'portTypes.assignSelected' : 'portTypes.field')}
    <select value={value} disabled={!types} onChange={event => onChange(event.target.value)}>
      <option value="" disabled>{t('portTypes.select')}</option>
      {types?.filter(type => type.is_active || type.id === value).map(type =>
        <option key={type.id} value={type.id} disabled={!type.is_active}>
          {type.name} · {type.color}{type.is_active ? '' : ` · ${t('portTypes.archived')}`}
        </option>)}
    </select>
    {current && <span className="port-types-swatch" aria-hidden="true"><span aria-hidden="true" style={{ backgroundColor: current.color }} /></span>}
  </label>;
}
