import type { BlueprintInternalLink, CreateObjectBlueprintRequest, ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';
import type { PortBlockVersionDocument } from '../topology/portBlockTypes';

export interface BlueprintBlockInstance { instanceKey: string; portBlockVersionRef: string; portBlockName?: string; versionNumber?: number; ports: PortBlockVersionDocument['ports']; }
export interface BlueprintEditorState { name: string; defaultClass: string; width: number; height: number; fillColor: string; instances: BlueprintBlockInstance[]; individualLinks: BlueprintInternalLink[]; }
export type BlueprintValidationError = 'nameRequired' | 'dimensionsPositive' | 'colorFormat' | 'duplicateInstanceKey' | 'missingPortBlock' | 'individualSelfLink' | 'individualMissingPort' | 'duplicateIndividualLink';
const message: Record<BlueprintValidationError, string> = { nameRequired:'Укажите название шаблона.', dimensionsPositive:'Ширина и высота должны быть больше нуля.', colorFormat:'Цвет должен быть в формате #RRGGBB.', duplicateInstanceKey:'Повторяется ключ экземпляра Port Block.', missingPortBlock:'Выберите точную версию Port Block.', individualSelfLink:'Внутренняя связь не может соединять порт с самим собой.', individualMissingPort:'Внутренняя связь ссылается на отсутствующий порт.', duplicateIndividualLink:'Повторяется внутренняя связь.' };
const normalized = (value: string) => value.trim();
/** Must match ObjectBlueprintCatalog.composed_slot_key: FNV-1a-128(UTF-8(instance) + NUL + UTF-8(local)). */
export const composedSlotKey = (instanceKey: string, localId: string) => {
  let value = 0x6c62272e07bb014262b821756295c58dn;
  for (const byte of new TextEncoder().encode(`${instanceKey}\0${localId}`)) value = (value ^ BigInt(byte)) * 0x0000000001000000000000000000013bn & ((1n << 128n) - 1n);
  return `pb_${value.toString(16).padStart(32, '0')}`;
};
export const slotsForInstance = (item: BlueprintBlockInstance) => item.ports.map((port) => ({ key: composedSlotKey(item.instanceKey, port.local_id), label: `${item.portBlockName ?? item.portBlockVersionRef} · ${port.display_label}`, kind: port.kind }));
export const hydrateBlueprintEditorState = (version: ObjectBlueprintVersionDocument): BlueprintEditorState | null => version.composition ? { name:version.name, defaultClass:version.default_physical_object_class ?? '', width:version.body.width, height:version.body.height, fillColor:version.body.fill_color ?? '#28565a', instances:version.composition.instances.map((item) => ({ instanceKey:item.instance_key, portBlockVersionRef:item.port_block_version_ref.entity_id, ports:[] })), individualLinks:version.internal_links } : null;
export const generateBlueprint = (state: BlueprintEditorState) => {
  const errors: BlueprintValidationError[] = [];
  if (!normalized(state.name)) errors.push('nameRequired');
  if (!Number.isFinite(state.width) || state.width <= 0 || !Number.isFinite(state.height) || state.height <= 0) errors.push('dimensionsPositive');
  if (state.fillColor && !/^#[0-9A-Fa-f]{6}$/.test(state.fillColor)) errors.push('colorFormat');
  const keys = state.instances.map((item) => normalized(item.instanceKey)); if (keys.length !== new Set(keys).size) errors.push('duplicateInstanceKey');
  if (state.instances.some((item) => !item.portBlockVersionRef || !item.ports.length)) errors.push('missingPortBlock');
  const source = state.instances.flatMap(slotsForInstance); const slots = source.map((slot,index) => ({ key:slot.key, display_name:slot.label.split(' · ').at(-1)!, kind:slot.kind, anchor:{side:'RIGHT' as const, offset:(index+.5)/Math.max(source.length,1)} }));
  const known = new Set(slots.map((slot) => slot.key)); const pairs = new Set<string>();
  for (const link of state.individualLinks) { if (link.from_slot_key === link.to_slot_key) errors.push('individualSelfLink'); else if (!known.has(link.from_slot_key) || !known.has(link.to_slot_key)) errors.push('individualMissingPort'); else { const key=[link.from_slot_key,link.to_slot_key].sort().join('\u0000'); if (pairs.has(key)) errors.push('duplicateIndividualLink'); pairs.add(key); } }
  return { slots, internalLinks:state.individualLinks, errors:errors.map((item) => message[item]), validationErrors:errors };
};
export const createBlueprintRequest = (state: BlueprintEditorState): { request?: CreateObjectBlueprintRequest; errors: string[] } => { const generated=generateBlueprint(state); if (generated.errors.length) return {errors:generated.errors}; return { errors:[], request:{ name:normalized(state.name), ...(normalized(state.defaultClass)?{default_physical_object_class:normalized(state.defaultClass)}:{}), body:{kind:'RECTANGLE',width:state.width,height:state.height,...(state.fillColor?{fill_color:state.fillColor}:{})}, composition:{instances:state.instances.map((item)=>({instance_key:normalized(item.instanceKey),port_block_version_ref:{ref_type:'LIBRARY_RECORD',entity_type:'PortBlockVersion',entity_id:item.portBlockVersionRef}}))}, internal_links:state.individualLinks } }; };
