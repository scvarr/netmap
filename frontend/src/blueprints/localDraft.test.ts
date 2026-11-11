import { beforeEach, expect, it } from 'vitest';
import { newBlueprintEditorState } from '../pages/BaseTemplateEditor';
import { addEndpoints, type BlueprintEditorState } from './editorModel';
import { localDraftKey, readLocalDraft } from './localDraft';
beforeEach(() => localStorage.clear());
const valid = () => {
  const initial = newBlueprintEditorState();
  const s = addEndpoints(initial, 'NETWORK_PORT', 2, initial.activePanelKey, 'type');
  s.bays = [{kind: 'PLACED', bay_key: 'bay', display_name: '', compatibility: '', panel_key: s.activePanelKey, x: 0, y: 0, width: .5, height: .5}];
  s.individualLinks = [{from_slot_key: s.slots[0].key, to_slot_key: s.slots[1].key}];
  s.endpointNaming = [0, 1].map(() => ({ panel: s.activePanelKey, mode: 'manual', order: s.slots.map(p => p.key), horizontal: 'ltr', vertical: 'ttb', naming: {mask: '', start: '', step: ''} }));
  return s;
};
const read = (state: BlueprintEditorState) => {
  localStorage.setItem(localDraftKey(), JSON.stringify({version: 1, generation: null, state}));
  return readLocalDraft(localDraftKey());
};
it('restores unfinished editable fields and legal boundary geometry', () => {
 const s = valid(); s.panels[0].display_name = ''; s.panels[0].x = -100;
 s.slots[0].rendered_position = {x: 0, y: 1};
 expect(read(s).draft?.state).toEqual(s);
});
it.each<[string, (s: BlueprintEditorState) => void]>([
 ['zero panel width', s => {s.panels[0].width = 0;}],
 ['negative panel height', s => {s.panels[0].height = -1;}],
 ['nonfinite panel position', s => {s.panels[0].x = Infinity;}],
 ['duplicate panels', s => {s.panels.push({...s.panels[0]});}],
 ['blank panel key', s => {s.panels[0].panel_key = ' ';}],
 ['port outside panel', s => {s.slots[0].rendered_position.x = 1.01;}],
 ['port on missing panel', s => {s.slots[0].panel_key = 'missing';}],
 ['bay on missing panel', s => {s.bays![0].panel_key = 'missing';}],
 ['bay outside panel', s => {s.bays![0] = {...s.bays![0], kind: 'PLACED', x: .9, y: 0, width: .5, height: .5};}],
 ['duplicate bay keys', s => {s.bays!.push({...s.bays![0]});}],
 ['link to missing port', s => {s.individualLinks[0].to_slot_key = 'missing';}],
 ['self link', s => {s.individualLinks[0].to_slot_key = s.individualLinks[0].from_slot_key;}],
 ['duplicate reversed link', s => {const l=s.individualLinks[0];s.individualLinks.push({from_slot_key:l.to_slot_key,to_slot_key:l.from_slot_key});}],
 ['duplicate naming keys', s => {s.endpointNaming![0].order.push(s.slots[0].key);}],
 ['blank naming key', s => {s.endpointNaming![0].order = [''];}],
 ['invalid naming mode', s => {Object.assign(s.endpointNaming![0], {mode: 'broken'});}],
 ['invalid naming shape', s => {Object.assign(s.endpointNaming![0], {naming: null});}],
])('rejects %s without returning state', (_name, mutate) => {
 const s = valid(); mutate(s); expect(read(s)).toEqual({error: 'corrupt'});
});
