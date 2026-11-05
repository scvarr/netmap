import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { NewModuleTemplatePage } from './NewModuleTemplatePage';
import { hardwareModuleDataSource } from '../topology/hardwareModules';

it('creates NIC-2GE with two stable keys and retains input after failure', async () => {
  const createModule = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({});
  render(<I18nProvider><MemoryRouter><NewModuleTemplatePage dataSource={{ ...hardwareModuleDataSource, createModule }} /></MemoryRouter></I18nProvider>);
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'NIC-2GE' } });
  fireEvent.change(screen.getByLabelText('Совместимость'), { target: { value: 'PCIe' } });
  for (const name of ['GE1', 'GE2']) {
    fireEvent.click(screen.getByRole('button', { name: 'Добавить конечную точку' }));
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs.at(-1)!, { target: { value: name } });
  }
  const canvas = screen.getByLabelText('Геометрия модуля', { selector: 'svg' });
  expect(within(canvas).getByRole('button', { name: 'GE2' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(screen.getByDisplayValue('NIC-2GE')).toBeInTheDocument();
  const first = createModule.mock.calls[0][0];
  expect(first.endpoints).toHaveLength(2);
  expect(new Set(first.endpoints.map((e: { key: string }) => e.key)).size).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));
  await waitFor(() => expect(createModule).toHaveBeenCalledTimes(2));
  expect(createModule.mock.calls[1][0]).toEqual(first);
});
