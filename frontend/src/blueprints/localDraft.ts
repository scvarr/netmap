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
    return { draft: d as unknown as LocalDraft };
  } catch { return { error: 'corrupt' }; }
}
