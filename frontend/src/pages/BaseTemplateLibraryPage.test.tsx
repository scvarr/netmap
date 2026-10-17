import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { hardwareModuleDataSource } from '../topology/hardwareModules';
import type { BaseTemplateDataSource } from '../topology/baseTemplateTypes';
import { BaseTemplateLibraryPage } from './BaseTemplateLibraryPage';

it('opens the persisted module editor through the library edit action', async () => {
  const source: BaseTemplateDataSource = {
    loadBaseTemplates: vi.fn(async () => ({ schema_version: '2.0' as const, blueprints: [] })),
    loadBaseTemplateRevision: vi.fn(), createBaseTemplate: vi.fn(),
  };
  render(<I18nProvider><MemoryRouter><BaseTemplateLibraryPage dataSource={source} moduleDataSource={{ ...hardwareModuleDataSource,
    listModules: async () => ({ modules: [{ template_id: 'module', revision_id: 'revision', name: 'NIC', compatibility: 'OCP3', endpoints: [] }] }),
  }} /></MemoryRouter></I18nProvider>);
  const row = (await screen.findByRole('rowheader', { name: 'NIC' })).closest('tr')!;
  expect(within(row).getByRole('link', { name: 'Изменить шаблон' })).toHaveAttribute('href', '/library/module-templates/module/edit');
});
