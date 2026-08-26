import type { BlueprintInternalLink, CreateObjectBlueprintRequest, ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';
import type { PortBlockDataSource, PortBlockVersionDocument } from '../topology/portBlockTypes';

export interface BlueprintBlockInstance { instanceKey: string; portBlockRef: string; portBlockVersionRef: string; portBlockName: string; versionNumber: number; ports: PortBlockVersionDocument['ports']; resolvedSlotKeys: Record<string, string>; }
export interface BlueprintEditorState { name: string; defaultClass: string; width: number; height: number; fillColor: string; instances: BlueprintBlockInstance[]; individualLinks: BlueprintInternalLink[]; }
export type BlueprintValidationError = 'nameRequired' | 'dimensionsPositive' | 'colorFormat' | 'duplicateInstanceKey' | 'missingPortBlock' | 'individualSelfLink' | 'individualMissingPort' | 'duplicateIndividualLink';
const normalized = (value: string) => value.trim();
/** Must match ObjectBlueprintCatalog.composed_slot_key. */
export const composedSlotKey = async (instanceKey: string, localId: string) => {
  const instance = new TextEncoder().encode(instanceKey); const local = new TextEncoder().encode(localId);
  const bytes = new Uint8Array(8 + instance.length + local.length); const view = new DataView(bytes.buffer);
  view.setUint32(0, instance.length, false); bytes.set(instance, 4); view.setUint32(4 + instance.length, local.length, false); bytes.set(local, 8 + instance.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `pb_${Array.from(digest, (part) => part.toString(16).padStart(2, '0')).join('')}`;
};
export const resolveSlotKeys = async (item: BlueprintBlockInstance) => Object.fromEntries(await Promise.all(item.ports.map(async (port) => [port.local_id, await composedSlotKey(item.instanceKey, port.local_id)])));
export const slotsForInstance = (item: BlueprintBlockInstance) => item.ports.flatMap((port) => item.resolvedSlotKeys?.[port.local_id] ? [{ key:item.resolvedSlotKeys[port.local_id], label: `${item.portBlockName ?? item.portBlockVersionRef} · ${port.display_label}`, kind: port.kind }] : []);
export const hydrateBlueprintEditorState = async (version: ObjectBlueprintVersionDocument, source: PortBlockDataSource): Promise<BlueprintEditorState | null> => {
  if (!version.composition) return null;
  const instances = await Promise.all(version.composition.instances.map(async (item) => {
    const exact = await source.loadPortBlockVersion(item.port_block_ref.entity_id, item.port_block_version_ref.entity_id);
    if (exact.port_block_ref.entity_id !== item.port_block_ref.entity_id || exact.version_ref.entity_id !== item.port_block_version_ref.entity_id) throw new Error('Exact Port Block version response does not match Blueprint provenance.');
    const instance = { instanceKey:item.instance_key, portBlockRef:item.port_block_ref.entity_id, portBlockVersionRef:item.port_block_version_ref.entity_id, portBlockName:exact.name, versionNumber:exact.version_number, ports:exact.ports, resolvedSlotKeys:{} };
    return { ...instance, resolvedSlotKeys:await resolveSlotKeys(instance) };
  }));
  return { name:version.name, defaultClass:version.default_physical_object_class ?? '', width:version.body.width, height:version.body.height, fillColor:version.body.fill_color ?? '#28565a', instances, individualLinks:version.internal_links };
};
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
  return { slots, internalLinks:state.individualLinks, errors, validationErrors:errors };
};
export const createBlueprintRequest = (state: BlueprintEditorState): { request?: CreateObjectBlueprintRequest; errors: BlueprintValidationError[] } => { const generated=generateBlueprint(state); if (generated.errors.length) return {errors:generated.errors}; return { errors:[], request:{ name:normalized(state.name), ...(normalized(state.defaultClass)?{default_physical_object_class:normalized(state.defaultClass)}:{}), body:{kind:'RECTANGLE',width:state.width,height:state.height,...(state.fillColor?{fill_color:state.fillColor}:{})}, composition:{instances:state.instances.map((item)=>({instance_key:normalized(item.instanceKey),port_block_version_ref:{ref_type:'LIBRARY_RECORD',entity_type:'PortBlockVersion',entity_id:item.portBlockVersionRef}}))}, internal_links:state.individualLinks } }; };
