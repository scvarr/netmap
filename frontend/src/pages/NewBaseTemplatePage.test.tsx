import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { NewBaseTemplatePage } from './NewBaseTemplatePage';
import { newBlueprintEditorState } from './BaseTemplateEditor';
import { addEndpoints, addPanel, createBlueprintRequest } from '../blueprints/editorModel';
import { localDraftKey, readLocalDraft } from '../blueprints/localDraft';
import type { BaseTemplateDataSource, BaseTemplateRevisionDocument } from '../topology/baseTemplateTypes';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.stubGlobal('fetch', vi.fn(async () => Response.json([{id:'archived',name:'Old',color:'#123456',is_active:false}]))); });
function fixture() {
 let s = newBlueprintEditorState(); s.name = 'Source'; s = addPanel(s, 'right');
 s = addEndpoints(s, 'NETWORK_PORT', 24, s.activePanelKey, 'archived');
 s.individualLinks = [{from_slot_key:s.slots[0].key,to_slot_key:s.slots[23].key}];
 s.bays = [{kind:'LOGICAL',bay_key:'logical',display_name:'Logical',mount_kind: 'MODULE_PORT' as const, module_port_type_id:'X',panel_key:s.activePanelKey}, {kind:'PLACED',bay_key:'placed',display_name:'Placed',mount_kind: 'MODULE_PORT' as const, module_port_type_id:'X',panel_key:s.activePanelKey,x:0,y:0,width:0.2,height:0.2}];
 const document = {...createBlueprintRequest(s).request!,schema_version:'2.0',blueprint_ref:{entity_id:'source'},version_ref:{entity_id:'published'},version_number:2,next_panel_number:3} as BaseTemplateRevisionDocument;
 const api = {loadBaseTemplateRevision:vi.fn().mockResolvedValue(document),createBaseTemplate:vi.fn().mockResolvedValue({})} as unknown as BaseTemplateDataSource;
 return {document,api};
}
const mount = (api: BaseTemplateDataSource) => render(<I18nProvider><MemoryRouter initialEntries={['/library/base-templates/new?copyTemplate=source&copyRevision=published']}><Routes><Route path="/library/base-templates/new" element={<NewBaseTemplatePage dataSource={api} />} /><Route path="/library/base-templates" element={<p>Library</p>} /></Routes></MemoryRouter></I18nProvider>);
it('copies the pinned complete definition locally, restores it and creates only on explicit save', async () => {
 const {document,api} = fixture(); const original = structuredClone(document);
 const view = mount(api); await screen.findByLabelText('Название шаблона');
 expect(api.loadBaseTemplateRevision).toHaveBeenCalledWith('source','published'); expect(api.createBaseTemplate).not.toHaveBeenCalled();
 await screen.findByText(/Есть порты с архивным/);
 fireEvent.change(screen.getByLabelText('Название шаблона'),{target:{value:'Independent'}}); view.unmount();
 const draft = readLocalDraft(localDraftKey()).draft!.state;
 expect(draft.panels).toEqual(document.panels); expect(draft.slots).toEqual(document.slots); expect(draft.individualLinks).toEqual(document.internal_links); expect(draft.bays).toEqual(document.bays);
 mount(api); await screen.findByText('Продолжить редактирование'); fireEvent.click(screen.getByText('Продолжить редактирование'));
 expect(await screen.findByLabelText('Название шаблона')).toHaveValue('Independent');
 await act(async () => { fireEvent.click(screen.getByText('Сохранить шаблон')); });
 expect(api.createBaseTemplate).toHaveBeenCalledWith({...createBlueprintRequest(draft).request});
 expect(document).toEqual(original); expect(localStorage.getItem(localDraftKey())).toBeNull();
});
it('authors logical groups in a copy and preserves retained keys when changing capacity', async () => {
 const { document, api } = fixture();
 const originalBays = structuredClone(document.bays!);
 vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('/module-bay-types')
   ? [{ id: 'ocp', name: 'OCP', is_active: true }, { id: 'archived', name: 'Archived', is_active: false }] : [{ id: 'archived', name: 'Test endpoint type', is_active: true }])));
 const view = mount(api);
 fireEvent.click(await screen.findByText('Логические отсеки · 0'));
 const creator = within(screen.getByRole('group', { name: 'Создать группу' }));
 await creator.findByRole('option', { name: 'OCP' });
 expect(creator.queryByRole('option', { name: 'Archived' })).toBeNull();
 const create = (count: string, panel = document.panels[0].panel_key) => {
   fireEvent.change(creator.getByLabelText('Панель'), { target: { value: panel } });
   fireEvent.change(creator.getByLabelText('Тип модульного отсека'), { target: { value: 'ocp' } });
   fireEvent.change(creator.getByLabelText('Количество мест'), { target: { value: count } });
   fireEvent.click(creator.getByRole('button', { name: 'Создать группу' }));
 };
 create('0');
 expect(screen.getByRole('alert')).toHaveTextContent('от 1');
 create('1025');
 expect(screen.getByRole('alert')).toHaveTextContent('не более 1024');
 create('2');
 create('1', document.panels[1].panel_key);
 create('3');
 expect(screen.getByRole('alert')).toHaveTextContent('уже существует');
 expect(screen.getByText('Логические отсеки · 2')).toBeVisible();
 view.unmount();
 const created = readLocalDraft(localDraftKey()).draft!.state.bays!;
 const group = created.filter(bay => bay.kind === 'LOGICAL' && bay.mount_kind === 'MODULE_BAY'
   && bay.panel_key === document.panels[0].panel_key);
 expect(group).toHaveLength(2);
 expect(group.every(bay => bay.x === null && bay.y === null)).toBe(true);
 mount(api);
 fireEvent.click(await screen.findByRole('button', { name: 'Продолжить редактирование' }));
 fireEvent.click(screen.getByText('Логические отсеки · 2'));
 const firstGroup = within(await screen.findByRole('group', { name: /^1 · .*Модульный отсек · OCP$/ }));
 const apply = (count: string) => {
   fireEvent.change(firstGroup.getByLabelText('Количество мест'), { target: { value: count } });
   fireEvent.click(firstGroup.getByRole('button', { name: 'Применить количество' }));
 };
 for (const value of ['', '-1', '1.5', '1025']) {
   apply(value);
   expect(screen.getByRole('alert')).toBeVisible();
 }
 apply('1024');
 expect(firstGroup.getByLabelText('Количество мест')).toHaveValue('1024');
 await waitFor(() => expect(readLocalDraft(localDraftKey()).draft!.state.bays!.length).toBe(created.length + 1022));
 const grown = readLocalDraft(localDraftKey()).draft!.state.bays!;
 expect(grown.slice(0, created.length)).toEqual(created);
 expect(new Set(grown.map(bay => bay.bay_key)).size).toBe(grown.length);
 const retainedKey = grown.filter(bay => bay.kind === 'LOGICAL' && bay.mount_kind === 'MODULE_BAY'
   && bay.panel_key === document.panels[0].panel_key).map(bay => bay.bay_key).sort()[0];
 apply('1');
 await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' })); });
 const final = vi.mocked(api.createBaseTemplate).mock.calls[0][0].bays!;
 const front = final.filter(bay => bay.kind === 'LOGICAL' && bay.mount_kind === 'MODULE_BAY'
   && bay.panel_key === document.panels[0].panel_key);
 expect(front.map(bay => bay.bay_key)).toEqual([retainedKey]);
 expect(final).toContainEqual(created.at(-1));
 expect(final.slice(0, originalBays.length)).toEqual(originalBays);
 expect(document.bays).toEqual(originalBays);
});

