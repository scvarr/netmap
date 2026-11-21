import { useState } from 'react';
import { useI18n } from '../i18n';
import { moduleMount, type ModuleMount } from '../topology/hardwareModules';
import { MountTypeNotice, MountTypeSelect, type MountCatalogs } from './ModulePortTypeSelect';

export function PlacedModuleBaysCreator({ catalogs, onAdd }: {
  catalogs: MountCatalogs;
  onAdd: (count: number, mount: ModuleMount) => boolean;
}) {
  const { t } = useI18n();
  const [typeId, setTypeId] = useState('');
  const [count, setCount] = useState('1');
  const [failed, setFailed] = useState(false);
  const { types } = catalogs.MODULE_BAY;
  const quantity = Number(count);
  const valid = Number.isInteger(quantity) && quantity >= 1 && quantity <= 256
    && types?.some(type => type.id === typeId && type.is_active);

  return <fieldset className="endpoint-group">
    <legend>{t('moduleMount.placedBays')}</legend>
    <div className="blueprint-editor-controls__row">
      <MountTypeSelect types={types} value={typeId} label="blueprint.endpoint.bayCompatibility"
        onChange={id => { setTypeId(id); setFailed(false); }} />
      <label>{t('logicalPlaces.count')}<input type="number" min="1" max="256" value={count}
        onChange={event => { setCount(event.target.value); setFailed(false); }} /></label>
    </div>
    <div className="module-template-editor__actions">
      <button type="button" className="secondary-action" disabled={!valid}
        onClick={() => setFailed(!onAdd(quantity, moduleMount('MODULE_BAY', typeId)))}>
        {t('moduleMount.addPlacedBays')}
      </button>
    </div>
    <MountTypeNotice catalogs={catalogs} kind="MODULE_BAY" />
    {failed && <p role="alert" className="blueprint-editor__error">{t('blueprint.endpoint.modulePlacementFailed')}</p>}
  </fieldset>;
}
