import type { BlueprintEditorState } from './editorModel';
export const localDraftKey = (id?: string) => `netmap.baseTemplate.localDraft.${id ?? 'new'}`;
interface LocalDraft { version: 1; generation: number | null; state: BlueprintEditorState }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string');
const numbers = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'number' && Number.isFinite(v[k]));
export function readLocalDraft(key: string): { draft?: LocalDraft; error?: 'corrupt' | 'unavailable' } {
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return { error: 'unavailable' }; }
  if (raw === null) return {};
  try {
    const d: unknown = JSON.parse(raw);
    if (!object(d) || d.version !== 1 || !(d.generation === null || typeof d.generation === 'number' && Number.isInteger(d.generation)) || !object(d.state)) throw Error();
    const s = d.state;
    if (!strings(s, ['name', 'defaultClass', 'fillColor', 'activePanelKey']) || !numbers(s, ['width', 'height', 'nextPanelNumber']) || !object(s.nextLocalNumberByPanel) || !Object.values(s.nextLocalNumberByPanel).every(n => typeof n === 'number' && Number.isInteger(n) && n > 0)) throw Error();
    if (!Array.isArray(s.panels) || !s.panels.length || !s.panels.every(p => object(p) && strings(p, ['panel_key', 'display_name']) && numbers(p, ['panel_number', 'x', 'y', 'width', 'height']))) throw Error();
    const panels = new Set(s.panels.map(p => p.panel_key));
    if (panels.size !== s.panels.length || !panels.has(s.activePanelKey)) throw Error();
    if (!Array.isArray(s.slots) || !s.slots.every(p => object(p) && strings(p, ['key', 'display_name', 'port_type_id', 'panel_key']) && panels.has(p.panel_key) && ['NETWORK_PORT', 'CONNECTION_POINT'].includes(p.kind as string) && object(p.rendered_position) && numbers(p.rendered_position, ['x', 'y']))) throw Error();
    const slots = new Set(s.slots.map(p => p.key));
    if (slots.size !== s.slots.length || !Array.isArray(s.individualLinks) || !s.individualLinks.every(p => object(p) && strings(p, ['from_slot_key', 'to_slot_key']) && slots.has(p.from_slot_key) && slots.has(p.to_slot_key))) throw Error();
    if (s.bays !== undefined && (!Array.isArray(s.bays) || !s.bays.every(p => object(p) && strings(p, ['bay_key', 'display_name', 'compatibility', 'panel_key']) && panels.has(p.panel_key) && (p.kind === 'LOGICAL' || (p.kind === undefined || p.kind === 'PLACED') && numbers(p, ['x', 'y', 'width', 'height']))))) throw Error();
    if (s.endpointNaming !== undefined && (!Array.isArray(s.endpointNaming) || s.endpointNaming.length !== 2 || !s.endpointNaming.every(p => object(p) && typeof p.panel === 'string' && ['name','spatial','manual'].includes(p.mode as string) && ['ltr','rtl'].includes(p.horizontal as string) && ['ttb','btt'].includes(p.vertical as string) && Array.isArray(p.order) && p.order.every(k => typeof k === 'string') && object(p.naming) && strings(p.naming, ['mask','start','step'])))) throw Error();
    const draft = d as unknown as LocalDraft;
    const state = draft.state;
    const keyValid = (key: string) => !!key.trim() && key === key.trim();
    const positiveInteger = (n: number) => Number.isSafeInteger(n) && n > 0;
    const unit = (n: number) => n >= 0 && n <= 1;
    if (draft.generation !== null && !positiveInteger(draft.generation)) throw Error();
    if (state.width <= 0 || state.height <= 0 || !positiveInteger(state.nextPanelNumber)) throw Error();
    if (state.panels.some(p => !keyValid(p.panel_key) || !positiveInteger(p.panel_number) || p.width <= 0 || p.height <= 0 || !Number.isFinite(p.x + p.width) || !Number.isFinite(p.y + p.height))) throw Error();
    if (new Set(state.panels.map(p => p.panel_number)).size !== state.panels.length || state.nextPanelNumber <= Math.max(...state.panels.map(p => p.panel_number))) throw Error();
    const left = Math.min(...state.panels.map(p => p.x)), top = Math.min(...state.panels.map(p => p.y));
    if (!Number.isFinite(Math.max(...state.panels.map(p => p.x + p.width)) - left) || !Number.isFinite(Math.max(...state.panels.map(p => p.y + p.height)) - top)) throw Error();
    if (state.panels.some(p => !Object.hasOwn(state.nextLocalNumberByPanel, p.panel_key)) || Object.entries(state.nextLocalNumberByPanel).some(([key, n]) => !panels.has(key) || !positiveInteger(n))) throw Error();
    if (state.slots.some(p => !keyValid(p.key) || !unit(p.rendered_position.x) || !unit(p.rendered_position.y))) throw Error();
    const pairs = new Set<string>();
    for (const link of state.individualLinks) {
      const pair = JSON.stringify([link.from_slot_key, link.to_slot_key].sort());
      if (link.from_slot_key === link.to_slot_key || pairs.has(pair)) throw Error();
      pairs.add(pair);
    }
    if (state.bays) {
      if (new Set(state.bays.map(b => b.bay_key)).size !== state.bays.length) throw Error();
      for (const bay of state.bays) {
        if (!keyValid(bay.bay_key)) throw Error();
        if (bay.kind === 'LOGICAL') {
          if ([bay.x, bay.y, bay.width, bay.height].some(n => n !== null && n !== undefined)) throw Error();
        } else if (!unit(bay.x) || !unit(bay.y) || bay.width <= 0 || bay.height <= 0 || bay.x + bay.width > 1 || bay.y + bay.height > 1) throw Error();
      }
    }
    // Preferences may legitimately outlive a deleted panel/port. The workspace
    // reconciles these references against current panels/ports when it opens.
    if (state.endpointNaming?.some(side => !keyValid(side.panel) || side.order.some(key => !keyValid(key)) || new Set(side.order).size !== side.order.length)) throw Error();
    return { draft };
  } catch { return { error: 'corrupt' }; }
}
