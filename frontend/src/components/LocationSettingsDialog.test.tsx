import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import type { LocationDocument } from '../topology/locationTypes';
import type { SavedMap, UniformLocationGrid } from '../topology/savedMapTypes';
import { AutomaticLocationControls } from './AutomaticLocationControls';
import { GridObjectSequenceControls } from './GridObjectSequenceControls';
import { LocationSettingsDialog } from './LocationSettingsDialog';
import { LocationGridSorting } from './LocationGridSorting';
import { useLocationGridArrangement } from './useLocationGridArrangement';

const locations = [
  { location_ref: { entity_id: 'rack' }, name: 'Rack' },
  { location_ref: { entity_id: 'other' }, name: 'Other' },
  { location_ref: { entity_id: 'u10' }, name: 'U10', parent_location_ref: { entity_id: 'rack' } },
  { location_ref: { entity_id: 'u2' }, name: 'U2', parent_location_ref: { entity_id: 'rack' } },
] as LocationDocument[];
const original: UniformLocationGrid = {
  mode: 'uniform_grid', version: 1, hide_empty: false,
  tables: { root: [['rack'], ['other']], rack: [['u10', null, 'u2']], other: [], u10: [], u2: [] },
};
const placements: SavedMap['placements'] = ['a', 'b', 'c', 'd'].map(id => ({
  physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id },
  location_ref: id < 'c' ? locations[0].location_ref : null, positions: {},
}));
const labels = new Map(placements.map(({ physical_object_ref: { entity_id: id } }) => [id, id.toUpperCase()]));

function setup(persist = vi.fn<(settings: UniformLocationGrid) => Promise<void>>().mockResolvedValue(undefined)) {
  const collapseSave = vi.fn();
  function App() {
    const [open, setOpen] = useState(true);
    const [settings, setSettings] = useState(original);
    const arrangement = useLocationGridArrangement({
      automatic: settings, variantId: 'primary', locations, placements,
      onAutomaticLayout: async (next) => { await persist(next); setSettings(next); },
    });
    const variant = { entity_type: 'MapPresentationVariant', entity_id: 'primary' } as const;
    const map: SavedMap = {
      map_ref: { entity_type: 'SavedMap', entity_id: 'map' }, name: 'Test', created_at: '', updated_at: '',
      active_variant_ref: variant,
      variants: [{ variant_ref: variant, name: 'Test', automatic_layout: settings }],
      placements, text_annotations: [],
    };
    const table = (arrangement.preview ?? settings).tables.rack;
    return <>
      <AutomaticLocationControls map={map} locations={locations} objectLabels={labels} arrangement={arrangement} onSave={vi.fn()} />
      <output data-testid="preview">{JSON.stringify(table)}</output>
      <button onClick={() => { arrangement.select('other'); }}>Выбрать Location</button>
      <button onClick={() => arrangement.move('UP')}>Переместить Location</button>
      <button onClick={() => setOpen(true)}>Открыть настройки</button>
      {open && <LocationSettingsDialog name="Rack" arrangement={arrangement} onClose={() => setOpen(false)}
        layout={<><LocationGridSorting parent="rack" table={table} locations={locations} arrangement={arrangement} />
          <GridObjectSequenceControls parent="rack" labels={labels} arrangement={arrangement} /></>}>
        <label><input type="checkbox" />U10</label>
        <button onClick={() => { collapseSave(); setOpen(false); }}>Сохранить</button>
      </LocationSettingsDialog>}
    </>;
  }
  render(<I18nProvider><App /></I18nProvider>);
  return { persist, collapseSave };
}

const button = (name: string) => screen.getByRole('button', { name });
const tab = (name: string) => screen.getByRole('tab', { name });
const saveLayout = () => button('Сохранить компоновку');
const dialogButton = (name: string) => within(screen.getByRole('dialog')).getByRole('button', { name });
const sort = (name = 'По возрастанию') => fireEvent.click(dialogButton(name));
const rackDirection = () => within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Направление' });
const editEquipment = () => {
  fireEvent.click(dialogButton('Выше: B'));
  fireEvent.change(rackDirection(), { target: { value: 'HORIZONTAL' } });
};

