import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { EditBaseTemplatePage } from './EditBaseTemplatePage';
import type { BaseTemplateDataSource, BaseTemplateDraftDocument } from '../topology/baseTemplateTypes';

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
        publication_state: { revision_id: 'new-revision', version_number: 2, outdated_count: 1, awaiting_update_count: 1, requires_intervention_count: 0, objects: persisted.review?.result.objects ?? [] } };
      return { candidate_id: 'candidate', revision_id: 'new-revision', version_number: 2 };
    }),
  } satisfies BaseTemplateDataSource;
  const mount = () => render(<I18nProvider><MemoryRouter initialEntries={['/library/base-templates/base/edit']}><Routes><Route path="/library/base-templates/:templateId/edit" element={<EditBaseTemplatePage dataSource={source as BaseTemplateDataSource} />} /></Routes></MemoryRouter></I18nProvider>);
  return { source, mount };
}

describe('persisted base template review', () => {
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
