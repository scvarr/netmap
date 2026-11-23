import { screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

export function stubCableCatalog() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: url.endsWith('/cable-types'),
    json: async () => [
      { id: 'copper', name: 'Test copper', is_active: true },
      { id: 'archived', name: 'Archived fiber', is_active: false },
    ],
  })));
}

export async function selectCableType() {
  await screen.findByRole('option', { name: 'Test copper' });
  fireEvent.change(screen.getByLabelText('Тип кабеля'), { target: { value: 'copper' } });
}
