import { screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

export function stubCableCatalog() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url.endsWith('/cable-types') ? [
      { id: 'copper', name: 'Test copper', is_active: true },
      { id: 'archived', name: 'Archived fiber', is_active: false },
    ] : [{ id: 'connector', name: 'RJ45 plug', is_active: true }],
  })));
}

export async function selectCableType() {
  await screen.findByRole('option', { name: 'Test copper' });
  fireEvent.change(screen.getByLabelText('Тип кабеля'), { target: { value: 'copper' } });
}
