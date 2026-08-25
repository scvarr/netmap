import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newBlueprintEditorState, newEndpointGroup, ObjectBlueprintEditor } from './ObjectBlueprintEditor';

describe('ObjectBlueprintEditor stable group identity', () => {
  it('starts empty without an editable canonical key prefix or generated ports', () => {
    render(<ObjectBlueprintEditor initialState={newBlueprintEditorState()} title="Шаблон" description="Описание" saveLabel="Сохранить" onSave={async () => {}} />);
    expect(screen.queryByLabelText(/Префикс ключа/)).not.toBeInTheDocument();
    expect(screen.queryByText('A01')).not.toBeInTheDocument();
    expect(screen.getByText('Группы портов необязательны. Добавьте группу, если у объекта есть порты.')).toBeInTheDocument();
  });

  it('adds the first group explicitly and returns to an empty state when it is deleted', () => {
    render(<ObjectBlueprintEditor initialState={newBlueprintEditorState()} title="Шаблон" description="Описание" saveLabel="Сохранить" onSave={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить группу портов' }));
    expect(screen.getByText('Группа 1: Группа 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить группу' }));
    expect(screen.queryByRole('button', { name: 'Удалить группу' })).not.toBeInTheDocument();
    expect(screen.getByText('Группы портов необязательны. Добавьте группу, если у объекта есть порты.')).toBeInTheDocument();
  });

  it('creates collision-safe distinct persisted identities without a module sequence', () => {
    const first = newEndpointGroup();
    const second = newEndpointGroup();
    expect(first.id).not.toBe(second.id);
    expect(first.keyPrefix).not.toBe(second.keyPrefix);
    expect(first.keyPrefix).toMatch(/^group-/);
  });

  it('uses human-facing port labels for individual links and removes their mappings with a deleted group', () => {
    const initial = newBlueprintEditorState();
    initial.groups = [
      { id: 'left', keyPrefix: 'left', displayPrefix: 'A', kind: 'CONNECTION_POINT', side: 'LEFT', count: 2, startingNumber: 1, placementOffset: 0, placementSpan: 1 },
      { id: 'right', keyPrefix: 'right', displayPrefix: 'A', kind: 'CONNECTION_POINT', side: 'RIGHT', count: 1, startingNumber: 1, placementOffset: 0, placementSpan: 1 },
    ];
    initial.individualLinks = [{ from_slot_key: 'left:2', to_slot_key: 'right:1' }];
    render(<ObjectBlueprintEditor initialState={initial} title="Шаблон" description="Описание" saveLabel="Сохранить" onSave={async () => {}} />);
    expect(screen.getByLabelText('Первый порт индивидуальной связи 1')).toHaveTextContent('Группа 1: A — A02');
    expect(screen.getByLabelText('Второй порт индивидуальной связи 1')).toHaveTextContent('Группа 2: A — A01');
    fireEvent.click(screen.getAllByRole('button', { name: 'Удалить группу' })[1]);
    expect(screen.queryByLabelText('Первый порт индивидуальной связи 1')).not.toBeInTheDocument();
  });

  it('removes only exact stable-group slots when keys share a prefix', () => {
    const initial = newBlueprintEditorState();
    initial.groups = [
      { id: 'foo', keyPrefix: 'foo', displayPrefix: 'A', kind: 'CONNECTION_POINT', side: 'LEFT', count: 1, startingNumber: 1, placementOffset: 0, placementSpan: 1 },
      { id: 'foo-bar', keyPrefix: 'foo:bar', displayPrefix: 'B', kind: 'CONNECTION_POINT', side: 'RIGHT', count: 1, startingNumber: 1, placementOffset: 0, placementSpan: 1 },
      { id: 'target', keyPrefix: 'target', displayPrefix: 'C', kind: 'CONNECTION_POINT', side: 'TOP', count: 1, startingNumber: 1, placementOffset: 0, placementSpan: 1 },
    ];
    initial.individualLinks = [{ from_slot_key: 'foo:99', to_slot_key: 'target:1' }, { from_slot_key: 'foo:bar:1', to_slot_key: 'target:1' }];
    render(<ObjectBlueprintEditor initialState={initial} title="Шаблон" description="Описание" saveLabel="Сохранить" onSave={async () => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Удалить группу' })[0]);
    expect(screen.getByLabelText('Первый порт индивидуальной связи 1')).toHaveValue('foo:bar:1');
  });
});
