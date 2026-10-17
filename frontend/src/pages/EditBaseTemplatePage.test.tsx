import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { EditBaseTemplatePage } from './EditBaseTemplatePage';
import type { BaseTemplateDataSource, BaseTemplateDraftDocument, BaseTemplateReconciliationResult } from '../topology/baseTemplateTypes';

const draft = (): BaseTemplateDraftDocument => ({ template_id: 'base', source_revision_id: 'published', generation: 2, review: null,
  definition: { name: 'Сохранённый черновик', default_physical_object_class: 'server', body: { kind: 'RECTANGLE', width: 160, height: 60, fill_color: '#28565a' },
    panels: [{ panel_key: 'panel', panel_number: 1, display_name: 'Front', x: 0, y: 0, width: 160, height: 60 }],
    slots: [{ key: 'endpoint', display_name: 'MGMT', kind: 'NETWORK_PORT', panel_key: 'panel', rendered_position: { x: .2, y: .5 } }],
    internal_links: [], bays: [{ bay_key: 'stable-bay', display_name: 'OCP bay', compatibility: 'OCP3', panel_key: 'panel', x: .2, y: .1, width: .6, height: .8 }] } });
const withReview = (doc: BaseTemplateDraftDocument): BaseTemplateDraftDocument => ({ ...doc, review: {
  candidate_id: 'candidate', draft_generation: doc.generation, definition: doc.definition, current: true, created_at: '2026-10-16T12:00:00Z',
  result: { changes: [{ section: 'slots', key: 'new-endpoint', operation: 'added' }], objects: [{ physical_object_id: 'object', source_revision_id: 'published', classification: 'potentially_safe', reasons: [{ code: 'IDENTITY_AND_DATA_PRESERVED' }], proposed_placements: {}, changes: [] }] },
} });
function setup(document = draft()) {
  let persisted = structuredClone(document);
  const source = {
    loadBaseTemplates: vi.fn(), loadBaseTemplateRevision: vi.fn(), createBaseTemplate: vi.fn(),
    loadDraft: vi.fn(async () => structuredClone(persisted)),
    saveDraft: vi.fn(async (_id, definition, generation) => {
      // Server schema serialization normalizes field order on newly created endpoints.
      definition = { ...definition, slots: definition.slots.map((s: BaseTemplateDraftDocument['definition']['slots'][number]) => ({ key: s.key, display_name: s.display_name, kind: s.kind, panel_key: s.panel_key, rendered_position: s.rendered_position })) };
      persisted = { ...persisted, definition, generation: generation + 1, review: persisted.review ? { ...persisted.review, current: false } : null }; return structuredClone(persisted);
    }),
    checkDraft: vi.fn(async () => { persisted = withReview(persisted); return structuredClone(persisted); }),
    publishCandidate: vi.fn(async () => {
      persisted = { ...persisted, source_revision_id: 'new-revision', generation: persisted.generation + 1,
        review: persisted.review ? { ...persisted.review, current: false, published_revision_id: 'new-revision' } : null,
        publication_state: { revision_id: 'new-revision', version_number: 2, outdated_count: 1, awaiting_update_count: 1, requires_intervention_count: 0, current_objects: [], objects: persisted.review?.result.objects ?? [] } };
      return { candidate_id: 'candidate', revision_id: 'new-revision', version_number: 2 };
    }),
    reconcileObjects: vi.fn(async (): Promise<BaseTemplateReconciliationResult> => {
      persisted = { ...persisted, publication_state: { ...persisted.publication_state!, outdated_count: 1,
        awaiting_update_count: 0, requires_intervention_count: 1,
        current_objects: [{ physical_object_id: 'safe', display_name: 'Safe object' }, { physical_object_id: 'current', display_name: 'Current object' }],
        objects: persisted.publication_state!.objects.filter(o => o.classification === 'requires_intervention') } };
      return { revision_id: 'latest', version_number: 2, objects: [
        { physical_object_id: 'safe', display_name: 'Safe object', target_revision_id: 'latest', status: 'updated', reasons: [] },
        { physical_object_id: 'current', display_name: 'Current object', target_revision_id: 'latest', status: 'already_current', reasons: [] },
        { physical_object_id: 'blocked', display_name: 'Blocked object', target_revision_id: 'latest', status: 'requires_intervention',
          reasons: [{ code: 'ENDPOINT_DEPENDENCIES', endpoint_name: 'User port', dependencies: ['CONNECTIONS', 'ENTITY_METADATA'] }] },
      ] };
    }),
  } satisfies BaseTemplateDataSource;
  const mount = () => render(<I18nProvider><MemoryRouter initialEntries={['/library/base-templates/base/edit']}><Routes><Route path="/library/base-templates/:templateId/edit" element={<EditBaseTemplatePage dataSource={source as BaseTemplateDataSource} />} /></Routes></MemoryRouter></I18nProvider>);
  return { source, mount };
}

