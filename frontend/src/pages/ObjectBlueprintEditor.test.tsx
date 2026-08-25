import { render, screen } from '@testing-library/react';
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
});
