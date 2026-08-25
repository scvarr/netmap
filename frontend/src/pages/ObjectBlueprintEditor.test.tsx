import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newBlueprintEditorState, newEndpointGroup, ObjectBlueprintEditor } from './ObjectBlueprintEditor';

describe('ObjectBlueprintEditor stable group identity', () => {
  it('does not expose an editable canonical key prefix in the primary editor', () => {
    render(<ObjectBlueprintEditor initialState={newBlueprintEditorState()} title="Шаблон" description="Описание" saveLabel="Сохранить" onSave={async () => {}} />);
    expect(screen.queryByLabelText(/Префикс ключа/)).not.toBeInTheDocument();
    expect(screen.getByText('A01')).toBeInTheDocument();
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
      { id: 'right', keyPrefix: 'right', displayPrefix: 'B', kind: 'CONNECTION_POINT', side: 'RIGHT', count: 1, startingNumber: 4, placementOffset: 0, placementSpan: 1 },
    ];
    initial.individualLinks = [{ from_slot_key: 'left:2', to_slot_key: 'right:1' }];
    render(<ObjectBlueprintEditor initialState={initial} title="Шаблон" description="Описание" saveLabel="Сохранить" onSave={async () => {}} />);
    expect(screen.getByLabelText('Первый порт индивидуальной связи 1')).toHaveTextContent('A — A02');
    expect(screen.getByLabelText('Второй порт индивидуальной связи 1')).toHaveTextContent('B — B04');
    fireEvent.click(screen.getAllByRole('button', { name: 'Удалить группу' })[1]);
    expect(screen.queryByLabelText('Первый порт индивидуальной связи 1')).not.toBeInTheDocument();
  });
});