it('preserves an existing draft across an unresolved choice and rejected deletion', async () => {
 const {api} = fixture(); const old = newBlueprintEditorState(); old.name='Previous';
 const raw=JSON.stringify({version:1,generation:null,state:old});localStorage.setItem(localDraftKey(),raw);
 const view=mount(api); await screen.findByText('Продолжить редактирование'); view.unmount();
 mount(api); await screen.findByText('Продолжить редактирование'); vi.spyOn(window,'confirm').mockReturnValue(false);
 fireEvent.click(screen.getByText('Начать заново')); expect(localStorage.getItem(localDraftKey())).toBe(raw); expect(api.createBaseTemplate).not.toHaveBeenCalled();
});
it('retries a failed revision load without creating an empty editor', async () => {
 const {api}=fixture(); vi.mocked(api.loadBaseTemplateRevision).mockRejectedValueOnce(Error('offline'));
 mount(api); await screen.findByText('Не удалось загрузить опубликованную ревизию для копирования.'); expect(screen.queryByLabelText('Название шаблона')).toBeNull();
 fireEvent.click(screen.getByText('Повторить')); await waitFor(() => expect(screen.getByLabelText('Название шаблона')).toHaveValue('Source (копия)'));
 expect(api.createBaseTemplate).not.toHaveBeenCalled();
});

it('retains seeded copy on save error and cancels after explicit confirmation', async () => {
 const {api}=fixture(); vi.mocked(api.createBaseTemplate).mockRejectedValue(Error('offline'));
 mount(api); await screen.findByLabelText('Название шаблона');
 await act(async () => {fireEvent.click(screen.getByText('Сохранить шаблон'));});
 expect(readLocalDraft(localDraftKey()).draft?.state.name).toBe('Source (копия)');
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false); fireEvent.click(screen.getByText('Отмена')); expect(screen.getByLabelText('Название шаблона')).toHaveValue('Source (копия)');
 confirm.mockReturnValue(true);fireEvent.click(screen.getByText('Отмена')); expect(await screen.findByText('Library')).toBeInTheDocument(); expect(localStorage.getItem(localDraftKey())).toBeNull();
});
