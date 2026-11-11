import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
 s.bays = [{kind:'LOGICAL',bay_key:'logical',display_name:'Logical',compatibility:'X',panel_key:s.activePanelKey}, {kind:'PLACED',bay_key:'placed',display_name:'Placed',compatibility:'X',panel_key:s.activePanelKey,x:0,y:0,width:0.2,height:0.2}];
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
