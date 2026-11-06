import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { hardwareModuleDataSource } from '../topology/hardwareModules';
import type { BaseTemplateRevisionDocument } from '../topology/baseTemplateTypes';
import { BaseTemplateLibraryPage } from './BaseTemplateLibraryPage';

const revision: BaseTemplateRevisionDocument = {
  schema_version: '2.0',
  blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'server' },
  version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'rev' },
  name: 'Server', version_number: 2, next_panel_number: 2,
  body: { kind: 'RECTANGLE', width: 160, height: 60 },
  panels: [{ panel_key: 'rear', panel_number: 1, display_name: 'Rear', x: 10, y: 20, width: 160, height: 60 }],
  slots: [{ key: 'eth', display_name: 'Eth', kind: 'NETWORK_PORT', panel_key: 'rear', rendered_position: { x: .25, y: .5 } }],
  internal_links: [],
  bays: [{ kind: 'LOGICAL', bay_key: 'bay', panel_key: 'rear', display_name: 'Bay', compatibility: 'OCP3' }],
};
const listed = { ...revision, default_physical_object_class: 'server', slot_count: 1, version_count: 2, internal_link_count: 0 };
const second = { ...listed, blueprint_ref: { ...listed.blueprint_ref, entity_id: 'other' }, name: 'Other', default_physical_object_class: null };
const module = {
  template_id: 'nic', revision_id: 'nic-rev', name: 'NIC', compatibility: 'OCP3',
  geometry: { width: 240, height: 80, fill_color: '#64748b', endpoints: { p1: { x: .3, y: .5 }, p2: { x: .7, y: .75 } } },
  endpoints: [{ key: 'p1', display_name: 'P1', kind: 'NETWORK_PORT' as const }, { key: 'p2', display_name: 'P2', kind: 'NETWORK_PORT' as const }],
  publication_state: { revision_id: 'nic-rev', version_number: 3, outdated_count: 0, awaiting_update_count: 0, requires_intervention_count: 1, installations: [] },
};

function show(loadBaseTemplateRevision = vi.fn().mockResolvedValue(revision)) {
  const listModules = vi.fn().mockResolvedValue({ modules: [module] });
  const dataSource = {
    loadBaseTemplates: vi.fn().mockResolvedValue({ schema_version: '2.0', blueprints: [listed, second] }),
    loadBaseTemplateRevision, createBaseTemplate: vi.fn(), loadDraft: vi.fn(),
  };
  const moduleDataSource = { ...hardwareModuleDataSource, listModules };
  const page = (source: typeof dataSource) => <I18nProvider><MemoryRouter>
    <BaseTemplateLibraryPage dataSource={source} moduleDataSource={moduleDataSource} />
  </MemoryRouter></I18nProvider>;
  const { rerender } = render(page(dataSource));
  return { listModules, loadBaseTemplateRevision, user: userEvent.setup(),
    replaceSource: (overrides: Partial<typeof dataSource>) => rerender(page({ ...dataSource, ...overrides })),
  };
}

const serverRow = () => screen.findByRole('button', { name: /^Server/ });
const objectsTab = () => screen.getByRole('tab', { name: 'Объекты' });
const modulesTab = () => screen.getByRole('tab', { name: 'Модули' });

it('shows only the active compact list and creation link, with keyboard tab navigation', async () => {
  const { user, loadBaseTemplateRevision, listModules } = show();
  const summary = await serverRow();
  expect(objectsTab()).toHaveAttribute('aria-selected', 'true');
  expect(modulesTab()).toHaveAttribute('tabindex', '-1');
  expect(screen.getByRole('tabpanel', { name: 'Объекты' })).toBeVisible();
  expect(summary).toHaveTextContent('server');
  expect(summary).toHaveTextContent('Портов: 1');
  expect(screen.getByRole('button', { name: /^Other/ })).toHaveTextContent('Не указан');
  expect(screen.queryByText('NIC')).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Создать базовый шаблон' })).toHaveAttribute('href', '/library/base-templates/new');
  expect(screen.queryByRole('link', { name: 'Создать шаблон модуля' })).not.toBeInTheDocument();
  objectsTab().focus();
  await user.keyboard('{ArrowRight}');
  expect(modulesTab()).toHaveFocus();
  expect(modulesTab()).toHaveAttribute('aria-selected', 'true');
  expect(summary).not.toBeInTheDocument();
  const nic = await screen.findByRole('button', { name: /^NIC/ });
  expect(nic).toHaveTextContent('OCP3');
  expect(nic).toHaveTextContent('Портов: 2');
  expect(nic).toHaveTextContent('Требуют вмешательства: 1');
  expect(nic).not.toHaveTextContent('Ожидают обновления: 0');
  expect(screen.getByRole('link', { name: 'Создать шаблон модуля' })).toHaveAttribute('href', '/library/module-templates/new');
  expect(screen.queryByRole('link', { name: 'Создать базовый шаблон' })).not.toBeInTheDocument();
  expect(loadBaseTemplateRevision).not.toHaveBeenCalled();
  expect(listModules).toHaveBeenCalledOnce();
  for (const button of screen.getAllByRole('button').concat(screen.getAllByRole('tab'))) {
    expect(button).toHaveClass('secondary-action');
  }
  await user.keyboard('{Home}');
  expect(objectsTab()).toHaveFocus();
  expect(objectsTab()).toHaveAttribute('aria-selected', 'true');
});

