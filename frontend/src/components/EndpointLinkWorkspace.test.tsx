import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { I18nProvider } from '../i18n';
import { newBlueprintEditorState } from '../pages/BaseTemplateEditor';
import { addEndpoints, addPanel, type BlueprintEditorState } from '../blueprints/editorModel';
import { EndpointLinkWorkspace } from './EndpointLinkWorkspace';

function setup(count = 2) {
  let initial = newBlueprintEditorState();
  initial = addEndpoints(initial, 'CONNECTION_POINT', count, initial.activePanelKey);
  const first = initial.activePanelKey;
  initial = addPanel(initial, 'below');
  initial = addEndpoints(initial, 'CONNECTION_POINT', count, initial.activePanelKey);
  initial.activePanelKey = first;
  initial.slots[0].display_name = '10'; initial.slots[1].display_name = '2';
  let latest = initial;
  function Harness() { const [state,setState] = useState(initial); return <I18nProvider><EndpointLinkWorkspace state={state} onChange={(s: BlueprintEditorState) => { latest = s; setState(s); }} onClose={() => {}} /></I18nProvider>; }
  const view = render(<Harness />);
  const side = (name: string) => within(screen.getByRole('region', { name }));
  const selectAll = (name: string) => fireEvent.click(side(name).getByRole('button', { name: 'Выбрать все' }));
  return { ...view, initial, latest: () => latest, side, selectAll };
}
describe('unified endpoint workspace', () => {
  it('exposes other-panel links through All links and retains single-row type accessibility', () => {
    const s = setup(); s.selectAll('A'); s.selectAll('B');
    fireEvent.click(screen.getByRole('button',{name:'Создать связи'}));
    expect(document.querySelectorAll('[data-link-row]')).toHaveLength(2);
    fireEvent.change(s.side('B').getByRole('combobox',{name:'B'}),{target:{value:s.initial.activePanelKey}});
    expect(document.querySelectorAll('[data-link-row]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox',{name:'Все связи'}));
    expect(document.querySelectorAll('[data-link-row]')).toHaveLength(2);
    expect(s.side('A').getAllByRole('img',{name:'Точка подключения'})).toHaveLength(2);
  });
  it('keeps panel orders independent, supports numeric and manual order and spatial reversal', () => {
    const s = setup();
    const rows = (name: string) => [...screen.getByRole('region', {name}).querySelectorAll('[data-endpoint-row]')].map(n => n.getAttribute('data-endpoint-row'));
    const b = rows('B');
    fireEvent.click(s.side('A').getByRole('button', {name:'По имени (1, 2, 10)'}));
    expect(rows('A')).toEqual([s.initial.slots[1].key,s.initial.slots[0].key]); expect(rows('B')).toEqual(b);
    fireEvent.click(s.side('A').getByRole('button', {name:'Ниже: 1'})); expect(rows('A')[0]).toBe(s.initial.slots[0].key);
    fireEvent.change(s.side('B').getByLabelText('По горизонтали'), {target:{value:'rtl'}});
    fireEvent.click(s.side('B').getByRole('button', {name:'Применить пространственный порядок'})); expect(rows('B')).toEqual([...b].reverse());
  });
  it('previews and atomically creates links, preserves identity and links on rename, removes selected links', () => {
    const s = setup(24); s.selectAll('A'); s.selectAll('B');
    fireEvent.click(screen.getByRole('button',{name:'Создать связи'})); expect(s.latest().individualLinks).toHaveLength(24);
    const linked = s.latest();
    fireEvent.change(s.side('A').getByLabelText('Маска (#, ##, GE-##)'),{target:{value:'GE-##'}});
    expect(s.side('A').getByText('→ GE-01')).toBeInTheDocument();
    fireEvent.click(s.side('A').getByRole('button',{name:'Применить имена'}));
    expect(s.latest().individualLinks).toBe(linked.individualLinks);
    expect(s.latest().slots.map(s => [s.key,s.panel_key,s.rendered_position])).toEqual(linked.slots.map(s => [s.key,s.panel_key,s.rendered_position]));
    expect(screen.getByRole('button',{name:'Создать связи'})).toBeDisabled();
    const all = screen.getAllByRole('button',{name:'Выбрать все'}); fireEvent.click(all[2]);
    fireEvent.click(screen.getByRole('button',{name:/Удалить выбранные/})); expect(s.latest().individualLinks).toHaveLength(0);
  });
  it('allows same-panel single links and multiple different links per endpoint; blocks self and duplicates', () => {
    const s = setup();
    fireEvent.change(s.side('B').getByRole('combobox',{name:'B'}),{target:{value:s.initial.activePanelKey}});
    const checksA = s.side('A').getAllByRole('checkbox'); const checksB = s.side('B').getAllByRole('checkbox');
    fireEvent.click(checksA[0]); fireEvent.click(checksB[0]);
    expect(screen.getByRole('button',{name:'Добавить связь'})).toBeDisabled();
    fireEvent.click(checksB[0]); fireEvent.click(checksB[1]); fireEvent.click(screen.getByRole('button',{name:'Добавить связь'}));
    expect(s.latest().individualLinks).toHaveLength(1); expect(screen.getByRole('button',{name:'Добавить связь'})).toBeDisabled();
    fireEvent.change(s.side('B').getByRole('combobox',{name:'B'}),{target:{value:s.initial.panels[1].panel_key}});
    fireEvent.click(s.side('B').getAllByRole('checkbox')[0]); fireEvent.click(screen.getByRole('button',{name:'Добавить связь'})); expect(s.latest().individualLinks).toHaveLength(2);
  });
});
