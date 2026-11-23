import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type MessageKey } from '../i18n';
import { mountTypeId, type ModuleMount, type MountKind } from '../topology/hardwareModules';

export interface MountType {
  id: string;
  name: string;
  is_active: boolean;
}

export const mountKindLabels = {
  MODULE_PORT: 'blueprint.endpoint.modulePort',
  MODULE_BAY: 'blueprint.endpoint.moduleBay',
} as const;

const catalogPaths = {
  MODULE_PORT: 'module-port-types',
  MODULE_BAY: 'module-bay-types',
} as const;

const catalogTitles = {
  MODULE_PORT: 'modulePortTypes.title',
  MODULE_BAY: 'moduleBayTypes.title',
} as const;

type CatalogState = { types?: MountType[]; failed?: boolean };
export type MountCatalogs = Record<MountKind, CatalogState>;

export function useMountTypes() {
  const [catalogs, setCatalogs] = useState<MountCatalogs>({ MODULE_PORT: {}, MODULE_BAY: {} });
  useEffect(() => {
    const controller = new AbortController();
    for (const kind of ['MODULE_PORT', 'MODULE_BAY'] as const) {
      void fetch('/api/v1/' + catalogPaths[kind], { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error();
        const items: unknown = await response.json();
        if (!Array.isArray(items)) throw new Error();
        if (!controller.signal.aborted) setCatalogs(previous => ({ ...previous, [kind]: { types: items as MountType[] } }));
      }).catch(() => {
        if (!controller.signal.aborted) setCatalogs(previous => ({ ...previous, [kind]: { failed: true } }));
      });
    }
    return () => controller.abort();
  }, []);
  return catalogs;
}

export function mountTypeName(catalogs: MountCatalogs, mount: ModuleMount) {
  const id = mountTypeId(mount);
  return catalogs[mount.mount_kind].types?.find(type => type.id === id)?.name ?? id;
}

export function MountTypeNotice({ catalogs, kind }: { catalogs: MountCatalogs; kind: MountKind }) {
  const { t } = useI18n();
  const { types, failed } = catalogs[kind];
  if (failed) return <p role="alert" className="blueprint-editor__error">{t('portTypes.request')}</p>;
  if (!types || types.some(type => type.is_active)) return null;
  return <p role="status" className="catalog-note">{t('moduleMount.noActive')}{' '}
    <Link to={'/catalogs/' + catalogPaths[kind]}>{t('portTypes.section')} → {t(catalogTitles[kind])}</Link>
  </p>;
}

export function MountTypeSelect({ types, value, onChange, label = 'hardware.compatibility' }: {
  types?: MountType[];
  value: string;
  onChange: (id: string) => void;
  label?: MessageKey;
}) {
  const { t } = useI18n();
  const options = types?.filter(type => type.is_active || type.id === value);
  return <label>{t(label)}
    <select value={value} disabled={!types} onChange={event => onChange(event.target.value)}>
      <option value="" disabled>{t('modulePortTypes.select')}</option>
      {value && !options?.some(type => type.id === value) && <option value={value} disabled>{value}</option>}
      {options?.map(type => <option key={type.id} value={type.id} disabled={!type.is_active}>
        {type.name}{!type.is_active && ` · ${t('portTypes.archived')}`}
      </option>)}
    </select>
  </label>;
}
