import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BlueprintInstantiationDialog } from './BlueprintInstantiationDialog';

describe('BlueprintInstantiationDialog', () => {
  it('shows the localized instantiate failure instead of datasource diagnostics', async () => {
    render(
      <MemoryRouter><BlueprintInstantiationDialog
        dataSource={{ instantiateObjectBlueprint: vi.fn().mockRejectedValue(new Error('backend unavailable')) } as never}
        target={{ id: 'blueprint-1', versionId: 'version-1', name: 'Rack', versionNumber: 2 }}
        onClose={vi.fn()}
      /></MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText('Имя экземпляра'), 'Rack 1');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось создать объект.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('backend unavailable');
  });
});
