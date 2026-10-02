import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { addEndpoints, addPanel, createBlueprintRequest, hydrateBlueprintEditorState } from '../blueprints/editorModel';
import type { ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';
import { newBlueprintEditorState, ObjectBlueprintEditor } from './ObjectBlueprintEditor';

describe('authoring workspace contextual region', () => {
  it.each([{}, { ctrlKey: true }, { metaKey: true }])('selects an inactive endpoint in one primary gesture, replacing the old panel selection (%j)', async (modifiers) => {
    const initial = newBlueprintEditorState(); initial.name = 'Device';
    const source = addEndpoints(initial, 'NETWORK_PORT', 2, initial.activePanelKey);
    const second = addPanel(source, 'right');
    const both = addEndpoints(second, 'CONNECTION_POINT', 1, second.activePanelKey);
    const state = { ...both, activePanelKey: source.activePanelKey }; const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Slots" saveLabel="Save" initialState={state} onSave={save} /></MemoryRouter></I18nProvider>);
    const click = (key: string, flags = {}) => { fireEvent.pointerDown(document.querySelector(`[data-slot-key="${key}"]`)!, { button: 0, ...flags }); fireEvent.pointerUp(document.querySelector('svg')!); };
    click(source.slots[0].key); click(source.slots[1].key, { ctrlKey: true });
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(2);
    const target = both.slots.at(-1)!;
    click(target.key, modifiers);
    expect(screen.getByRole('button', { name: 'Панель 2' })).toHaveAttribute('aria-pressed', 'true');
    expect([...document.querySelectorAll('[data-selected="true"]')].map((node) => node.getAttribute('data-slot-key'))).toEqual([target.key]);
    expect(screen.getByLabelText('Название')).toHaveValue(target.display_name);
    expect(within(screen.getByRole('group', { name: 'Положение выделения' })).getByLabelText('X')).toHaveValue(target.rendered_position.x);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0].slots).toEqual(state.slots); expect(save.mock.calls[0][0].panels).toEqual(state.panels);
    fireEvent.pointerDown(document.querySelector(`[data-panel-key="${source.activePanelKey}"] .blueprint-composition-canvas__body`)!, { button: 0 });
    fireEvent.pointerUp(document.querySelector('svg')!);
    expect(screen.getByRole('button', { name: 'Панель 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
    expect(document.querySelector('.blueprint-composer__contextual')).toBeEmptyDOMElement();
  });
  it('retains the contextual rail and groups only the applicable tools for single/multiple selections', async () => {
    const initial = newBlueprintEditorState();
    const source = addEndpoints(initial, 'NETWORK_PORT', 2, initial.activePanelKey);
    const next = addPanel(source, 'right');
    const state = { ...next, activePanelKey: source.activePanelKey };
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Slots" saveLabel="Save" initialState={state} onSave={vi.fn()} /></MemoryRouter></I18nProvider>);
    expect(document.querySelector('.blueprint-composer--authoring-workspace')).toBeInTheDocument();
    expect(document.querySelector('.blueprint-composer__contextual')).toBeEmptyDOMElement();
    expect(screen.queryByRole('group', { name: 'Положение выделения' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Копировать выделение' })).toBeNull();
    expect(document.querySelector('.blueprint-composer__selected')).toBeNull();
    const contextual = document.querySelector('.blueprint-composer__contextual')!;
    const nodes = [...document.querySelectorAll('[data-slot-key]')];
    fireEvent.pointerDown(nodes[0]); fireEvent.pointerUp(document.querySelector('svg')!);
    expect(document.querySelector('.blueprint-composer__contextual')).toBe(contextual);
    expect(contextual).toContainElement(screen.getByRole('group', { name: 'Положение выделения' }));
    expect(contextual).toContainElement(screen.getByRole('group', { name: 'Копировать выделение' }));
    expect(contextual).toContainElement(document.querySelector('.blueprint-composer__selected'));
    expect(within(contextual as HTMLElement).getByLabelText('Название')).toHaveValue('1-1');
    fireEvent.pointerDown(nodes[1], { ctrlKey: true }); fireEvent.pointerUp(document.querySelector('svg')!);
    expect(contextual).toHaveTextContent('Выбрано: 2');
    expect(document.querySelector('.blueprint-composer__selected')).toBeNull();
    expect(contextual).toContainElement(screen.getByRole('group', { name: 'Положение выделения' }));
    expect(contextual).toContainElement(screen.getByRole('group', { name: 'Копировать выделение' }));
    expect(document.querySelector('.blueprint-composer__properties')).toContainElement(screen.getByRole('button', { name: 'Редактировать связи · 0' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.blueprint-composer__contextual')).toBeEmptyDOMElement();
    expect(document.querySelector('.blueprint-composer__contextual')).toBe(contextual);
    fireEvent.pointerDown(nodes[0]); fireEvent.pointerUp(document.querySelector('svg')!);
    await userEvent.click(screen.getByRole('button', { name: 'Панель 2' }));
    expect(document.querySelector('.blueprint-composer__contextual')).toBeEmptyDOMElement();
  });
});

describe('internal links on demand', () => {
  const fixture = (count: number) => {
    const initial = newBlueprintEditorState(); initial.name = 'Device';
    const source = addEndpoints(initial, 'CONNECTION_POINT', Math.max(3, count), initial.activePanelKey);
    const destination = addPanel(source, 'below');
    const copies = addEndpoints(destination, 'CONNECTION_POINT', Math.max(3, count), destination.activePanelKey);
    return { ...copies, individualLinks: source.slots.slice(0, count).map((slot, index) => ({ from_slot_key: slot.key, to_slot_key: copies.slots[source.slots.length + index].key })) };
  };
  it.each([0, 4, 24])('keeps %i links out of the workspace and renders both selectors per dialog row', async (count) => {
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Slots" saveLabel="Save" initialState={fixture(count)} onSave={vi.fn()} /></MemoryRouter></I18nProvider>);
    const entry = screen.getByRole('button', { name: `Редактировать связи · ${count}` });
    expect(entry).toBeEnabled();
    expect(document.querySelectorAll('.blueprint-composer__workspace .blueprint-composer__link')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Добавить связь' })).toBeNull();
    await userEvent.click(entry);
    const dialog = screen.getByRole('dialog', { name: 'Внутренние связи' });
    const rows = dialog.querySelectorAll('.blueprint-composer__link');
    expect(rows).toHaveLength(count);
    for (const row of rows) {
      expect(within(row as HTMLElement).getAllByRole('combobox')).toHaveLength(2);
      expect(within(row as HTMLElement).getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
    }
    if (count) {
      expect(within(rows[0] as HTMLElement).getAllByRole('option', { name: '1-1 · Панель 1' })).toHaveLength(2);
      expect(within(rows[0] as HTMLElement).getAllByRole('option', { name: '2-1 · Панель 2' })).toHaveLength(2);
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(entry).toHaveFocus();
  });
  it('edits, adds and deletes ordinary links locally, retaining changes after close and Blueprint save', async () => {
    const initial = fixture(2); const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Slots" saveLabel="Save" initialState={initial} onSave={save} /></MemoryRouter></I18nProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Редактировать связи · 2' }));
    const dialog = screen.getByRole('dialog');
    const edited = { from_slot_key: initial.slots[2].key, to_slot_key: initial.slots[5].key };
    await userEvent.selectOptions(within(dialog).getByLabelText('Первый порт внутренней связи 1'), edited.from_slot_key);
    await userEvent.selectOptions(within(dialog).getByLabelText('Второй порт внутренней связи 1'), edited.to_slot_key);
    await userEvent.click(within(dialog.querySelectorAll('.blueprint-composer__link')[1] as HTMLElement).getByRole('button', { name: 'Удалить' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить связь' }));
    expect(dialog.querySelectorAll('.blueprint-composer__link')).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    await userEvent.click(screen.getByRole('button', { name: 'Редактировать связи · 2' }));
    expect(screen.getByLabelText('Первый порт внутренней связи 1')).toHaveValue(edited.from_slot_key);
    expect(screen.getByLabelText('Второй порт внутренней связи 1')).toHaveValue(edited.to_slot_key);
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(createBlueprintRequest(save.mock.calls[0][0]).request?.internal_links).toEqual([edited, { from_slot_key: initial.slots[0].key, to_slot_key: initial.slots[1].key }]);
  });
  it('can create the first link from the zero-count entry', async () => {
    const initial = fixture(0); const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Slots" saveLabel="Save" initialState={initial} onSave={save} /></MemoryRouter></I18nProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Редактировать связи · 0' }));
    await userEvent.click(screen.getByRole('button', { name: 'Добавить связь' }));
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.getByRole('button', { name: 'Редактировать связи · 1' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(createBlueprintRequest(save.mock.calls[0][0]).request?.internal_links).toHaveLength(1);
  });
});

describe('copy selection controls', () => {
  const fixture = (count = 3) => {
    const initial = newBlueprintEditorState(); initial.name = 'Device';
    const source = addEndpoints(initial, 'NETWORK_PORT', count, initial.activePanelKey);
    source.slots[0] = { ...source.slots[0], display_name: 'MGMT', rendered_position: { x: .25, y: .75 } };
    const panels = addPanel(source, 'right');
    return { ...panels, activePanelKey: source.activePanelKey };
  };
  it.each([false, true])('copies, selects destination slots and saves/reopens ordinary data (continuity %s)', async (continuity) => {
    const initial = fixture(); const save = vi.fn().mockResolvedValue(undefined);
    const view = render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Slots" saveLabel="Save" initialState={initial} onSave={save} /></MemoryRouter></I18nProvider>);
    expect(screen.queryByRole('group', { name: 'Копировать выделение' })).toBeNull();
    const nodes = [...document.querySelectorAll('[data-slot-key]')];
    fireEvent.pointerDown(nodes[0]); fireEvent.pointerUp(document.querySelector('svg')!);
    for (const node of nodes.slice(1)) { fireEvent.pointerDown(node, { ctrlKey: true }); fireEvent.pointerUp(document.querySelector('svg')!); }
    const copy = within(screen.getByRole('group', { name: 'Копировать выделение' }));
    expect(copy.getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual([initial.panels[1].panel_key]);
    expect(copy.getByRole('option')).toHaveTextContent('2 · Панель 2');
    expect(copy.getByLabelText('Создать связи 1:1')).not.toBeChecked();
    if (continuity) await userEvent.click(copy.getByLabelText('Создать связи 1:1'));
    fireEvent.contextMenu(nodes[0]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'По горизонтали' }));
    expect(screen.getByRole('group', { name: 'Диапазон распределения' })).toBeInTheDocument();
    // Keep the stale transient menu open to exercise copy's panel-switch cleanup.
    fireEvent.click(copy.getByRole('button', { name: 'Копировать' }));
    expect(screen.getByRole('button', { name: 'Панель 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Диапазон распределения' })).toBeNull();
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(3);
    expect(document.querySelector('[data-slot-key="' + initial.slots[0].key + '"]')).not.toHaveAttribute('data-selected', 'true');
    expect(screen.getByLabelText('Создать связи 1:1')).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const request = createBlueprintRequest(save.mock.calls[0][0]).request!;
    const copies = request.slots.filter((slot) => slot.panel_key === initial.panels[1].panel_key);
    expect(copies.map((slot) => slot.display_name)).toEqual(['2-1', '2-2', '2-3']);
    expect(copies[0].rendered_position).toEqual({ x: .25, y: .75 });
    expect(request.slots.slice(0, 3)).toEqual(initial.slots);
    expect(request.internal_links).toEqual(continuity ? initial.slots.map((slot, index) => ({ from_slot_key: slot.key, to_slot_key: copies[index].key })) : []);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: `Редактировать связи · ${continuity ? 3 : 0}` })).toBeInTheDocument();
    if (continuity) {
      expect(document.querySelectorAll('.blueprint-composition-canvas__link')).toHaveLength(3);
      await userEvent.click(screen.getByRole('button', { name: 'Редактировать связи · 3' }));
      expect(screen.getByLabelText('Первый порт внутренней связи 1')).toHaveValue(initial.slots[0].key);
      expect(screen.getByLabelText('Второй порт внутренней связи 1')).toHaveValue(copies[0].key);
      expect(screen.getAllByRole('option', { name: '2-1 · Панель 2' })).toHaveLength(6);
      await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    }
    // Existing numeric, layout, drag, individual rename and deletion tools act on copies.
    const position = within(screen.getByRole('group', { name: 'Положение выделения' }));
    fireEvent.change(position.getByLabelText('X'), { target: { value: '.5' } }); fireEvent.blur(position.getByLabelText('X'));
    const copiedNode = document.querySelector(`[data-slot-key="${copies[0].key}"]`)!;
    fireEvent.contextMenu(copiedNode); await userEvent.click(screen.getByRole('menuitem', { name: 'В один ряд' }));
    const canvas = document.querySelector('svg')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 375 }) });
    fireEvent.pointerDown(copiedNode, { clientX: 600, clientY: 100 }); fireEvent.pointerMove(canvas, { clientX: 650, clientY: 130 }); fireEvent.pointerUp(canvas);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const changed = createBlueprintRequest(save.mock.calls[1][0]).request!;
    expect(changed.slots.slice(0, 3)).toEqual(initial.slots);
    expect(changed.slots.at(-1)?.rendered_position).not.toEqual(copies.at(-1)?.rendered_position);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(copiedNode); fireEvent.pointerUp(canvas);
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Renamed copy' } });
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(document.querySelector(`[data-slot-key="${copies[0].key}"]`)).toBeNull();
    view.unmount();
    const reopened = hydrateBlueprintEditorState({ ...request, schema_version: '2.0', next_panel_number: 3, version_number: 1,
      blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'bp' },
      version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v1' },
    } satisfies ObjectBlueprintVersionDocument);
    expect(reopened.slots).toEqual(request.slots); expect(reopened.individualLinks).toEqual(request.internal_links);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Slots" saveLabel="Save" initialState={reopened} onSave={save} /></MemoryRouter></I18nProvider>);
    expect(document.querySelectorAll('[data-slot-key]')).toHaveLength(6);
    await userEvent.click(screen.getByRole('button', { name: 'Панель 2' }));
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Копировать выделение' })).toBeNull();
  });
  it('hides copy for a single panel and disables the entire operation on capacity overflow', async () => {
    const initial = newBlueprintEditorState();
    const view = render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Slots" saveLabel="Save" initialState={initial} onSave={vi.fn()} /></MemoryRouter></I18nProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    expect(screen.queryByRole('group', { name: 'Копировать выделение' })).toBeNull(); view.unmount();
    const state = fixture(2); const destination = state.panels[1].panel_key;
    const populated = addEndpoints({ ...state, activePanelKey: destination }, 'NETWORK_PORT', 256, destination);
    const full = addEndpoints(populated, 'NETWORK_PORT', 143, destination);
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Slots" saveLabel="Save" initialState={{ ...full, activePanelKey: state.activePanelKey }} onSave={save} /></MemoryRouter></I18nProvider>);
    for (const slot of state.slots) { fireEvent.pointerDown(document.querySelector(`[data-slot-key="${slot.key}"]`)!, { ctrlKey: true }); fireEvent.pointerUp(document.querySelector('svg')!); }
    expect(screen.getByRole('button', { name: 'Копировать' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('недостаточно места');
    fireEvent.click(screen.getByRole('button', { name: 'Копировать' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0].slots).toEqual(full.slots);
    expect(save.mock.calls[0][0].individualLinks).toEqual([]);
    expect(screen.getByRole('button', { name: 'Панель 1' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('uses the chosen destination and clears copy settings and spatial UI on ordinary panel switch', async () => {
    const source = fixture(1); const third = addPanel({ ...source, activePanelKey: source.panels[1].panel_key }, 'below');
    const initial = { ...third, activePanelKey: source.activePanelKey }; const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Slots" saveLabel="Save" initialState={initial} onSave={save} /></MemoryRouter></I18nProvider>);
    const selectSource = () => { fireEvent.pointerDown(document.querySelector(`[data-slot-key="${source.slots[0].key}"]`)!); fireEvent.pointerUp(document.querySelector('svg')!); };
    selectSource();
    expect(screen.getByLabelText('Панель назначения').querySelectorAll('option')).toHaveLength(2);
    await userEvent.click(screen.getByLabelText('Создать связи 1:1'));
    fireEvent.contextMenu(document.querySelector('[data-selected="true"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Панель 2' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Положение выделения' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Панель 1' })); selectSource();
    expect(screen.getByLabelText('Создать связи 1:1')).not.toBeChecked();
    await userEvent.selectOptions(screen.getByLabelText('Панель назначения'), third.activePanelKey);
    await userEvent.click(screen.getByRole('button', { name: 'Копировать' }));
    expect(screen.getByRole('button', { name: 'Панель 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
    expect(screen.getByLabelText('Название')).toHaveValue('3-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const request = createBlueprintRequest(save.mock.calls[0][0]).request!;
    expect(request.slots.at(-1)?.panel_key).toBe(third.activePanelKey);
    expect(Object.keys(request).sort()).toEqual(['body', 'internal_links', 'name', 'panels', 'slots']);
  });
});

describe('minimal direct endpoint editor', () => {
  const renderEditor = () => render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={newBlueprintEditorState()} onSave={vi.fn()} /></MemoryRouter></I18nProvider>);
  it('shows exact local X/Y for one endpoint and refreshes them after drag and layout', async () => {
    const initial = newBlueprintEditorState(); initial.name = 'Device';
    initial.slots = [{ key: 'a', display_name: 'A', kind: 'NETWORK_PORT', panel_key: initial.activePanelKey, rendered_position: { x: .2, y: .3 } }];
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={initial} onSave={save} /></MemoryRouter></I18nProvider>);
    expect(screen.queryByRole('group', { name: 'Положение выделения' })).toBeNull();
    const canvas = document.querySelector('.blueprint-composition-canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 375 }) });
    const marker = document.querySelector('[data-slot-key="a"]')!;
    fireEvent.pointerDown(marker, { clientX: 200, clientY: 112.5 }); fireEvent.pointerUp(canvas);
    const position = within(screen.getByRole('group', { name: 'Положение выделения' }));
    const x = position.getByLabelText('X') as HTMLInputElement; const y = position.getByLabelText('Y') as HTMLInputElement;
    expect([x.value, y.value]).toEqual(['0.2', '0.3']);
    fireEvent.change(x, { target: { value: '0.6254' } }); fireEvent.blur(x);
    await userEvent.click(y);
    fireEvent.change(y, { target: { value: '0.45' } }); fireEvent.keyDown(y, { key: 'Enter' });
    expect([x.value, y.value]).toEqual(['0.6254', '0.45']);
    fireEvent.pointerDown(marker, { clientX: 625.4, clientY: 168.75 });
    fireEvent.pointerMove(canvas, { clientX: 725.4, clientY: 168.75 }); fireEvent.pointerUp(canvas);
    expect(x.value).toBe('0.7254');
    fireEvent.contextMenu(marker);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Слева' }));
    expect(x.value).toBe('0.008');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(createBlueprintRequest(save.mock.calls[0][0]).request?.slots[0].rendered_position).toMatchObject({ y: .45 });
  });

  it('does not round stored local coordinates when a displayed numeric value is left unchanged', async () => {
    const initial = newBlueprintEditorState(); initial.name = 'Device';
    initial.slots = [{ key: 'a', display_name: 'A', kind: 'NETWORK_PORT', panel_key: initial.activePanelKey, rendered_position: { x: .1234567, y: .7654321 } }];
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={initial} onSave={save} /></MemoryRouter></I18nProvider>);
    fireEvent.pointerDown(document.querySelector('[data-slot-key="a"]')!);
    fireEvent.pointerUp(document.querySelector('.blueprint-composition-canvas')!);
    const position = within(screen.getByRole('group', { name: 'Положение выделения' }));
    const x = position.getByLabelText('X') as HTMLInputElement;
    expect(x.value).toBe('0.1235');
    fireEvent.focus(x); fireEvent.blur(x);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(createBlueprintRequest(save.mock.calls[0][0]).request?.slots[0].rendered_position).toEqual({ x: .1234567, y: .7654321 });
  });

  it('edits multi-selection center, clamps it, and clears controls on panel change', async () => {
    const initial = newBlueprintEditorState(); initial.name = 'Device';
    initial.slots = [
      { key: 'a', display_name: 'A', kind: 'NETWORK_PORT', panel_key: initial.activePanelKey, rendered_position: { x: .2, y: .2 } },
      { key: 'b', display_name: 'B', kind: 'NETWORK_PORT', panel_key: initial.activePanelKey, rendered_position: { x: .4, y: .6 } },
      { key: 'c', display_name: 'C', kind: 'NETWORK_PORT', panel_key: initial.activePanelKey, rendered_position: { x: .8, y: .8 } },
    ];
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={initial} onSave={save} /></MemoryRouter></I18nProvider>);
    const nodes = [...document.querySelectorAll('[data-slot-key]')];
    fireEvent.pointerDown(nodes[0]); fireEvent.pointerUp(document.querySelector('.blueprint-composition-canvas')!);
    fireEvent.pointerDown(nodes[1], { ctrlKey: true });
    const position = within(screen.getByRole('group', { name: 'Положение выделения' }));
    const x = position.getByLabelText('X') as HTMLInputElement; const y = position.getByLabelText('Y') as HTMLInputElement;
    expect([x.value, y.value]).toEqual(['0.3', '0.4']);
    fireEvent.change(x, { target: { value: '0.5' } }); fireEvent.blur(x);
    expect([x.value, y.value]).toEqual(['0.5', '0.4']);
    fireEvent.change(x, { target: { value: '1' } }); fireEvent.blur(x);
    expect(x.value).toBe('0.9');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const slots = createBlueprintRequest(save.mock.calls[0][0]).request!.slots;
    expect(slots.map((slot) => slot.rendered_position.x)).toEqual([.8, 1, .8]);
    expect(slots.map((slot) => slot.rendered_position.y)).toEqual([.2, .6, .8]);
    await userEvent.click(screen.getByRole('button', { name: 'Добавить справа' }));
    expect(screen.queryByRole('group', { name: 'Положение выделения' })).toBeNull();
  });
  it('uses moved and resized geometry for adjacent creation and saves exact negative rectangles', async () => {
    const initial = newBlueprintEditorState(); initial.name = 'Device';
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={initial} onSave={save} /></MemoryRouter></I18nProvider>);
    const canvas = document.querySelector('.blueprint-composition-canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 375 }) });
    fireEvent.pointerDown(document.querySelector('[data-panel-resize="e"]')!, { button: 0, clientX: 1000, clientY: 180 });
    fireEvent.pointerMove(canvas, { clientX: 1500, clientY: 180 });
    fireEvent.pointerUp(canvas);
    expect(screen.getByLabelText('Пропорция ширины корпуса')).toHaveValue(240);
    fireEvent.pointerDown(document.querySelector('[data-panel-move-border]')!, { button: 0, clientX: 500, clientY: 180 });
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 80 });
    fireEvent.pointerUp(canvas);
    await userEvent.click(screen.getByRole('button', { name: 'Добавить сверху' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const request = createBlueprintRequest(save.mock.calls[0][0]).request!;
    expect(request.panels[0]).toMatchObject({ x: -24, y: -24, width: 240, height: 60 });
    expect(request.panels[1]).toMatchObject({ x: -24, y: -84, width: 240, height: 60, panel_number: 2 });
    expect(request.body).toMatchObject({ width: 240, height: 120 });
  });
  it('edits and saves a loaded multi-panel version without flattening panels', async () => {
    const initial = newBlueprintEditorState();
    initial.panels.push({ ...initial.panels[0], panel_key: 'second', panel_number: 2, display_name: 'Second', x: 160 });
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={initial} onSave={save} /></MemoryRouter></I18nProvider>);
    expect(document.querySelectorAll('[data-panel-key]')).toHaveLength(2);
    expect(screen.getByLabelText('Пропорция ширины корпуса')).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Название шаблона'), 'Panel');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledOnce();
    expect(createBlueprintRequest(save.mock.calls[0][0]).request?.panels).toHaveLength(2);
  });
  it('activates a panel, clears selection, and adds endpoints only there', async () => {
    const initial = newBlueprintEditorState();
    initial.name = 'Device';
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={initial} onSave={save} /></MemoryRouter></I18nProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Добавить слева' }));
    expect(document.querySelectorAll('[data-panel-key]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Панель 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.blueprint-composition-canvas text')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    expect(screen.getByRole('button', { name: 'Удалить пустую панель' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Редактировать связи ·/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Добавить связь' }));
    expect(screen.getAllByRole('option', { name: '1-1 · Панель 1' })).toHaveLength(2);
    expect(screen.getAllByRole('option', { name: '2-1 · Панель 2' })).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const request = createBlueprintRequest(save.mock.calls[0][0]).request!;
    expect(request.panels.map((panel) => panel.x)).toEqual([0, -160]);
    expect(request.body.width).toBe(320);
    expect(request.slots.map((slot) => slot.display_name)).toEqual(['1-1', '2-1']);
  });
  it('adds, selects, renames, moves, links, and deletes slots without a library', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={newBlueprintEditorState()} onSave={save} /></MemoryRouter></I18nProvider>);
    await userEvent.type(screen.getByLabelText('Название шаблона'), 'Panel');
    fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '2' } });
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    expect(document.querySelectorAll('[data-slot-key]')).toHaveLength(2);
    const keys = [...document.querySelectorAll('[data-slot-key]')].map((node) => node.getAttribute('data-slot-key'));
    expect(new Set(keys).size).toBe(2);
    const canvas = document.querySelector('.blueprint-composition-canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 375 }) });
    fireEvent.pointerDown(document.querySelectorAll('[data-slot-key]')[0], { clientX: 25, clientY: 9.375 });
    fireEvent.pointerMove(canvas, { clientX: 500, clientY: 187.5 });
    fireEvent.pointerUp(canvas);
    fireEvent.pointerDown(document.querySelectorAll('[data-slot-key]')[0], { clientX: 500, clientY: 187.5 });
    fireEvent.pointerUp(canvas);
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Management' } });
    await userEvent.click(screen.getByRole('button', { name: /Редактировать связи ·/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Добавить связь' }));
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledOnce();
    const state = save.mock.calls[0][0];
    const request = createBlueprintRequest(state).request!;
    expect(request.slots[0].display_name).toBe('Management');
    expect(request.slots[0].rendered_position).toEqual({ x: .5, y: .5 });
    expect(request.internal_links).toHaveLength(1);
    await userEvent.click(screen.getAllByRole('button', { name: 'Удалить' }).at(-1)!);
    expect(document.querySelectorAll('[data-slot-key]')).toHaveLength(1);
  });

  it('places new points on initial panel and saves their exact snapshot', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={newBlueprintEditorState()} onSave={save} /></MemoryRouter></I18nProvider>);
    await userEvent.type(screen.getByLabelText('Название шаблона'), 'Panel');
    await userEvent.selectOptions(screen.getByLabelText('Тип'), 'CONNECTION_POINT');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const request = createBlueprintRequest(save.mock.calls[0][0]).request!;
    expect(request.slots).toEqual([expect.objectContaining({ kind: 'CONNECTION_POINT', panel_key: request.panels[0].panel_key, display_name: '1-1' })]);
    expect(screen.queryByRole('button', { name: 'Задняя' })).not.toBeInTheDocument();
  });
  it('resizes the only panel through the existing dimensions controls', async () => {
    const initial = newBlueprintEditorState();
    initial.name = 'Device';
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={initial} onSave={save} /></MemoryRouter></I18nProvider>);
    fireEvent.change(screen.getByLabelText('Пропорция ширины корпуса'), { target: { value: '240' } });
    fireEvent.change(screen.getByLabelText('Пропорция высоты корпуса'), { target: { value: '80' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const request = createBlueprintRequest(save.mock.calls[0][0]).request!;
    expect(request.panels[0]).toMatchObject({ width: 240, height: 80 });
    expect(request.body).toMatchObject({ width: 240, height: 80 });
  });

  it('selects the newly added set, toggles members, and keeps layout actions off the permanent surface', async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '3' } });
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    const nodes = [...document.querySelectorAll('[data-slot-key]')];
    expect(nodes.map((node) => node.getAttribute('data-selected'))).toEqual(['true', 'true', 'true']);
    expect(screen.queryByLabelText('Название')).toBeNull();
    expect(screen.getByText('Выбрано: 3')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'В два ряда' })).toBeNull();
    fireEvent.contextMenu(nodes[0]);
    expect(screen.getByRole('menuitem', { name: 'В два ряда' }).hasAttribute('disabled')).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(nodes[0], { ctrlKey: true });
    expect(nodes[0].getAttribute('data-selected')).toBe('false');
    fireEvent.pointerDown(nodes[1], { metaKey: true });
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
    expect(screen.getByLabelText('Название')).toBeTruthy();
    fireEvent.pointerDown(nodes[0]);
    fireEvent.pointerUp(document.querySelector('.blueprint-composition-canvas')!);
    expect(nodes.map((node) => node.getAttribute('data-selected'))).toEqual(['true', 'false', 'false']);
    expect(screen.queryByRole('button', { name: 'Задняя' })).not.toBeInTheDocument();
  });

  it('marquee selects centers, group drag preserves offsets, and multi-delete clears links', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={newBlueprintEditorState()} onSave={save} /></MemoryRouter></I18nProvider>);
    await userEvent.type(screen.getByLabelText('Название шаблона'), 'Panel');
    fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '3' } });
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    await userEvent.click(screen.getByRole('button', { name: /Редактировать связи ·/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Добавить связь' }));
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    const canvas = document.querySelector('.blueprint-composition-canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 375 }) });
    const body = document.querySelector('.blueprint-composition-canvas__body')!;
    fireEvent.pointerDown(body, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { clientX: 85, clientY: 30 });
    expect(document.querySelector('.blueprint-composition-canvas__marquee')).toBeTruthy();
    fireEvent.pointerUp(canvas);
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(2);
    const nodes = [...document.querySelectorAll('[data-slot-key]')];
    const before = nodes.map((node) => Number(node.querySelector('[data-endpoint-marker]')!.getAttribute('cx')));
    fireEvent.pointerDown(nodes[0], { clientX: 25, clientY: 9.375 });
    expect(document.querySelector('.blueprint-composition-canvas__marquee')).toBeNull();
    fireEvent.pointerMove(canvas, { clientX: 125, clientY: 9.375 });
    fireEvent.pointerUp(canvas);
    const after = nodes.map((node) => Number(node.querySelector('[data-endpoint-marker]')!.getAttribute('cx')));
    expect(after[0] - before[0]).toBeCloseTo(100);
    expect(after[1] - before[1]).toBeCloseTo(100);
    expect(after[2]).toBeCloseTo(before[2]);
    fireEvent.contextMenu(nodes[0]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Удалить выбранные' }));
    expect(document.querySelectorAll('[data-slot-key]')).toHaveLength(1);
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save.mock.calls[0][0].individualLinks).toEqual([]);
  });

  it('drags an unselected endpoint alone and enables three-point tools only at three', async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '2' } });
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    fireEvent.contextMenu(document.querySelector('[data-slot-key]')!);
    expect(screen.getByRole('menuitem', { name: 'В одну горизонтальную линию' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'По горизонтали' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('menuitem', { name: 'В два ряда' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    const canvas = document.querySelector('.blueprint-composition-canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 375 }) });
    const nodes = [...document.querySelectorAll('[data-slot-key]')];
    fireEvent.pointerDown(nodes[0], { clientX: 25, clientY: 9.375 });
    fireEvent.pointerUp(canvas);
    const before = nodes.map((node) => Number(node.querySelector('[data-endpoint-marker]')!.getAttribute('cx')));
    fireEvent.pointerDown(nodes[1], { clientX: 75, clientY: 9.375 });
    expect(nodes.map((node) => node.getAttribute('data-selected'))).toEqual(['false', 'true']);
    fireEvent.pointerMove(canvas, { clientX: 175, clientY: 9.375 });
    fireEvent.pointerUp(canvas);
    const after = nodes.map((node) => Number(node.querySelector('[data-endpoint-marker]')!.getAttribute('cx')));
    expect(after).toEqual([before[0], before[1] + 100]);
  });

  it('right-clicks the current selection, replaces it for an unselected endpoint, and positions without collapse', async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '3' } });
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    const nodes = [...document.querySelectorAll('[data-slot-key]')];
    fireEvent.contextMenu(nodes[0]);
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(3);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.pointerDown(nodes[0]);
    fireEvent.pointerUp(document.querySelector('.blueprint-composition-canvas')!);
    fireEvent.contextMenu(nodes[1]);
    expect(nodes.map((node) => node.getAttribute('data-selected'))).toEqual(['false', 'true', 'false']);
    expect(screen.getByRole('menuitem', { name: 'Слева' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'В одну горизонтальную линию' }).hasAttribute('disabled')).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.pointerDown(nodes[0], { ctrlKey: true });
    fireEvent.contextMenu(nodes[0]);
    const before = nodes.slice(0, 2).map((node) => Number(node.querySelector('[data-endpoint-marker]')!.getAttribute('cx')));
    await userEvent.click(screen.getByRole('menuitem', { name: 'По центру горизонтали' }));
    const after = nodes.slice(0, 2).map((node) => Number(node.querySelector('[data-endpoint-marker]')!.getAttribute('cx')));
    expect((after[0] + after[1]) / 2).toBeCloseTo(500);
    expect(after[1] - after[0]).toBeCloseTo(before[1] - before[0]);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(nodes[0]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'В одну вертикальную линию' }));
    expect(Number(nodes[0].querySelector('[data-endpoint-marker]')!.getAttribute('cx'))).toBeCloseTo(Number(nodes[1].querySelector('[data-endpoint-marker]')!.getAttribute('cx')));
  });

  it('clears selection on empty click and Escape, and Delete respects form focus', async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '2' } });
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    const nodes = [...document.querySelectorAll('[data-slot-key]')];
    const canvas = document.querySelector('.blueprint-composition-canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 375 }) });
    const body = document.querySelector('.blueprint-composition-canvas__body')!;
    fireEvent.pointerDown(body, { clientX: 400, clientY: 180 });
    fireEvent.pointerUp(canvas);
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
    fireEvent.pointerDown(nodes[0], { clientX: 25, clientY: 9.375 });
    fireEvent.pointerUp(canvas);
    fireEvent.keyDown(screen.getByLabelText('Название'), { key: 'Delete' });
    expect(document.querySelectorAll('[data-slot-key]')).toHaveLength(2);
    fireEvent.contextMenu(nodes[0]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
    fireEvent.pointerDown(nodes[0], { clientX: 25, clientY: 9.375 });
    fireEvent.pointerUp(canvas);
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(document.querySelectorAll('[data-slot-key]')).toHaveLength(1);
  });

  it('shows only active snap guides during group drag and clears them on finish or cancel', () => {
    const state = { ...newBlueprintEditorState(), slots: [
      { key: 'a', display_name: 'A', kind: 'NETWORK_PORT' as const, panel_key: 'one', rendered_position: { x: .1, y: .2 } },
      { key: 'b', display_name: 'B', kind: 'NETWORK_PORT' as const, panel_key: 'one', rendered_position: { x: .2, y: .2 } },
      { key: 'c', display_name: 'C', kind: 'NETWORK_PORT' as const, panel_key: 'one', rendered_position: { x: .6, y: .4 } },
    ] };
    state.panels[0].panel_key = 'one';
    state.activePanelKey = 'one';
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={state} onSave={vi.fn()} /></MemoryRouter></I18nProvider>);
    const canvas = document.querySelector('.blueprint-composition-canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 375 }) });
    const nodes = [...document.querySelectorAll('[data-slot-key]')];
    fireEvent.pointerDown(nodes[0], { clientX: 100, clientY: 75 });
    fireEvent.pointerUp(canvas);
    fireEvent.pointerDown(nodes[1], { ctrlKey: true });
    fireEvent.pointerDown(nodes[0], { clientX: 100, clientY: 75 });
    fireEvent.pointerMove(canvas, { clientX: 100, clientY: 148.125 });
    expect(document.querySelector('[data-guide-y]')).toBeTruthy();
    expect(document.querySelector('[data-guide-x]')).toBeNull();
    fireEvent.pointerUp(canvas);
    expect(document.querySelector('[data-guide-y]')).toBeNull();
    fireEvent.pointerDown(nodes[0], { clientX: 100, clientY: 150 });
    fireEvent.pointerMove(canvas, { clientX: 450, clientY: 187.5 });
    expect(document.querySelector('[data-guide-x]')).toBeTruthy();
    fireEvent.pointerCancel(canvas);
    expect(document.querySelector('[data-guide-x]')).toBeNull();
  });

  it('does not stack 14 new ports when aligning them into either line from the context menu', async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '14' } });
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    const nodes = [...document.querySelectorAll('[data-slot-key]')];
    const centers = () => nodes.map((node) => {
      const marker = node.querySelector('[data-endpoint-marker]')!;
      return `${marker.getAttribute('cx')},${marker.getAttribute('cy')}`;
    });
    fireEvent.contextMenu(nodes[0]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'В одну вертикальную линию' }));
    expect(new Set(centers()).size).toBe(14);
    fireEvent.contextMenu(nodes[0]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'В одну горизонтальную линию' }));
    expect(new Set(centers()).size).toBe(14);
  });

  it('uses screen-space row spacing for four ports on a 10:1 panel', async () => {
    const state = { ...newBlueprintEditorState(), width: 10, height: 1 };
    state.panels[0] = { ...state.panels[0], width: 10, height: 1 };
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={state} onSave={vi.fn()} /></MemoryRouter></I18nProvider>);
    fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '4' } });
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    const canvas = document.querySelector('.blueprint-composition-canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 850, height: 550 }) });
    fireEvent.contextMenu(document.querySelector('[data-slot-key]')!);
    await userEvent.click(screen.getByRole('menuitem', { name: 'В два ряда' }));
    const ys = [...new Set([...document.querySelectorAll('[data-endpoint-marker]')].map((marker) => Number(marker.getAttribute('cy'))))].sort((a, b) => a - b);
    expect(ys).toHaveLength(2);
    expect((ys[1] - ys[0]) * .85).toBeGreaterThanOrEqual(18 - 1e-9);
  });

  it('offers an explicit horizontal or vertical distribution range and a full-body option', async () => {
    const state = { ...newBlueprintEditorState(), slots: [0, 1, 2, 3].map((index) => ({
      key: `slot-${index}`, display_name: `Port ${index}`, kind: 'NETWORK_PORT' as const, panel_key: 'one',
      rendered_position: { x: .2 + index * .1, y: .3 + index * .05 },
    })) };
    state.panels[0].panel_key = 'one';
    state.activePanelKey = 'one';
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={state} onSave={vi.fn()} /></MemoryRouter></I18nProvider>);
    const canvas = document.querySelector('.blueprint-composition-canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 375 }) });
    const nodes = [...document.querySelectorAll('[data-slot-key]')];
    const values = (axis: 'cx' | 'cy') => nodes.map((node) => Number(node.querySelector('[data-endpoint-marker]')!.getAttribute(axis)));
    fireEvent.pointerDown(nodes[0]);
    fireEvent.pointerUp(canvas);
    for (const node of nodes.slice(1)) fireEvent.pointerDown(node, { ctrlKey: true });
    const originalY = values('cy');
    fireEvent.contextMenu(nodes[0]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'По горизонтали' }));
    expect(screen.getByRole('group', { name: 'Диапазон распределения' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ширина, % корпуса'), { target: { value: '60' } });
    await userEvent.click(screen.getByRole('button', { name: 'Распределить' }));
    expect(values('cx').at(-1)! - values('cx')[0]).toBeCloseTo(600);
    expect(values('cy')).toEqual(originalY);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(nodes[0]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'По вертикали' }));
    await userEvent.click(screen.getByLabelText('На всю высоту'));
    expect(screen.getByLabelText('Высота, % корпуса').hasAttribute('disabled')).toBe(true);
    const originalX = values('cx');
    await userEvent.click(screen.getByRole('button', { name: 'Распределить' }));
    expect(values('cy').at(-1)! - values('cy')[0]).toBeCloseTo(359);
    expect(values('cx')).toEqual(originalX);
  });
});
