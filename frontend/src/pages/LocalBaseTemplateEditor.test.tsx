import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { LocalBaseTemplateEditor } from './LocalBaseTemplateEditor';
import { newBlueprintEditorState } from './BaseTemplateEditor';
import { addEndpoints } from '../blueprints/editorModel';
import { localDraftKey, readLocalDraft } from '../blueprints/localDraft';
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.stubGlobal('fetch', vi.fn(async () => Response.json([]))); });
const state = () => { const s = newBlueprintEditorState(); s.name = 'Device'; return addEndpoints(s, 'NETWORK_PORT', 24, s.activePanelKey, 'type'); };
const mount = (id?: string, generation?: number, save = vi.fn().mockResolvedValue(undefined)) => render(<I18nProvider><MemoryRouter><LocalBaseTemplateEditor initialState={state()} title="Editor" description="" saveLabel="Save" templateId={id} generation={generation} onSave={save} /></MemoryRouter></I18nProvider>);
it('round trips 24 endpoints, geometry, names, types, links, bays and numbering', () => {
 const s = state(); s.individualLinks = [{ from_slot_key: s.slots[0].key, to_slot_key: s.slots[1].key }];
 s.bays = [{kind:'LOGICAL',bay_key:'bay',display_name:'Bay',compatibility:'test',panel_key:s.activePanelKey}];
 localStorage.setItem(localDraftKey(), JSON.stringify({version:1,generation:null,state:s}));
 expect(readLocalDraft(localDraftKey()).draft?.state).toEqual(s);
 const view = mount(); expect(screen.getByText('Найден локальный черновик. Продолжить редактирование?')).toBeInTheDocument();
 fireEvent.click(screen.getByText('Продолжить редактирование')); expect(screen.getByLabelText('Название шаблона')).toHaveValue('Device'); view.unmount();
});
it('flushes on navigation and restores existing drafts; generation conflict blocks editing', () => {
 const view = mount('a', 2);
 const input = screen.getByLabelText('Название шаблона'); fireEvent.change(input, {target:{value:'Changed'}}); view.unmount();
 expect(readLocalDraft(localDraftKey('a')).draft?.state.name).toBe('Changed');
 const again = mount('a', 2); expect(screen.getByLabelText('Название шаблона')).toHaveValue('Changed'); again.unmount();
 mount('a', 3); expect(screen.getByText(/Конфликт: серверный/)).toBeInTheDocument(); expect(screen.queryByLabelText('Название шаблона')).toBeNull();
});
it('keeps drafts on server errors and clears only its own after success', async () => {
 const save = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined);
 const view = mount('a', 2, save); fireEvent.change(screen.getByLabelText('Название шаблона'), {target:{value:'Changed'}});
 localStorage.setItem(localDraftKey('b'), 'other');
 await act(async () => { fireEvent.click(screen.getByText('Save')); }); expect(readLocalDraft(localDraftKey('a')).draft?.state.name).toBe('Changed');
 await act(async () => { fireEvent.click(screen.getByText('Save')); }); view.unmount();
 expect(localStorage.getItem(localDraftKey('a'))).toBeNull(); expect(localStorage.getItem(localDraftKey('b'))).toBe('other');
});
it('rejects corrupt data and reports unavailable storage', () => {
 localStorage.setItem(localDraftKey(), '{'); const view = mount(); expect(screen.getByText(/повреждён/)).toBeInTheDocument(); view.unmount();
 vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {throw Error();});
 mount(); expect(screen.getByText(/локальная защита/)).toBeInTheDocument();
});
it('reports quota errors and requires confirmation to discard', () => {
 localStorage.setItem(localDraftKey(), JSON.stringify({version:1,generation:null,state:state()}));
 vi.spyOn(window, 'confirm').mockReturnValue(false); const view = mount(); fireEvent.click(screen.getByText('Начать заново')); expect(localStorage.getItem(localDraftKey())).not.toBeNull();
 fireEvent.click(screen.getByText('Продолжить редактирование'));
 vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {throw Error();});
 fireEvent.change(screen.getByLabelText('Название шаблона'), {target:{value:'Changed'}}); fireEvent(window, new Event('pagehide'));
 expect(screen.getByText(/локальная защита/)).toBeInTheDocument(); view.unmount();
});
it('debounces edits and flushes the newest value before reload', () => {
 vi.useFakeTimers(); const view = mount('debounce', 1);
 fireEvent.change(screen.getByLabelText('Название шаблона'), {target:{value:'First'}});
 act(() => vi.advanceTimersByTime(200));
 fireEvent.change(screen.getByLabelText('Название шаблона'), {target:{value:'Latest'}});
 expect(localStorage.getItem(localDraftKey('debounce'))).toBeNull();
 act(() => vi.advanceTimersByTime(350));
 expect(readLocalDraft(localDraftKey('debounce')).draft?.state.name).toBe('Latest');
 view.unmount(); vi.useRealTimers();
});
it('persists reverting to the server state over an older local snapshot', () => {
 const view = mount('revert', 1); const input = screen.getByLabelText('Название шаблона');
 fireEvent.change(input, {target:{value:'Changed'}}); fireEvent(window, new Event('pagehide'));
 fireEvent.change(input, {target:{value:'Device'}}); fireEvent(window, new Event('pagehide'));
 expect(readLocalDraft(localDraftKey('revert')).draft?.state.name).toBe('Device'); view.unmount();
});
it('does not clear newer work when an older server save finishes', async () => {
 let done!: () => void; const save = vi.fn(() => new Promise<void>(resolve => { done = resolve; }));
 const view = mount('race', 1, save);
 fireEvent.change(screen.getByLabelText('Название шаблона'), {target:{value:'Submitted'}});
 fireEvent.click(screen.getByText('Save'));
 fireEvent.change(screen.getByLabelText('Название шаблона'), {target:{value:'Newer'}});
 await act(async () => done()); view.unmount();
 expect(readLocalDraft(localDraftKey('race')).draft?.state.name).toBe('Newer');
});