it('loads a base revision only on keyboard disclosure and reuses it after closing', async () => {
  const { user, loadBaseTemplateRevision } = show();
  const summary = await serverRow();
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(loadBaseTemplateRevision).not.toHaveBeenCalled();
  summary.focus();
  await user.keyboard('{Enter}');
  const svg = await screen.findByRole('img', { name: 'Server' });
  expect(svg).toHaveAttribute('viewBox', '10 20 160 60');
  expect(svg.querySelector('[data-slot-key="eth"] circle')).toHaveAttribute('cx', '50');
  expect(svg.querySelector('[data-slot-key="eth"] circle')).toHaveAttribute('cy', '50');
  expect(screen.getByText('Модульных мест: 1')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Изменить шаблон' })).toHaveAttribute('href', '/library/base-templates/server/edit');
  expect(screen.getByRole('link', { name: 'Создать объект' })).toHaveAttribute('href', '/infrastructure/objects/new?blueprint=server');
  expect(summary).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard(' ');
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(svg).not.toBeInTheDocument();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('img', { name: 'Server' })).toBeVisible();
  expect(loadBaseTemplateRevision).toHaveBeenCalledExactlyOnceWith('server', 'rev');
});

it('uses module list geometry and exposes the published revision and editor on disclosure', async () => {
  const { user, listModules, loadBaseTemplateRevision } = show();
  await user.click(modulesTab());
  const summary = await screen.findByRole('button', { name: /^NIC/ });
  await user.click(summary);
  const svg = screen.getByRole('img', { name: 'NIC' });
  expect(svg).toHaveAttribute('viewBox', '0 0 240 80');
  expect(svg.querySelector('rect')).toHaveAttribute('fill', '#64748b');
  expect(svg.querySelector('[data-slot-key="p1"] circle')).toHaveAttribute('cx', '72');
  expect(svg.querySelector('[data-slot-key="p1"] circle')).toHaveAttribute('cy', '40');
  expect(svg.querySelector('[data-slot-key="p2"] circle')).toHaveAttribute('cx', '168');
  expect(svg.querySelector('[data-slot-key="p2"] circle')).toHaveAttribute('cy', '60');
  expect(svg.querySelectorAll('circle')).toHaveLength(2);
  expect(svg.querySelector('[data-port-label="p1"]')).toHaveTextContent('P1');
  expect(svg.querySelector('[data-port-label="p2"]')).toHaveTextContent('P2');
  expect(within(svg).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByText('Текущая опубликованная ревизия: 3')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Изменить шаблон' })).toHaveAttribute('href', '/library/module-templates/nic/edit');
  expect(loadBaseTemplateRevision).not.toHaveBeenCalled();
  expect(listModules).toHaveBeenCalledOnce();
});

it('isolates a failed preview and retries just that revision', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('preview failed')).mockResolvedValueOnce(revision);
  const { user, listModules } = show(request);
  await user.click(await serverRow());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('preview failed');
  expect(screen.getByRole('button', { name: /^Other/ })).toBeVisible();
  const retry = within(alert).getByRole('button');
  expect(retry).toHaveClass('secondary-action');
  await user.click(retry);
  expect(await screen.findByRole('img', { name: 'Server' })).toBeVisible();
  expect(request.mock.calls).toEqual([['server', 'rev'], ['server', 'rev']]);
  expect(listModules).toHaveBeenCalledOnce();
});

it('keeps the module disclosure selected when an object preview resolves on the other tab', async () => {
  let resolve!: (data: BaseTemplateRevisionDocument) => void;
  const request = vi.fn(() => new Promise<BaseTemplateRevisionDocument>(done => { resolve = done; }));
  const { user } = show(request);
  await user.click(await serverRow());
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем предпросмотр');
  await user.click(modulesTab());
  const nic = await screen.findByRole('button', { name: /^NIC/ });
  await user.click(nic);
  await act(async () => { resolve(revision); });
  expect(nic).toHaveAttribute('aria-expanded', 'true');
  expect(screen.queryByRole('img', { name: 'Server' })).not.toBeInTheDocument();
  await user.click(objectsTab());
  expect(await screen.findByRole('img', { name: 'Server' })).toBeVisible();
  expect(request).toHaveBeenCalledOnce();
});

it('discards in-flight previews when the current list load is replaced', async () => {
  let resolve!: (data: BaseTemplateRevisionDocument) => void;
  const request = vi.fn(() => new Promise<BaseTemplateRevisionDocument>(done => { resolve = done; }));
  const { user, replaceSource } = show(request);
  await user.click(await serverRow());

  const replacement = { ...revision, panels: [{ ...revision.panels[0], x: 25 }] };
  const loadReplacement = vi.fn().mockResolvedValue(replacement);
  replaceSource({ loadBaseTemplateRevision: loadReplacement });
  const summary = await serverRow();
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(loadReplacement).not.toHaveBeenCalled();
  await user.click(summary);
  expect(await screen.findByRole('img', { name: 'Server' })).toHaveAttribute('viewBox', '25 20 160 60');
  await act(async () => { resolve(revision); });
  expect(screen.getByRole('img', { name: 'Server' })).toHaveAttribute('viewBox', '25 20 160 60');
  expect(loadReplacement).toHaveBeenCalledExactlyOnceWith('server', 'rev');
});
