import { moduleMount, mountTypeId, type ModuleMount } from '../topology/hardwareModules';
import { MountTypeSelect, mountKindLabels, mountTypeName, type MountCatalogs } from './ModulePortTypeSelect';
import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import type { BlueprintEditorState } from '../blueprints/editorModel';
import type { LogicalModuleBay, ModuleBay } from '../topology/hardwareModules';

interface Props {
  catalogs: MountCatalogs;
  panels: BlueprintEditorState['panels'];
  activePanelKey: string;
  bays: ModuleBay[];
  onChange: (bays: ModuleBay[]) => void;
}

const groupKey = (panel: string, mount: ModuleMount) => JSON.stringify([panel, mount.mount_kind, mountTypeId(mount)]);
const MAX_LOGICAL_PLACES_PER_GROUP = 1024;

export function LogicalModulePlacesEditor({ catalogs, panels, activePanelKey, bays, onChange }: Props) {
  const { t } = useI18n();
  const [bayTypeId, setBayTypeId] = useState('');
  const [error, setError] = useState<string>();
  const groups = new Map<string, LogicalModuleBay[]>();
  for (const bay of bays) {
    if (bay.kind !== 'LOGICAL' || bay.mount_kind !== 'MODULE_BAY') continue;
    const key = groupKey(bay.panel_key, bay);
    const group = groups.get(key);
    if (group) group.push(bay);
    else groups.set(key, [bay]);
  }

  const apply = (panel: string, mount: ModuleMount, rawCount: string, creating = false) => {
    const count = Number(rawCount);
    if (/^\d+$/.test(rawCount) && count > MAX_LOGICAL_PLACES_PER_GROUP) {
      setError(t('logicalPlaces.countLimit', { max: MAX_LOGICAL_PLACES_PER_GROUP }));
      return false;
    }
    if (!/^\d+$/.test(rawCount) || !Number.isSafeInteger(count) || (creating && count === 0)) {
      setError(t(creating ? 'logicalPlaces.positiveCount' : 'logicalPlaces.invalidCount'));
      return false;
    }
    if (!panels.some(item => item.panel_key === panel)) {
      setError(t('logicalPlaces.invalidPanel'));
      return false;
    }
    const existing = groups.get(groupKey(panel, mount)) ?? [];
    if (count > existing.length && !catalogs[mount.mount_kind].types?.some(type => type.id === mountTypeId(mount) && type.is_active)) {
      setError(t('logicalPlaces.invalidCompatibility'));
      return false;
    }
    if (creating && existing.length) {
      setError(t('logicalPlaces.duplicate'));
      return false;
    }
    setError(undefined);
    if (count < existing.length) {
      const removed = new Set(existing.map(bay => bay.bay_key).sort().slice(count));
      onChange(bays.filter(bay => bay.kind !== 'LOGICAL' || !removed.has(bay.bay_key)));
    } else if (count > existing.length) {
      const keys = new Set(bays.map(bay => bay.bay_key));
      const names = new Set(existing.map(bay => bay.display_name));
      const next = [...bays];
      let number = 1;
      for (let index = existing.length; index < count; index++) {
        let bay_key = crypto.randomUUID();
        while (keys.has(bay_key)) bay_key = crypto.randomUUID();
        keys.add(bay_key);
        let display_name = t('logicalPlaces.placeName', { number: number++ });
        while (names.has(display_name)) display_name = t('logicalPlaces.placeName', { number: number++ });
        names.add(display_name);
        next.push({ bay_key, display_name, panel_key: panel, ...moduleMount(mount.mount_kind, mountTypeId(mount)), kind: 'LOGICAL', x: null, y: null, width: null, height: null });
      }
      onChange(next);
    }
    return true;
  };

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (apply(String(fields.get('panel')), moduleMount('MODULE_BAY', bayTypeId), String(fields.get('count')), true)) {
      form.reset();
      setBayTypeId('');
    }
  };

  return <details className="blueprint-composer__section">
    <summary>{t('logicalPlaces.title')} · {groups.size}</summary>
    <p>{t('logicalPlaces.updateNotice')}</p>
    {error && <p role="alert" className="blueprint-editor__error">{error}</p>}
    {[...groups].map(([key, group]) => {
      const mount = group[0];
      const { panel_key } = mount;
      const panel = panels.find(item => item.panel_key === panel_key);
      return <form key={key} onSubmit={event => {
        event.preventDefault();
        apply(panel_key, mount, String(new FormData(event.currentTarget).get('count')));
      }}>
        <fieldset>
          <legend>{panel?.panel_number} · {panel?.display_name} / <code style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t(mountKindLabels[mount.mount_kind])} · {mountTypeName(catalogs, mount)}</code></legend>
          <label>{t('logicalPlaces.count')}<input key={group.length} name="count" inputMode="numeric" defaultValue={group.length} /></label>
          <button type="submit" className="secondary-action">{t('logicalPlaces.apply')}</button>{' '}
          <button type="button" className="text-action" onClick={() => apply(panel_key, mount, '0')}>{t('logicalPlaces.remove')}</button>
        </fieldset>
      </form>;
    })}
    <form onSubmit={create}>
      <fieldset>
        <legend>{t('logicalPlaces.create')}</legend>
        <label>{t('hardware.panel')}<select key={JSON.stringify(panels.map(panel => panel.panel_key))} name="panel" defaultValue={activePanelKey}>
          {panels.map(panel => <option key={panel.panel_key} value={panel.panel_key}>{panel.panel_number} · {panel.display_name}</option>)}
        </select></label>
        <MountTypeSelect types={catalogs.MODULE_BAY.types} label="blueprint.endpoint.bayCompatibility" value={bayTypeId} onChange={setBayTypeId} />
        <label>{t('logicalPlaces.count')}<input name="count" inputMode="numeric" defaultValue="1" /></label>
        <button type="submit" className="secondary-action">{t('logicalPlaces.create')}</button>
      </fieldset>
    </form>
  </details>;
}
