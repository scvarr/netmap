import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

it('authors exact logical groups and keeps their individual bays through draft review', async () => {
  const doc = draft();
  const placed = doc.definition.bays![0];
  doc.definition.panels.push({ ...doc.definition.panels[0], panel_key: 'rear', panel_number: 2, display_name: 'Rear', x: 160 });
  const { mount, source } = setup(doc);
  const view = mount();
  fireEvent.click(await screen.findByText('Модульные места · 0'));
  const creation = within(screen.getByRole('group', { name: 'Создать группу' }));
  const create = (compatibility: string, count: string, panel = 'panel') => {
    fireEvent.change(creation.getByLabelText('Панель'), { target: { value: panel } });
    fireEvent.change(creation.getByLabelText('Совместимость'), { target: { value: compatibility } });
    fireEvent.change(creation.getByLabelText('Количество мест'), { target: { value: count } });
    fireEvent.click(creation.getByRole('button', { name: 'Создать группу' }));
  };
  const save = async (calls: number): Promise<NonNullable<BaseTemplateDraftDocument['definition']['bays']>> => {
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    await waitFor(() => expect(source.saveDraft).toHaveBeenCalledTimes(calls));
    return (await source.saveDraft.mock.results[calls - 1].value).definition.bays!;
  };
  create('OCP3', '2');
  create('ocp3', '1');
  create(' OCP3 ', '1');
  create('OCP3', '1', 'rear');
  create('OCP3', '3');
  expect(screen.getByRole('alert')).toHaveTextContent('уже существует');
  create('  ', '1');
  expect(screen.getByRole('alert')).toHaveTextContent('непустую');
  create('new', '0');
  expect(screen.getByRole('alert')).toHaveTextContent('от 1');
  create('new', '1025');
  expect(screen.getByRole('alert')).toHaveTextContent('не более 1024');
  expect(creation.getByLabelText('Количество мест')).toHaveValue('1025');
  const first = await save(1);
  expect(first.map(bay => [bay.panel_key, bay.compatibility])).toEqual([
    ['panel', 'OCP3'], ['panel', 'OCP3'], ['panel', 'OCP3'], ['panel', 'ocp3'], ['panel', ' OCP3 '], ['rear', 'OCP3'],
  ]);
  expect(first.slice(1).every(bay => bay.kind === 'LOGICAL' && [bay.x, bay.y, bay.width, bay.height].every(value => value === null))).toBe(true);
  expect(view.container.querySelectorAll('[data-bay-key]')).toHaveLength(1);
  view.unmount();
  mount();
  fireEvent.click(await screen.findByText('Модульные места · 4'));
  const group = within(screen.getByRole('group', { name: '1 · Front / "OCP3"' }));
  const count = () => group.getByLabelText('Количество мест');
  const apply = (value: string) => {
    fireEvent.change(count(), { target: { value } });
    fireEvent.click(group.getByRole('button', { name: 'Применить количество' }));
  };
  expect(count()).toHaveValue('2');
  for (const invalid of ['', '-1', '1.5']) {
    apply(invalid);
    expect(screen.getByRole('alert')).toHaveTextContent('от 0');
  }
  expect(screen.getByRole('button', { name: 'Проверить изменения' })).toBeEnabled();
  apply('1025');
  expect(screen.getByRole('alert')).toHaveTextContent('не более 1024');
  expect(count()).toHaveValue('1025');
  expect(screen.getByRole('button', { name: 'Проверить изменения' })).toBeEnabled();
  apply('1024');
  const grown = await save(2);
  const grownGroup = grown.filter(bay => bay.kind === 'LOGICAL' && bay.panel_key === 'panel' && bay.compatibility === 'OCP3');
  expect(grownGroup).toHaveLength(1024);
  expect(grown.slice(0, first.length)).toEqual(first);
  expect(new Set(grown.map(bay => bay.bay_key)).size).toBe(grown.length);
  const smallest = grownGroup.sort((a, b) => a.bay_key < b.bay_key ? -1 : 1)[0];
  apply('1');
  expect(await save(3)).toEqual(grown.filter(bay => !grownGroup.includes(bay) || bay === smallest));
  fireEvent.click(group.getByRole('button', { name: 'Удалить группу' }));
  expect(await save(4)).toEqual([placed, ...first.slice(3)]);
  fireEvent.click(screen.getByRole('button', { name: 'Проверить изменения' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
  await waitFor(() => expect(source.publishCandidate).toHaveBeenCalledWith('base', 'candidate'));
  expect(source.reconcileObjects).not.toHaveBeenCalled();
});

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

  it('bounds large disclosures, preserves edits and exposes summary counts', async () => {
    const doc = withReview(outdated());
    doc.publication_state!.objects = Array.from({ length: 200 }, (_, i) => ({ ...doc.publication_state!.objects[0], physical_object_id: `object-${i}`, display_name: `Object ${i}` }));
    doc.publication_state!.outdated_count = 200;
    const { mount } = setup(doc);
    const view = mount();
    const name = await screen.findByDisplayValue('Сохранённый черновик');
    expect(screen.getByText('Объектов на прежних ревизиях: 200')).toBeInTheDocument();
    expect(screen.getByText('Ожидают обновления: 1')).toBeInTheDocument();
    expect(screen.getByText('Требуют вмешательства: 1')).toBeInTheDocument();
    const objects = screen.getByText(/^Физические объекты/).closest('details')!;
    const impacts = screen.getByText(/Изменения: 1 · Объекты: 1/).closest('details')!;
    expect(objects.open).toBe(false);
    expect(impacts.open).toBe(false);
    expect(objects.querySelector('.base-template-details__body')).not.toBeNull();
    fireEvent.change(name, { target: { value: 'Keep local work' } });
    for (const details of [objects, impacts]) {
      fireEvent.click(details.querySelector('summary')!);
      expect(details.open).toBe(true);
      fireEvent.click(details.querySelector('summary')!);
      expect(details.open).toBe(false);
    }
    expect(screen.getByDisplayValue('Keep local work')).toBe(name);
    expect(view.container.querySelector('.blueprint-composer__canvas-wrap')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Проверить изменения' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
  });

  it('keeps periodic revalidation pending until the server confirms freshness', async () => {
    const { source, mount } = setup(withReview(draft()));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const view = mount();
    await screen.findByDisplayValue('Сохранённый черновик');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeEnabled());
    try {
      let resolve!: (doc: BaseTemplateDraftDocument) => void;
      source.loadDraft.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
      await act(async () => { vi.advanceTimersByTime(15000); });
      expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
      expect(screen.queryByText('Потенциально безопасное автоматическое обновление')).not.toBeInTheDocument();
      const stale = withReview(draft()); stale.review!.current = false;
      await act(async () => { resolve(stale); });
      expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeDisabled();
    } finally { view.unmount(); vi.useRealTimers(); }
  });

  it('runs reconciliation explicitly, reports each outcome and restores actual state and reasons after reload', async () => {
    const { source, mount } = setup(outdated());
    let view = mount();
    const run = await screen.findByRole('button', { name: 'Обновить совместимые объекты' });
    fireEvent.click(screen.getByText(/^Физические объекты/));
    expect(source.reconcileObjects).not.toHaveBeenCalled();
    fireEvent.click(run);
    expect(run).toBeDisabled();
    fireEvent.click(await screen.findByText(/^Результаты обновления объектов/));
    expect(source.reconcileObjects).toHaveBeenCalledExactlyOnceWith('base');
    expect(screen.getByText(/Обновлён/)).toBeInTheDocument();
    expect(screen.getAllByText(/Актуален/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/канонические соединения, пользовательские имена или данные/).length).toBeGreaterThan(0);
    await screen.findByText('Ожидают обновления: 0');
    view.unmount(); view = mount();
    await screen.findByText('Объектов на прежних ревизиях: 1');
    expect(screen.queryByText(/^Результаты обновления объектов/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Физические объекты/));
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
    fireEvent.click(await screen.findByText(/^Результаты обновления объектов/));
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
    expect(screen.getByText(/Этот кандидат опубликован/)).toBeInTheDocument();
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
