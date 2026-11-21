import { useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import type { BlueprintSlotKind } from '../topology/baseTemplateTypes';
import { PortTypeNotice, PortTypeSelect, type usePortTypes } from './PortTypeSelect';

import { MountTypeNotice, MountTypeSelect, type MountCatalogs } from './ModulePortTypeSelect';
import { isMountKind, moduleMount, type ModuleMount, type MountKind } from '../topology/hardwareModules';

export type TemplateElementKind = BlueprintSlotKind | MountKind;

export function TemplateElementKindSelect({ value, onChange }: {
  value: TemplateElementKind;
  onChange: (kind: TemplateElementKind) => void;
}) {
  const { t } = useI18n();
  return <label>{t('blueprint.endpoint.kind')}<select value={value} onChange={event => onChange(event.target.value as TemplateElementKind)}>
    <option value="NETWORK_PORT">{t('blueprint.endpoint.networkPort')}</option>
    <option value="CONNECTION_POINT">{t('blueprint.endpoint.connectionPoint')}</option>
    <option value="MODULE_PORT">{t('blueprint.endpoint.modulePort')}</option>
    <option value="MODULE_BAY">{t('blueprint.endpoint.moduleBay')}</option>
  </select></label>;
}

export function TemplateElementCreator({ catalog, moduleCatalog, onAddEndpoints, onAddModulePlaces, notice, placementScope = '' }: {
  catalog: ReturnType<typeof usePortTypes>;
  moduleCatalog: MountCatalogs;
  onAddEndpoints: (kind: BlueprintSlotKind, count: number, portTypeId: string, cardinality: number) => void;
  onAddModulePlaces: (count: number, mount: ModuleMount) => boolean;
  notice?: ReactNode;
  placementScope?: string;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<TemplateElementKind>('NETWORK_PORT');
  const [count, setCount] = useState('1');
  const [portTypeId, setPortTypeId] = useState('');
  const [modulePortTypeId, setModulePortTypeId] = useState('');
  const [failedScope, setFailedScope] = useState<string>();
  const quantity = Number(count);
  const modulePlace = isMountKind(kind);
  const type = catalog.types?.find(item => item.id === portTypeId);
  const physicalReady = type?.is_active && (kind !== 'NETWORK_PORT' || type.cardinality === 1);
  const valid = Number.isInteger(quantity) && quantity >= 1 && quantity <= 256
    && (modulePlace ? moduleCatalog[kind].types?.some(type => type.id === modulePortTypeId && type.is_active) : physicalReady);
  return <>
    <div className="template-element-creator">
      <TemplateElementKindSelect value={kind} onChange={next => { setKind(next); setModulePortTypeId(''); setFailedScope(undefined); }} />
      <label>{t('blueprint.endpoint.count')}<input type="number" min="1" max="256" value={count}
        onChange={event => { setCount(event.target.value); setFailedScope(undefined); }} /></label>
      {modulePlace
        ? <MountTypeSelect types={moduleCatalog[kind].types} label={kind === 'MODULE_PORT' ? 'blueprint.endpoint.moduleCompatibility' : 'blueprint.endpoint.bayCompatibility'}
          value={modulePortTypeId} onChange={setModulePortTypeId} />
        : <PortTypeSelect types={catalog.types} value={portTypeId} onChange={setPortTypeId} singleMember={kind === 'NETWORK_PORT'} />}
      <button type="button" className="secondary-action" disabled={!valid} onClick={() => {
        if (!valid) return;
        if (isMountKind(kind)) setFailedScope(onAddModulePlaces(quantity, moduleMount(kind, modulePortTypeId)) ? undefined : placementScope);
        else if (type) onAddEndpoints(kind, quantity, type.id, type.cardinality);
      }}>{t('blueprint.endpoint.add')}</button>
    </div>
    {notice}
    {modulePlace ? <MountTypeNotice catalogs={moduleCatalog} kind={kind} /> : <PortTypeNotice {...catalog} />}
    {failedScope === placementScope && <p role="alert" className="blueprint-editor__error">{t('blueprint.endpoint.modulePlacementFailed')}</p>}
  </>;
}
