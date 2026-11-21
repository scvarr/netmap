import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

export type Medium = 'COPPER' | 'FIBER';

export type CatalogType = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  is_active: boolean;
};

export type PortType = CatalogType & {
  medium: Medium;
  members: string[];
  cardinality: number;
  connector_type_id: string | null;
};

export type ConnectorType = CatalogType & { mating_profile: string; termination: 'PLUG' | 'SOCKET' };
export type CableType = CatalogType & { medium: Medium; construction: string };

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

export function PortTypeSelect({ types, value, onChange, bulk = false, singleMember = false, compact = false }: {
  types: PortType[] | undefined;
  value: string;
  onChange: (id: string) => void;
  bulk?: boolean;
  singleMember?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const current = types?.find(type => type.id === value);
  const select = <select value={value} disabled={!types} onChange={event => onChange(event.target.value)}>
      <option value="" disabled>{t('portTypes.select')}</option>
      {types?.filter(type => (type.is_active && (!singleMember || type.cardinality === 1)) || type.id === value).map(type =>
        <option key={type.id} value={type.id} disabled={!type.is_active}>
          {type.name}{!compact && ` · ${type.color}`}{type.is_active ? '' : ` · ${t('portTypes.archived')}`}
        </option>)}
    </select>;
  const swatch = current && <span className="port-types-swatch" aria-hidden="true"><span aria-hidden="true" style={{ backgroundColor: current.color }} /></span>;
  return <label>{t(bulk ? 'portTypes.assignSelected' : 'portTypes.field')}
    {compact ? <span className="port-type-select__compact">{select}{swatch}</span> : <>{select}{swatch}</>}
  </label>;
}
