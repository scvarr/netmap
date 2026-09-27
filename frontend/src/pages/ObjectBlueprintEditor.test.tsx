import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { createBlueprintRequest } from '../blueprints/editorModel';
import { newBlueprintEditorState, ObjectBlueprintEditor } from './ObjectBlueprintEditor';

describe('minimal direct endpoint editor', () => {
  const renderEditor = () => render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={newBlueprintEditorState()} onSave={vi.fn()} /></MemoryRouter></I18nProvider>);
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
    await userEvent.click(screen.getByRole('button', { name: 'Добавить связь' }));
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

  it('places new points on the active rear face and saves their exact snapshot', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={newBlueprintEditorState()} onSave={save} /></MemoryRouter></I18nProvider>);
    await userEvent.type(screen.getByLabelText('Название шаблона'), 'Rear panel');
    await userEvent.click(screen.getByRole('button', { name: 'Задняя' }));
    await userEvent.selectOptions(screen.getByLabelText('Тип'), 'CONNECTION_POINT');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const request = createBlueprintRequest(save.mock.calls[0][0]).request!;
    expect(request.slots).toEqual([expect.objectContaining({ kind: 'CONNECTION_POINT', face: 'REAR' })]);
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
    await userEvent.click(screen.getByRole('button', { name: 'Задняя' }));
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
    expect(screen.queryByLabelText('Название')).toBeNull();
  });

  it('marquee selects centers, group drag preserves offsets, and multi-delete clears links', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={newBlueprintEditorState()} onSave={save} /></MemoryRouter></I18nProvider>);
    await userEvent.type(screen.getByLabelText('Название шаблона'), 'Panel');
    fireEvent.change(screen.getByLabelText('Количество'), { target: { value: '3' } });
    await userEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    await userEvent.click(screen.getByRole('button', { name: 'Добавить связь' }));
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
    fireEvent.keyDown(screen.getByLabelText('Панель'), { key: 'Delete' });
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
      { key: 'a', display_name: 'A', kind: 'NETWORK_PORT' as const, face: 'FRONT' as const, rendered_position: { x: .1, y: .2 } },
      { key: 'b', display_name: 'B', kind: 'NETWORK_PORT' as const, face: 'FRONT' as const, rendered_position: { x: .2, y: .2 } },
      { key: 'c', display_name: 'C', kind: 'NETWORK_PORT' as const, face: 'FRONT' as const, rendered_position: { x: .6, y: .4 } },
    ] };
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

  it('uses screen-space row spacing for four ports on a 10:1 rear body', async () => {
    const state = { ...newBlueprintEditorState(), width: 10, height: 1 };
    render(<I18nProvider><MemoryRouter><ObjectBlueprintEditor title="Blueprint" description="Direct slots" saveLabel="Save" initialState={state} onSave={vi.fn()} /></MemoryRouter></I18nProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Задняя' }));
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
});
