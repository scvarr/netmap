import type { BlueprintFace, BlueprintInternalLink, BlueprintSlot, BlueprintSlotKind, CreateObjectBlueprintRequest, ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';

export interface BlueprintEditorState {
  name: string; defaultClass: string; width: number; height: number; fillColor: string;
  slots: BlueprintSlot[]; individualLinks: BlueprintInternalLink[];
}
export type BlueprintValidationError = 'nameRequired' | 'dimensionsPositive' | 'colorFormat' | 'duplicateSlotKeys' | 'individualSelfLink' | 'individualMissingPort' | 'duplicateIndividualLink';
export const internalLinkPairKey = (first: string, second: string) => [first, second].sort().join('\u0000');
export const cleanupLinks = (links: BlueprintInternalLink[], removed: Set<string>) => links.filter((link) => !removed.has(link.from_slot_key) && !removed.has(link.to_slot_key));
export const removeEndpoint = (state: BlueprintEditorState, key: string): BlueprintEditorState => ({ ...state, slots: state.slots.filter((slot) => slot.key !== key), individualLinks: cleanupLinks(state.individualLinks, new Set([key])) });

/** UUIDs are opaque and independent of names, position, face, and selection. */
export const addEndpoints = (state: BlueprintEditorState, kind: BlueprintSlotKind, count: number, face: BlueprintFace): BlueprintEditorState => {
  if (!Number.isInteger(count) || count < 1 || count > 256 || state.slots.filter((slot) => slot.face === face).length + count > 400) return state;
  const existing = state.slots.filter((slot) => slot.face === face).length;
  const slots = Array.from({ length: count }, (_, index): BlueprintSlot => {
    const ordinal = existing + index;
    const column = ordinal % 20;
    const row = Math.floor(ordinal / 20);
    return {
      key: crypto.randomUUID(), kind, face,
      display_name: kind === 'NETWORK_PORT' ? `Port ${ordinal + 1}` : `Point ${ordinal + 1}`,
      rendered_position: { x: (column + .5) / 20, y: (row + .5) / 20 },
    };
  });
  return { ...state, slots: [...state.slots, ...slots] };
};
export const hydrateBlueprintEditorState = (version: ObjectBlueprintVersionDocument): BlueprintEditorState => ({
  name: version.name, defaultClass: version.default_physical_object_class ?? '', width: version.body.width,
  height: version.body.height, fillColor: version.body.fill_color ?? '#28565a',
  slots: version.slots.map((slot) => ({ ...slot, rendered_position: { ...slot.rendered_position } })),
  individualLinks: version.internal_links.map((link) => ({ ...link })),
});
export const createBlueprintRequest = (state: BlueprintEditorState): { request?: CreateObjectBlueprintRequest; errors: BlueprintValidationError[] } => {
  const errors: BlueprintValidationError[] = [];
  if (!state.name.trim()) errors.push('nameRequired');
  if (!Number.isFinite(state.width) || state.width <= 0 || !Number.isFinite(state.height) || state.height <= 0) errors.push('dimensionsPositive');
  if (state.fillColor && !/^#[0-9A-Fa-f]{6}$/.test(state.fillColor)) errors.push('colorFormat');
  const keys = new Set(state.slots.map((slot) => slot.key));
  if (keys.size !== state.slots.length) errors.push('duplicateSlotKeys');
  const pairs = new Set<string>();
  for (const link of state.individualLinks) {
    if (link.from_slot_key === link.to_slot_key) errors.push('individualSelfLink');
    else if (!keys.has(link.from_slot_key) || !keys.has(link.to_slot_key)) errors.push('individualMissingPort');
    else { const pair = internalLinkPairKey(link.from_slot_key, link.to_slot_key); if (pairs.has(pair)) errors.push('duplicateIndividualLink'); pairs.add(pair); }
  }
  if (errors.length) return { errors };
  return { errors, request: {
    name: state.name.trim(), ...(state.defaultClass.trim() ? { default_physical_object_class: state.defaultClass.trim() } : {}),
    body: { kind: 'RECTANGLE', width: state.width, height: state.height, fill_color: state.fillColor },
    slots: state.slots.map((slot) => ({ ...slot, rendered_position: { ...slot.rendered_position } })),
    internal_links: state.individualLinks,
  } };
};
