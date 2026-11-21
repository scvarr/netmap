import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type MessageKey } from '../i18n';

export interface ModulePortType {
  id: string;
  name: string;
  is_active: boolean;
}

export function useModulePortTypes() {
  const [types, setTypes] = useState<ModulePortType[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/module-port-types', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const items: unknown = await response.json();
      if (!Array.isArray(items)) throw new Error();
      if (!controller.signal.aborted) setTypes(items as ModulePortType[]);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, []);
  return { types, failed };
}

export function modulePortTypeName(types: ModulePortType[] | undefined, id: string) {
  return types?.find(type => type.id === id)?.name ?? id;
}

export function ModulePortTypeNotice({ types, failed }: ReturnType<typeof useModulePortTypes>) {
  const { t } = useI18n();
  if (failed) return <p role="alert" className="blueprint-editor__error">{t('portTypes.request')}</p>;
  if (!types || types.some(type => type.is_active)) return null;
  return <p role="status" className="catalog-note">{t('modulePortTypes.noActive')}{' '}
    <Link to="/catalogs/module-port-types">{t('portTypes.section')} → {t('modulePortTypes.title')}</Link>
  </p>;
}

export function ModulePortTypeSelect({ types, value = '', onChange, name, label = 'hardware.compatibility' }: {
  types?: ModulePortType[];
  value?: string;
  onChange?: (id: string) => void;
  name?: string;
  label?: MessageKey;
}) {
  const { t } = useI18n();
  const options = types?.filter(type => type.is_active || type.id === value);
  return <label>{t(label)}
    <select name={name} value={onChange ? value : undefined} defaultValue={onChange ? undefined : ''}
      disabled={!types} onChange={onChange && (event => onChange(event.target.value))}>
      <option value="" disabled>{t('modulePortTypes.select')}</option>
      {value && !options?.some(type => type.id === value) && <option value={value} disabled>{value}</option>}
      {options?.map(type => <option key={type.id} value={type.id} disabled={!type.is_active}>
        {type.name}{!type.is_active && ` · ${t('portTypes.archived')}`}
      </option>)}
    </select>
  </label>;
}
