import type { BlueprintFace, BlueprintInternalLink, BlueprintPortBlockPlacement, CreateObjectBlueprintRequest, ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';
import type { PortBlockDataSource, PortBlockVersionDocument } from '../topology/portBlockTypes';

export interface BlueprintBlockInstance { instanceKey: string; portBlockRef: string; portBlockVersionRef: string; face?: BlueprintFace; placement?: BlueprintPortBlockPlacement; portBlockName: string; versionNumber: number; ports: PortBlockVersionDocument['ports']; resolvedSlotKeys: Record<string, string>; }
export interface BlueprintEditorState { name: string; defaultClass: string; width: number; height: number; fillColor: string; instances: BlueprintBlockInstance[]; individualLinks: BlueprintInternalLink[]; }
export type BulkInternalLinkMode = 'SEQUENTIAL' | 'REVERSE';
export type BlueprintValidationError = 'nameRequired' | 'dimensionsPositive' | 'colorFormat' | 'duplicateInstanceKey' | 'missingPortBlock' | 'individualSelfLink' | 'individualMissingPort' | 'duplicateIndividualLink';
const normalized = (value: string) => value.trim();
export const clampPlacement = (placement: BlueprintPortBlockPlacement): BlueprintPortBlockPlacement => {
  const width = Math.min(1, Math.max(.04, placement.width)); const height = Math.min(1, Math.max(.04, placement.height));
  return { width, height, x: Math.min(Math.max(0, placement.x), 1 - width), y: Math.min(Math.max(0, placement.y), 1 - height) };
};
/** Deterministic editor-only fallback for immutable rows written before c.5. */
export const fallbackPlacement = (index: number): BlueprintPortBlockPlacement => {
  const width = .36; const height = .22; const columns = 2;
  return clampPlacement({ x: .08 + (index % columns) * .48, y: .12 + Math.floor(index / columns) * .28, width, height });
};
export const faceLocalIndex = (instances: Array<Pick<BlueprintBlockInstance, 'face'>>, index: number) => instances.slice(0, index).filter((item) => (item.face ?? 'FRONT') === (instances[index].face ?? 'FRONT')).length;
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
export const cleanupLinks = (links: BlueprintInternalLink[], removed: Set<string>) => links.filter((link) => !removed.has(link.from_slot_key) && !removed.has(link.to_slot_key));
/** Removes authoring state only; immutable Port Block and Blueprint versions stay untouched. */
export const removeBlueprintBlockInstance = (state: BlueprintEditorState, instanceKey: string): BlueprintEditorState => {
  const instance = state.instances.find((item) => item.instanceKey === instanceKey);
  if (!instance) return state;
  return {
    ...state,
    instances: state.instances.filter((item) => item.instanceKey !== instanceKey),
    individualLinks: cleanupLinks(state.individualLinks, new Set(Object.values(instance.resolvedSlotKeys))),
  };
};
export const internalLinkPairKey = (first: string, second: string) => [first, second].sort().join('\u0000');
const orderedSlotKeys = (item: BlueprintBlockInstance) => item.ports.slice().sort((first, second) => first.layout_order - second.layout_order).flatMap((port) => item.resolvedSlotKeys[port.local_id] ? [item.resolvedSlotKeys[port.local_id]] : []);
export const addBulkInternalLinks = (links: BlueprintInternalLink[], first: BlueprintBlockInstance | undefined, second: BlueprintBlockInstance | undefined, mode: BulkInternalLinkMode): BlueprintInternalLink[] => {
  if (!first || !second || first.instanceKey === second.instanceKey) return links;
  const from = orderedSlotKeys(first); const to = orderedSlotKeys(second); const existing = new Set(links.map((link) => internalLinkPairKey(link.from_slot_key, link.to_slot_key)));
  const additions: BlueprintInternalLink[] = [];
  from.forEach((fromSlot, index) => {
    const toSlot = mode === 'SEQUENTIAL' ? to[index] : to[to.length - 1 - index];
    if (toSlot && fromSlot !== toSlot && !existing.has(internalLinkPairKey(fromSlot, toSlot))) {
      additions.push({ from_slot_key: fromSlot, to_slot_key: toSlot });
      existing.add(internalLinkPairKey(fromSlot, toSlot));
    }
  });
  return [...links, ...additions];
};
export const removeInternalLinksBetweenInstances = (links: BlueprintInternalLink[], first: BlueprintBlockInstance | undefined, second: BlueprintBlockInstance | undefined) => {
  if (!first || !second || first.instanceKey === second.instanceKey) return links;
  const firstSlots = new Set(Object.values(first.resolvedSlotKeys)); const secondSlots = new Set(Object.values(second.resolvedSlotKeys));
  return links.filter((link) => !((firstSlots.has(link.from_slot_key) && secondSlots.has(link.to_slot_key)) || (secondSlots.has(link.from_slot_key) && firstSlots.has(link.to_slot_key))));
};
export const hydrateBlueprintEditorState = async (version: ObjectBlueprintVersionDocument, source: PortBlockDataSource): Promise<BlueprintEditorState | null> => {
  if (!version.composition) return null;
  const instances = await Promise.all(version.composition.instances.map(async (item, index, sourceItems) => {
    const exact = await source.loadPortBlockVersion(item.port_block_ref.entity_id, item.port_block_version_ref.entity_id);
    if (exact.port_block_ref.entity_id !== item.port_block_ref.entity_id || exact.version_ref.entity_id !== item.port_block_version_ref.entity_id) throw new Error('Exact Port Block version response does not match Blueprint provenance.');
    const instance = { instanceKey:item.instance_key, portBlockRef:item.port_block_ref.entity_id, portBlockVersionRef:item.port_block_version_ref.entity_id, face:item.face ?? 'FRONT' as BlueprintFace, placement: item.placement ? clampPlacement(item.placement) : fallbackPlacement(faceLocalIndex(sourceItems, index)), portBlockName:exact.name, versionNumber:exact.version_number, ports:exact.ports, resolvedSlotKeys:{} };
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
  const source = state.instances.flatMap(slotsForInstance); const slots = source.map((slot) => ({ key:slot.key, display_name:slot.label.split(' · ').at(-1)!, kind:slot.kind }));
  const known = new Set(slots.map((slot) => slot.key)); const pairs = new Set<string>();
  for (const link of state.individualLinks) { if (link.from_slot_key === link.to_slot_key) errors.push('individualSelfLink'); else if (!known.has(link.from_slot_key) || !known.has(link.to_slot_key)) errors.push('individualMissingPort'); else { const key=[link.from_slot_key,link.to_slot_key].sort().join('\u0000'); if (pairs.has(key)) errors.push('duplicateIndividualLink'); pairs.add(key); } }
  return { slots, internalLinks:state.individualLinks, errors, validationErrors:errors };
};
export const createBlueprintRequest = (state: BlueprintEditorState): { request?: CreateObjectBlueprintRequest; errors: BlueprintValidationError[] } => { const generated=generateBlueprint(state); if (generated.errors.length) return {errors:generated.errors}; return { errors:[], request:{ name:normalized(state.name), ...(normalized(state.defaultClass)?{default_physical_object_class:normalized(state.defaultClass)}:{}), body:{kind:'RECTANGLE',width:state.width,height:state.height,...(state.fillColor?{fill_color:state.fillColor}:{})}, composition:{instances:state.instances.map((item, index)=>({instance_key:normalized(item.instanceKey),port_block_version_ref:{ref_type:'LIBRARY_RECORD',entity_type:'PortBlockVersion',entity_id:item.portBlockVersionRef},face:item.face ?? 'FRONT', placement:clampPlacement(item.placement ?? fallbackPlacement(faceLocalIndex(state.instances, index)))}))}, internal_links:state.individualLinks } }; };
