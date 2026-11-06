import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import type { BlueprintEditorState } from '../blueprints/editorModel';
import type { LogicalModuleBay, ModuleBay } from '../topology/hardwareModules';

interface Props {
  panels: BlueprintEditorState['panels'];
  activePanelKey: string;
  bays: ModuleBay[];
  onChange: (bays: ModuleBay[]) => void;
}

const groupKey = (panel: string, compatibility: string) => JSON.stringify([panel, compatibility]);

export function LogicalModulePlacesEditor({ panels, activePanelKey, bays, onChange }: Props) {
  const { t } = useI18n();
  const [error, setError] = useState<string>();
  const groups = new Map<string, LogicalModuleBay[]>();
  for (const bay of bays) {
    if (bay.kind !== 'LOGICAL') continue;
    const key = groupKey(bay.panel_key, bay.compatibility);
    const group = groups.get(key);
    if (group) group.push(bay);
    else groups.set(key, [bay]);
  }

  const apply = (panel: string, compatibility: string, rawCount: string, creating = false) => {
    const count = Number(rawCount);
    if (!/^\d+$/.test(rawCount) || !Number.isSafeInteger(count) || (creating && count === 0)) {
      setError(t(creating ? 'logicalPlaces.positiveCount' : 'logicalPlaces.invalidCount'));
      return false;
    }
    if (!panels.some(item => item.panel_key === panel)) {
      setError(t('logicalPlaces.invalidPanel'));
      return false;
    }
    if (creating && (!compatibility.trim() || [...compatibility].length > 255)) {
      setError(t('logicalPlaces.invalidCompatibility'));
      return false;
    }
    const existing = groups.get(groupKey(panel, compatibility)) ?? [];
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
        next.push({ bay_key, display_name, panel_key: panel, compatibility, kind: 'LOGICAL', x: null, y: null, width: null, height: null });
      }
      onChange(next);
    }
    return true;
  };

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (apply(String(fields.get('panel')), String(fields.get('compatibility')), String(fields.get('count')), true)) form.reset();
  };

  return <details className="blueprint-composer__section">
    <summary>{t('logicalPlaces.title')} · {groups.size}</summary>
    <p>{t('logicalPlaces.updateNotice')}</p>
    {error && <p role="alert" className="blueprint-editor__error">{error}</p>}
    {[...groups].map(([key, group]) => {
      const { panel_key, compatibility } = group[0];
      const panel = panels.find(item => item.panel_key === panel_key);
      return <form key={key} onSubmit={event => {
        event.preventDefault();
        apply(panel_key, compatibility, String(new FormData(event.currentTarget).get('count')));
      }}>
        <fieldset>
          <legend>{panel?.panel_number} · {panel?.display_name} / <code style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(compatibility)}</code></legend>
          <label>{t('logicalPlaces.count')}<input key={group.length} name="count" inputMode="numeric" defaultValue={group.length} /></label>
          <button type="submit" className="secondary-action">{t('logicalPlaces.apply')}</button>{' '}
          <button type="button" className="text-action" onClick={() => apply(panel_key, compatibility, '0')}>{t('logicalPlaces.remove')}</button>
        </fieldset>
      </form>;
    })}
    <form onSubmit={create}>
      <fieldset>
        <legend>{t('logicalPlaces.create')}</legend>
        <label>{t('hardware.panel')}<select key={JSON.stringify(panels.map(panel => panel.panel_key))} name="panel" defaultValue={activePanelKey}>
          {panels.map(panel => <option key={panel.panel_key} value={panel.panel_key}>{panel.panel_number} · {panel.display_name}</option>)}
        </select></label>
        <label>{t('hardware.compatibility')}<input name="compatibility" /></label>
        <label>{t('logicalPlaces.count')}<input name="count" inputMode="numeric" defaultValue="1" /></label>
        <button type="submit" className="secondary-action">{t('logicalPlaces.create')}</button>
      </fieldset>
    </form>
  </details>;
}
