import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { createBlueprintRequest } from '../blueprints/editorModel';
import { newBlueprintEditorState, ObjectBlueprintEditor } from './ObjectBlueprintEditor';

describe('minimal direct endpoint editor', () => {
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
    fireEvent.pointerDown(document.querySelectorAll('[data-slot-key]')[0]);
    fireEvent.pointerMove(canvas, { clientX: 500, clientY: 187.5 });
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
});
