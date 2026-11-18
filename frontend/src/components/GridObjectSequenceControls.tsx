import { useI18n } from '../i18n';
import type { GridObjectSequence } from '../topology/savedMapTypes';
import type { LocationGridArrangement } from './useLocationGridArrangement';

export function GridObjectSequenceControls({ parent, labels, arrangement }: {
  parent: string;
  labels?: ReadonlyMap<string, string>;
  arrangement: LocationGridArrangement;
}) {
  const { t } = useI18n();
  const { direction, order } = arrangement.objectSequence(parent);

  const move = (id: string, offset: number) => {
    arrangement.editObjects(parent, sequence => {
      const next = [...sequence.order];
      const index = next.indexOf(id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= next.length) return sequence;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...sequence, order: next };
    });
  };

  return <fieldset className="automatic-location-controls" disabled={arrangement.busy}>
    <legend>{t('gridObjects.title')}</legend>
    <label>{t('autoLocation.direction')}
      <select value={direction} onChange={event => {
        const next = event.target.value as GridObjectSequence['direction'];
        arrangement.editObjects(parent, sequence => ({ ...sequence, direction: next }));
      }}>
        <option value="VERTICAL">{t('autoLocation.vertical')}</option>
        <option value="HORIZONTAL">{t('autoLocation.horizontal')}</option>
      </select>
    </label>
    {order.length > 0 && <ol className="grid-object-sequence">
      {order.map((id, index) => {
        const label = labels?.get(id) ?? t('autoLocation.object', { number: String(index + 1) });
        return <li key={id} className="automatic-location-controls__row">
          <span title={label}>{label}</span>
          <span className="map-utility-panel__actions">
            <button type="button" aria-label={t('gridObjects.up', { name: label })} disabled={!index} onClick={() => move(id, -1)}>↑</button>
            <button type="button" aria-label={t('gridObjects.down', { name: label })} disabled={index === order.length - 1} onClick={() => move(id, 1)}>↓</button>
          </span>
        </li>;
      })}
    </ol>}
  </fieldset>;
}
