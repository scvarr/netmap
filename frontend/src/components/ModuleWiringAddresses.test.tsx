import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { EndpointLinkWorkspace } from './EndpointLinkWorkspace';

it('renders numeric stored addresses without catalog capacity or endpoint metadata', () => {
  const onApply = vi.fn();
  const view = (cardinality: number, designations?: string[]) => <I18nProvider><EndpointLinkWorkspace
    endpoints={[{ key: 'a', display_name: 'Panel A', kind: 'CONNECTION_POINT', cardinality, designations }]}
    storedPairs={[1, 2].map(index => ({
      a: { endpointKey: 'a', memberIndex: index },
      b: { endpointKey: 'missing', memberIndex: 3 - index },
    }))}
    validate={() => undefined} onApply={onApply} onClose={() => {}} onRemove={() => {}} />
  </I18nProvider>;
  const { rerender } = render(view(0));
  expect(screen.getAllByRole('checkbox', { name: 'Panel A' }).every(control => control.hasAttribute('disabled'))).toBe(true);
  const apply = screen.getByRole('button', { name: 'Создать связи' });
  expect(apply).toBeDisabled();
  fireEvent.click(apply);
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: /Существующие связи/ }));
  const table = within(screen.getByRole('table'));
  for (const label of ['Panel A · Канал 1', 'Panel A · Канал 2', 'missing · Канал 1', 'missing · Канал 2']) {
    expect(table.getByRole('cell', { name: label })).toBeVisible();
  }
  rerender(view(2, ['Tx', 'Rx']));
  expect(table.getByRole('cell', { name: 'Panel A · Канал 1 · Tx' })).toBeVisible();
  expect(table.getByRole('cell', { name: 'Panel A · Канал 2 · Rx' })).toBeVisible();
  expect(table.getByRole('cell', { name: 'missing · Канал 2' })).toBeVisible();
});