describe('persisted base template review', () => {
  const outdated = (): BaseTemplateDraftDocument => ({ ...draft(), publication_state: {
    revision_id: 'latest', version_number: 2, outdated_count: 2, awaiting_update_count: 1, requires_intervention_count: 1,
    current_objects: [{ physical_object_id: 'current', display_name: 'Current object' }],
    objects: [
      { physical_object_id: 'safe', display_name: 'Safe object', source_revision_id: 'old', classification: 'potentially_safe', reasons: [], proposed_placements: {}, changes: [] },
      { physical_object_id: 'blocked', display_name: 'Blocked object', source_revision_id: 'old', classification: 'requires_intervention',
        reasons: [{ code: 'ENDPOINT_DEPENDENCIES', endpoint_name: 'User port', dependencies: ['CONNECTIONS', 'ENTITY_METADATA'] }], proposed_placements: {}, changes: [] },
    ],
  } });

  it('runs reconciliation explicitly, reports each outcome and restores actual state and reasons after reload', async () => {
    const { source, mount } = setup(outdated());
    let view = mount();
    const run = await screen.findByRole('button', { name: 'Обновить совместимые объекты' });
    expect(source.reconcileObjects).not.toHaveBeenCalled();
    fireEvent.click(run);
    expect(run).toBeDisabled();
    await screen.findByRole('heading', { name: 'Результаты обновления объектов' });
    expect(source.reconcileObjects).toHaveBeenCalledExactlyOnceWith('base');
    expect(screen.getByText(/Обновлён/)).toBeInTheDocument();
    expect(screen.getAllByText(/Актуален/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/канонические соединения, пользовательские имена или данные/).length).toBeGreaterThan(0);
    await screen.findByText('Ожидают обновления: 0');
    view.unmount(); view = mount();
    await screen.findByText('Объектов на прежних ревизиях: 1');
    expect(screen.queryByRole('heading', { name: 'Результаты обновления объектов' })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Актуален/)).toHaveLength(2);
    expect(screen.getByText(/канонические соединения, пользовательские имена или данные/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Blocked object' })).toHaveAttribute('href', '/infrastructure/objects/blocked');
    view.unmount();
  });

  it('retains unsaved authoring edits through object updates and permits retry after request failure', async () => {
    const { source, mount } = setup(outdated());
    source.reconcileObjects.mockRejectedValueOnce(new Error('Update unavailable'));
    mount();
    fireEvent.change(await screen.findByDisplayValue('Сохранённый черновик'), { target: { value: 'Keep unsaved draft' } });
    const run = screen.getByRole('button', { name: 'Обновить совместимые объекты' });
    fireEvent.click(run);
    expect(await screen.findByRole('alert')).toHaveTextContent('Update unavailable');
    expect(screen.getByDisplayValue('Keep unsaved draft')).toBeInTheDocument();
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    await screen.findByRole('heading', { name: 'Результаты обновления объектов' });
    expect(screen.getByDisplayValue('Keep unsaved draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled();
  });

  it('does not adopt a concurrent draft generation while refreshing object outcomes', async () => {
    const document = outdated();
    const { source, mount } = setup(document);
    mount();
    fireEvent.change(await screen.findByDisplayValue('Сохранённый черновик'), { target: { value: 'Local edits' } });
    source.loadDraft.mockResolvedValueOnce({ ...document, generation: document.generation + 1,
      definition: { ...document.definition, name: 'Other author edits' } });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить совместимые объекты' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Черновик изменён в другой сессии');
    expect(screen.getByDisplayValue('Local edits')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    await waitFor(() => expect(source.saveDraft).toHaveBeenCalledWith('base', expect.anything(), document.generation));
  });

  it('publishes only a current saved candidate and reopens the advanced draft', async () => {
    const { source, mount } = setup(withReview(draft()));
    let view = mount();
    await screen.findByDisplayValue('Сохранённый черновик');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    expect(await screen.findByText(/Публикация завершена/)).toBeInTheDocument();
    expect(source.publishCandidate).toHaveBeenCalledExactlyOnceWith('base', 'candidate');
    expect(await screen.findByText('Текущая опубликованная ревизия: 2')).toBeInTheDocument();
    expect(screen.getByText('Объектов на прежних ревизиях: 1')).toBeInTheDocument();
    expect(screen.getByText('Ожидают обновления: 1')).toBeInTheDocument();
    expect(screen.getByText('Требуют вмешательства: 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
    expect(screen.getByText('Этот кандидат опубликован. Следующие изменения проверяются отдельно.')).toBeInTheDocument();
    view.unmount(); view = mount();
    expect(await screen.findByText('Текущая опубликованная ревизия: 2')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Сохранённый черновик'), { target: { value: 'Next edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    await screen.findByText('Черновик сохранён');
    expect(source.saveDraft).toHaveBeenCalledWith('base', expect.objectContaining({ name: 'Next edit' }), 3);
  });

  it('blocks unsaved and revalidating publication and retains work after rejection', async () => {
    const { source, mount } = setup(withReview(draft()));
    source.publishCandidate.mockRejectedValueOnce(new Error('Кандидат устарел. Повторите проверку изменений.'));
    mount();
    await screen.findByDisplayValue('Сохранённый черновик');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Повторите проверку');
    expect(screen.getByDisplayValue('Сохранённый черновик')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить изменения' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeEnabled());
    let resolve!: (doc: BaseTemplateDraftDocument) => void;
    source.loadDraft.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled());
    resolve(withReview(draft()));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeEnabled());
    fireEvent.change(screen.getByDisplayValue('Сохранённый черновик'), { target: { value: 'Unsaved' } });
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
  });

  it('loads saved edits, uses the existing editor, saves explicitly and restores review on reopening', async () => {
    const { source, mount } = setup();
    let view = mount();
    expect(await screen.findByDisplayValue('Сохранённый черновик')).toBeInTheDocument();
    expect(screen.getAllByText('OCP bay').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByDisplayValue('Сохранённый черновик'), { target: { value: 'Changed draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить порты / точки' }));
    expect(screen.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    expect(await screen.findByText('Черновик сохранён')).toBeInTheDocument();
    expect(source.saveDraft).toHaveBeenCalledWith('base', expect.objectContaining({ name: 'Changed draft', bays: [expect.objectContaining({ bay_key: 'stable-bay' })] }), 2);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Проверить изменения' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Проверить изменения' }));
    expect(await screen.findByText('Потенциально безопасное автоматическое обновление')).toBeInTheDocument();
    view.unmount(); view = mount();
    expect(await screen.findByDisplayValue('Changed draft')).toBeInTheDocument();
    expect(await screen.findByText('Потенциально безопасное автоматическое обновление')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Changed draft'), { target: { value: 'Unsaved' } });
    expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
    view.unmount();
  });

  it('retains unsaved edits after save failure and suppresses stale object conclusions', async () => {
    const document = withReview(draft()); document.review!.current = false;
    const { source, mount } = setup(document); source.saveDraft.mockRejectedValueOnce(new Error('Save unavailable'));
    mount();
    const name = await screen.findByDisplayValue('Сохранённый черновик');
    expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
    fireEvent.change(name, { target: { value: 'Keep unsaved edits' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    expect(await screen.findByText('Error: Save unavailable')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Keep unsaved edits')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled();
  });

  it('revalidates when returning to the page and hides conclusions after object changes', async () => {
    const { source, mount } = setup(withReview(draft()));
    mount();
    expect(await screen.findByText('Потенциально безопасное автоматическое обновление')).toBeInTheDocument();
    const stale = withReview(draft()); stale.review!.current = false;
    source.loadDraft.mockResolvedValueOnce(stale);
    fireEvent.focus(window);
    await waitFor(() => expect(source.loadDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument());
  });
});
