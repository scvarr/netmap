import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { EditModuleTemplatePage } from './EditModuleTemplatePage';
import type { ModuleDraftDocument, ModuleReviewDataSource } from '../topology/hardwareModules';

const draft = (): ModuleDraftDocument => ({ template_id: 'module', source_revision_id: 'revision', generation: 3,
  definition: { geometry: { width: 240, height: 80, fill_color: '#64748b', endpoints: { first: { x: .3, y: .5 }, second: { x: .7, y: .5 } } }, name: 'Сохранённый модуль', compatibility: ' OCP3 ', endpoints: [
    { key: 'first', display_name: 'P1', kind: 'NETWORK_PORT' }, { key: 'second', display_name: 'P2', kind: 'CONNECTION_POINT' },
  ] }, review: null });
const reviewed = (doc: ModuleDraftDocument): ModuleDraftDocument => ({ ...doc, review: {
  candidate_id: 'candidate', draft_generation: doc.generation, definition: doc.definition, current: true, created_at: '2026-10-17T10:00:00Z',
  result: { changes: [], installations: [{ installation_id: 'installation', physical_object_id: 'object', display_name: 'Server',
    source_revision_id: 'older-revision', bay_key: 'current-bay', classification: 'potentially_safe',
    reasons: [{ code: 'IDENTITY_AND_DATA_PRESERVED' }], changes: [] }] },
} });
function setup(initial = draft()) {
  let persisted = structuredClone(initial);
  const source = {
    publishCandidate: vi.fn(async () => ({ revision_id: "published", version_number: 2 })),
    loadDraft: vi.fn(async () => structuredClone(persisted)),
    saveDraft: vi.fn(async (_id, definition, generation) => {
      persisted = { ...persisted, definition, generation: generation + 1, review: persisted.review ? { ...persisted.review, current: false } : null };
      return structuredClone(persisted);
    }),
    checkDraft: vi.fn(async () => { persisted = reviewed(persisted); return structuredClone(persisted); }),
  } satisfies ModuleReviewDataSource;
  const mount = () => render(<I18nProvider><MemoryRouter initialEntries={['/library/module-templates/module/edit']}><Routes>
    <Route path="/library/module-templates/:templateId/edit" element={<EditModuleTemplatePage dataSource={source} />} />
  </Routes></MemoryRouter></I18nProvider>);
  return { source, mount };
}
afterEach(() => { vi.useRealTimers(); });
describe('module persisted draft and review', () => {
  it('restores, renames, reorders and adds endpoints preserving keys and exact compatibility', async () => {
    const { source, mount } = setup();
    let view = mount();
    fireEvent.change(await screen.findByDisplayValue('Сохранённый модуль'), { target: { value: 'Новое имя' } });
    fireEvent.change(screen.getByDisplayValue('P1'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Ниже' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить конечную точку' }));
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[inputs.length - 1], { target: { value: 'P3' } });
    expect(screen.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    await screen.findByText('Черновик сохранён');
    expect(source.saveDraft).toHaveBeenCalledWith('module', expect.objectContaining({ name: 'Новое имя', compatibility: ' OCP3 ', endpoints: [
      { key: 'second', display_name: 'P2', kind: 'CONNECTION_POINT' }, { key: 'first', display_name: 'Renamed', kind: 'NETWORK_PORT' },
      { key: expect.any(String), display_name: 'P3', kind: 'NETWORK_PORT' },
    ] }), 3);
    const key = source.saveDraft.mock.calls[0][1].endpoints[2].key;
    expect(['first', 'second']).not.toContain(key);
    view.unmount(); view = mount();
    await screen.findByDisplayValue('Новое имя');
    expect(screen.getByDisplayValue('Renamed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Проверить изменения' })).toBeEnabled();
    view.unmount();
  });

  it('checks only saved generation and displays installation, object and source revision', async () => {
    const { source, mount } = setup(); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить изменения' }));
    await screen.findByText('Потенциально безопасное автоматическое обновление');
    expect(source.checkDraft).toHaveBeenCalledWith('module', 3);
    expect(screen.getByRole('link', { name: 'Server' })).toHaveAttribute('href', '/infrastructure/objects/object');
    expect(screen.getByText(/исходная ревизия: older-revision/)).toHaveTextContent('Установка: installation');
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeEnabled();
    fireEvent.change(screen.getByDisplayValue('P1'), { target: { value: 'Unsaved' } });
    expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    await screen.findByText('Черновик сохранён');
    expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
  });

  it('retains local input after save conflict and hides previous conclusions', async () => {
    const { source, mount } = setup(reviewed(draft())); mount();
    await screen.findByDisplayValue('P1');
    source.saveDraft.mockRejectedValueOnce(new Error('DRAFT_CONFLICT'));
    fireEvent.change(screen.getByDisplayValue('P1'), { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('DRAFT_CONFLICT');
    expect(screen.getByDisplayValue('Keep me')).toBeInTheDocument();
    expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
  });

  it.each(['pending', 'failed', 'stale', 'generation'])('hides conclusions on %s focus revalidation', async mode => {
    const { source, mount } = setup(reviewed(draft())); mount();
    await screen.findByText('Потенциально безопасное автоматическое обновление');
    let resolve!: (doc: ModuleDraftDocument) => void;
    let reject!: (e: Error) => void;
    source.loadDraft.mockImplementationOnce(() => new Promise((ok, fail) => { resolve = ok; reject = fail; }));
    fireEvent(window, new Event('focus'));
    expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить черновик' })).toBeDisabled();
    if (mode === 'pending') {
      await act(async () => resolve(reviewed(draft())));
      expect(screen.getByText('Потенциально безопасное автоматическое обновление')).toBeInTheDocument();
    } else {
      await act(async () => {
        if (mode === 'failed') reject(new Error('Offline'));
        else { const doc = reviewed(draft()); if (mode === 'generation') doc.generation++; else doc.review!.current = false; resolve(doc); }
      });
      expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
      if (mode === 'generation') expect(screen.getByRole('alert')).toHaveTextContent('Черновик изменён в другой сессии');
    }
  });

  it.each(['clean', 'dirty', 'generation'])('recovers from transient revalidation failure with %s input', async mode => {
    const { source, mount } = setup(reviewed(draft())); mount();
    await screen.findByText('Потенциально безопасное автоматическое обновление');
    source.loadDraft.mockRejectedValueOnce(new Error('Offline'));
    fireEvent(window, new Event('focus'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
    if (mode === 'dirty') fireEvent.change(screen.getByDisplayValue('P1'), { target: { value: 'Keep local edits' } });
    if (mode === 'generation') source.loadDraft.mockResolvedValueOnce({ ...reviewed(draft()), generation: 4 });
    await act(async () => { fireEvent(window, new Event('focus')); });
    if (mode === 'generation') {
      expect(screen.getByRole('alert')).toHaveTextContent('Черновик изменён в другой сессии');
      expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
      await screen.findByText('Черновик сохранён');
      expect(source.saveDraft.mock.calls[0][2]).toBe(3);
    } else {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      if (mode === 'dirty') {
        expect(screen.getByDisplayValue('Keep local edits')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled();
        expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
      } else expect(screen.getByText('Потенциально безопасное автоматическое обновление')).toBeInTheDocument();
    }
  });

  it('revalidates every 15 seconds without replacing unsaved input', async () => {
    vi.useFakeTimers();
    const { source, mount } = setup(reviewed(draft()));
    await act(async () => { mount(); });
    fireEvent.change(screen.getByDisplayValue('P1'), { target: { value: 'Local input' } });
    await act(async () => vi.advanceTimersByTime(15000));
    expect(source.loadDraft).toHaveBeenCalledTimes(2);
    expect(screen.getByDisplayValue('Local input')).toBeInTheDocument();
    expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
  });

  it('shows concrete intervention reasons for each installation', async () => {
    const doc = reviewed(draft());
    doc.review!.result.installations[0].classification = 'requires_intervention';
    doc.review!.result.installations[0].reasons = [{ code: 'BAY_COMPATIBILITY_MISMATCH' }, { code: 'ENDPOINT_KIND_CHANGE', endpoint_name: 'P1' }];
    const { mount } = setup(doc); mount();
    await screen.findByText('Требуется вмешательство пользователя');
    expect(screen.getByText(/Совместимость не совпадает с текущим отсеком/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Последствия для физических объектов' })).getByText(/Изменяется тип конечной точки/)).toHaveTextContent('P1');
  });
});

it('publishes the saved candidate and displays derived diagnostics', async () => {
  const initial = reviewed(draft());
  initial.publication_state = { revision_id: 'latest', version_number: 2, outdated_count: 1, awaiting_update_count: 0,
    requires_intervention_count: 1, installations: [{ ...initial.review!.result.installations[0], classification: 'requires_intervention', reasons: [{ code: 'BAY_COMPATIBILITY_MISMATCH' }] }] };
  const { source, mount } = setup(initial); mount();
  expect(await screen.findByText('Текущая опубликованная ревизия: 2')).toBeInTheDocument();
  expect(screen.getByText('Требуют вмешательства: 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
  await screen.findByRole('status');
  expect(source.publishCandidate).toHaveBeenCalledWith('module', 'candidate');
  fireEvent.change(screen.getByDisplayValue('P1'), { target: { value: 'Unsaved' } });
  expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
});


it('reconciles installations and refreshes diagnostics preserving unsaved edits', async () => {
  const initial = draft();
  initial.publication_state = { revision_id: 'latest', version_number: 2, outdated_count: 1,
    awaiting_update_count: 1, requires_intervention_count: 0, installations: [] };
  const source = {
    ...setup(initial).source,
    reconcileInstallations: vi.fn(async () => ({ revision_id: 'latest', version_number: 2,
      installations: [{ installation_id: 'installation', physical_object_id: 'object-result', bay_key: 'bay-result', source_revision_id: 'source-result', status: 'updated' as const, reasons: [] }] })),
  };
  render(<I18nProvider><MemoryRouter><EditModuleTemplatePage dataSource={source} /></MemoryRouter></I18nProvider>);
  fireEvent.change(await screen.findByDisplayValue('Сохранённый модуль'), { target: { value: 'Unsaved' } });
  fireEvent.click(screen.getByRole('button', { name: 'Обновить совместимые установки' }));
  expect(await screen.findByText(/installation: Обновлён/)).toBeInTheDocument();
  expect(screen.getByDisplayValue('Unsaved')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'object-result' })).toHaveAttribute('href', '/infrastructure/objects/object-result');
  expect(screen.getByText(/bay-result/)).toBeInTheDocument();
  expect(source.loadDraft).toHaveBeenCalledTimes(2);
  expect(source.saveDraft).not.toHaveBeenCalled();
});

it('keeps unsaved geometry through diagnostics and save failure, and restores saved geometry', async () => {
 const {source,mount}=setup(); const view=mount();
 const width=await screen.findByLabelText('Ширина');
 fireEvent.change(width,{target:{value:'480'}});
 expect(screen.getByText('Проверить изменения')).toBeDisabled();
 fireEvent.focus(window);
 await act(async()=>{await Promise.resolve();});
 expect(screen.getByLabelText('Ширина')).toHaveValue(480);
 source.saveDraft.mockRejectedValueOnce(new Error('Geometry save failed'));
 fireEvent.click(screen.getByText('Сохранить черновик'));
 await screen.findByText(/Geometry save failed/);
 expect(screen.getByLabelText('Ширина')).toHaveValue(480);
 fireEvent.click(screen.getByText('Сохранить черновик'));
 await act(async()=>{await Promise.resolve();});
 view.unmount();mount();
 expect(await screen.findByLabelText('Ширина')).toHaveValue(480);
});