it('keeps a combined sort and move pending until one shared write succeeds', async () => {
  let confirm!: () => void;
  const { persist, collapseSave } = setup(vi.fn(() => new Promise<void>(resolve => { confirm = resolve; })));
  fireEvent.click(tab('Компоновка'));
  expect(saveLayout()).toBeDisabled();
  sort('По убыванию');
  expect(saveLayout()).toBeDisabled();
  sort();
  editEquipment();
  fireEvent.click(button('Выше: D'));
  expect(screen.getByLabelText('Расстановка')).toBeChecked();
  expect(saveLayout()).toBeEnabled();
  fireEvent.click(button('Выбрать Location'));
  fireEvent.click(button('Переместить Location'));
  fireEvent.click(saveLayout());
  const pending = button('Сохранение компоновки…');
  expect(pending).toBeDisabled();
  fireEvent.click(pending);
  expect(button('Закрыть')).toBeDisabled();
  expect(persist).toHaveBeenCalledExactlyOnceWith({
    ...original, tables: { ...original.tables, root: [['other'], ['rack']], rack: [['u2', null, 'u10']] },
    object_sequences: { rack: { direction: 'HORIZONTAL', order: ['b', 'a'] }, root: { direction: 'VERTICAL', order: ['d', 'c'] } },
  });
  expect(screen.getByRole('dialog')).toBeVisible();
  await act(async () => confirm());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByLabelText('Расстановка')).not.toBeChecked();
  expect(screen.getByTestId('preview')).toHaveTextContent('[["u2",null,"u10"]]');
  expect(collapseSave).not.toHaveBeenCalled();
});

it('reports a failed write in the open dialog and restores authoritative order', async () => {
  setup(vi.fn().mockRejectedValue(new Error('failed')));
  fireEvent.click(tab('Компоновка'));
  sort();
  editEquipment();
  fireEvent.click(saveLayout());
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Не удалось сохранить компоновку'));
  expect(saveLayout()).toBeDisabled();
  expect(screen.getByTestId('preview')).toHaveTextContent('[["u10",null,"u2"]]');
  expect(rackDirection()).toHaveValue('VERTICAL');
  expect(dialogButton('Выше: A')).toBeDisabled();
});

it('rolls back both edits on dialog Cancel and saves an equipment-only draft on Done', async () => {
  const { persist } = setup();
  fireEvent.click(tab('Компоновка'));
  sort();
  editEquipment();
  fireEvent.click(dialogButton('Отмена'));
  expect(screen.getByTestId('preview')).toHaveTextContent('[["u10",null,"u2"]]');
  expect(rackDirection()).toHaveValue('VERTICAL');
  expect(persist).not.toHaveBeenCalled();
  fireEvent.click(button('Закрыть'));
  fireEvent.click(button('Выше: D'));
  fireEvent.click(button('Готово'));
  await waitFor(() => expect(persist).toHaveBeenCalledExactlyOnceWith({
    ...original, object_sequences: { root: { direction: 'VERTICAL', order: ['d', 'c'] } },
  }));
});

it('keeps the preview across tabs, collapse save and Close until common Cancel', () => {
  const { persist, collapseSave } = setup();
  fireEvent.click(screen.getByLabelText('U10'));
  fireEvent.click(tab('Компоновка'));
  sort();
  fireEvent.click(dialogButton('R1'));
  fireEvent.click(tab('Сворачивание'));
  expect(screen.getByLabelText('U10')).toBeChecked();
  fireEvent.click(tab('Компоновка'));
  expect(dialogButton('R1')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(button('Закрыть'));
  expect(screen.getByTestId('preview')).toHaveTextContent('[["u2",null,"u10"]]');
  fireEvent.click(button('Открыть настройки'));
  fireEvent.click(button('Сохранить'));
  expect(collapseSave).toHaveBeenCalledOnce();
  expect(screen.getByTestId('preview')).toHaveTextContent('[["u2",null,"u10"]]');
  fireEvent.click(button('Отмена'));
  expect(screen.getByTestId('preview')).toHaveTextContent('[["u10",null,"u2"]]');
  expect(persist).not.toHaveBeenCalled();
});
