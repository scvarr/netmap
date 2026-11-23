import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { hardwareModuleDataSource, initialModuleGeometry, type ModuleDraftDocument, type ModuleReviewDataSource } from '../topology/hardwareModules';
import { EditModuleTemplatePage } from './EditModuleTemplatePage';
import { NewModuleTemplatePage } from './NewModuleTemplatePage';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.split('/').at(-1);
    if (path === 'module-port-types') return Response.json([{ id: 'sfp-plus', name: 'SFP+', is_active: true }]);
    if (path === 'port-types') return Response.json([{
      id: 'lr', name: 'Optical LR', color: '#336699', medium: 'FIBER', is_active: true,
      cardinality: 2, members: ['TX', 'RX'], compatibility_mode: 'SAME_TYPE',
    }]);
    return Response.json([]);
  }));
});
afterEach(() => vi.unstubAllGlobals());

it('creates a physical transceiver with catalog UUIDs and optional typed characteristics', async () => {
  const createModule = vi.fn().mockResolvedValue({});
  const { container } = render(<I18nProvider><MemoryRouter>
    <NewModuleTemplatePage transceiver dataSource={{ ...hardwareModuleDataSource, createModule }} />
  </MemoryRouter></I18nProvider>);
  const submit = screen.getByRole('button', { name: 'Создать шаблон' });
  fireEvent.change(screen.getByLabelText('Модель'), { target: { value: 'SFP+ 10G LR' } });
  await screen.findByRole('option', { name: 'SFP+' });
  fireEvent.change(screen.getByLabelText('Тип гнезда трансивера'), { target: { value: 'sfp-plus' } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Тип порта', { selector: 'select' }), { target: { value: 'lr' } });
  expect(screen.getByLabelText('Тип волокна')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Тип волокна'), { target: { value: 'SM' } });
  expect(screen.getByText('Физические каналы (2)')).toBeInTheDocument();
  expect(screen.getByText('TX · RX')).toBeInTheDocument();
  expect(screen.getByText(/с одним физическим каналом/)).toBeInTheDocument();
  expect(container.querySelector('svg')).toBeNull();
  expect(screen.queryByLabelText('Вид точки')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Скорость (Мбит/с)'), { target: { value: '10000' } });
  fireEvent.click(submit);
  await waitFor(() => expect(createModule).toHaveBeenCalledWith(expect.objectContaining({
    name: 'SFP+ 10G LR', mount_kind: 'MODULE_PORT', module_port_type_id: 'sfp-plus',
    endpoints: [expect.objectContaining({ kind: 'CONNECTION_POINT', port_type_id: 'lr' })],
    transceiver: { speed_mbps: 10000, fiber_type: 'SM' },
  })));
});

it('saves a characteristics-only edit and publishes the checked generation', async () => {
  let doc: ModuleDraftDocument = {
    template_id: 'optic', source_revision_id: 'original', generation: 1, review: null,
    definition: {
      name: 'SFP+ 10G LR', mount_kind: 'MODULE_PORT', module_port_type_id: 'sfp-plus',
      geometry: { ...initialModuleGeometry(), endpoints: { external: { x: 0.5, y: 0.5 } } },
      endpoints: [{ key: 'external', kind: 'CONNECTION_POINT', display_name: 'External', port_type_id: 'lr' }],
      transceiver: { speed_mbps: 10000, fiber_type: 'SM' },
    },
  };
  const dataSource: ModuleReviewDataSource = {
    loadDraft: vi.fn(async () => doc),
    saveDraft: vi.fn(async (_id, definition, generation) => (doc = { ...doc, definition, generation: generation + 1 })),
    checkDraft: vi.fn(async () => (doc = { ...doc, review: {
      candidate_id: 'approved', current: true, draft_generation: doc.generation, definition: doc.definition,
      created_at: '2026-11-23T00:00:00Z', result: { changes: [], installations: [] },
    } })),
    publishCandidate: vi.fn(async () => {
      doc = { ...doc, source_revision_id: 'published', generation: 3, review: null };
      return { revision_id: 'published', version_number: 2 };
    }),
  };
  const { unmount } = render(<I18nProvider><MemoryRouter initialEntries={['/library/transceiver-templates/optic/edit']}>
    <Routes><Route path="/library/transceiver-templates/:templateId/edit"
      element={<EditModuleTemplatePage transceiverRoute dataSource={dataSource} />} /></Routes>
  </MemoryRouter></I18nProvider>);
  fireEvent.change(await screen.findByLabelText('Артикул'), { target: { value: 'OPT-1310' } });
  fireEvent.change(await screen.findByLabelText('Тип волокна'), { target: { value: 'MM' } });
  const check = screen.getByRole('button', { name: 'Проверить изменения' });
  expect(check).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
  await waitFor(() => expect(check).toBeEnabled());
  fireEvent.click(check);
  const publish = screen.getByRole('button', { name: /Опубликовать/ });
  await waitFor(() => expect(publish).toBeEnabled());
  fireEvent.click(publish);
  await waitFor(() => expect(dataSource.loadDraft).toHaveBeenCalledTimes(2));
  expect(dataSource.checkDraft).toHaveBeenCalledWith('optic', 2);
  expect(dataSource.publishCandidate).toHaveBeenCalledWith('optic', 'approved');
  expect(screen.getByLabelText('Артикул')).toHaveValue('OPT-1310');
  expect(screen.getByLabelText('Тип волокна')).toHaveValue('MM');
  unmount();
});
