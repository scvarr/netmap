import type { BlueprintFace, BlueprintInternalLink, BlueprintSlot, BlueprintSlotKind, CreateObjectBlueprintRequest, ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';

export interface BlueprintEditorState {
  name: string; defaultClass: string; width: number; height: number; fillColor: string;
  slots: BlueprintSlot[]; individualLinks: BlueprintInternalLink[];
}
export type BlueprintValidationError = 'nameRequired' | 'dimensionsPositive' | 'colorFormat' | 'duplicateSlotKeys' | 'individualSelfLink' | 'individualMissingPort' | 'duplicateIndividualLink';
export const internalLinkPairKey = (first: string, second: string) => [first, second].sort().join('\u0000');
export const cleanupLinks = (links: BlueprintInternalLink[], removed: Set<string>) => links.filter((link) => !removed.has(link.from_slot_key) && !removed.has(link.to_slot_key));
export const removeEndpoints = (state: BlueprintEditorState, keys: ReadonlySet<string>): BlueprintEditorState => ({
  ...state, slots: state.slots.filter((slot) => !keys.has(slot.key)), individualLinks: cleanupLinks(state.individualLinks, new Set(keys)),
});

type Axis = 'x' | 'y';
type Alignment = 'min' | 'center' | 'max';
const selectedSlots = (state: BlueprintEditorState, keys: ReadonlySet<string>) => state.slots.filter((slot) => keys.has(slot.key));
const reposition = (state: BlueprintEditorState, positions: Map<string, { x: number; y: number }>): BlueprintEditorState => ({
  ...state, slots: state.slots.map((slot) => positions.has(slot.key) ? { ...slot, rendered_position: positions.get(slot.key)! } : slot),
});
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const spatialOrder = (a: BlueprintSlot, b: BlueprintSlot) => a.rendered_position.y - b.rendered_position.y || a.rendered_position.x - b.rendered_position.x || a.key.localeCompare(b.key);
const boundedSpan = (min: number, max: number, minimum: number) => {
  const center = (min + max) / 2;
  const span = Math.min(1, Math.max(max - min, minimum));
  const start = clamp01(center - span / 2);
  return { start: Math.min(start, 1 - span), span };
};

export const translateSelection = (state: BlueprintEditorState, keys: ReadonlySet<string>, dx: number, dy: number): BlueprintEditorState => {
  const slots = selectedSlots(state, keys);
  if (!slots.length) return state;
  const deltaX = Math.max(-Math.min(...slots.map((slot) => slot.rendered_position.x)), Math.min(dx, 1 - Math.max(...slots.map((slot) => slot.rendered_position.x))));
  const deltaY = Math.max(-Math.min(...slots.map((slot) => slot.rendered_position.y)), Math.min(dy, 1 - Math.max(...slots.map((slot) => slot.rendered_position.y))));
  return reposition(state, new Map(slots.map((slot) => [slot.key, { x: slot.rendered_position.x + deltaX, y: slot.rendered_position.y + deltaY }])));
};
export const alignSelection = (state: BlueprintEditorState, keys: ReadonlySet<string>, axis: Axis, alignment: Alignment): BlueprintEditorState => {
  const slots = selectedSlots(state, keys);
  if (slots.length < 2) return state;
  const values = slots.map((slot) => slot.rendered_position[axis]);
  const value = alignment === 'min' ? Math.min(...values) : alignment === 'max' ? Math.max(...values) : (Math.min(...values) + Math.max(...values)) / 2;
  return reposition(state, new Map(slots.map((slot) => [slot.key, { ...slot.rendered_position, [axis]: value }])));
};
export const distributeSelection = (state: BlueprintEditorState, keys: ReadonlySet<string>, axis: Axis): BlueprintEditorState => {
  const slots = selectedSlots(state, keys).sort((a, b) => a.rendered_position[axis] - b.rendered_position[axis] || a.key.localeCompare(b.key));
  if (slots.length < 3) return state;
  const min = slots[0].rendered_position[axis];
  const step = (slots.at(-1)!.rendered_position[axis] - min) / (slots.length - 1);
  return reposition(state, new Map(slots.map((slot, index) => [slot.key, { ...slot.rendered_position, [axis]: min + step * index }])));
};
export const layoutSelectionRow = (state: BlueprintEditorState, keys: ReadonlySet<string>): BlueprintEditorState => {
  const slots = selectedSlots(state, keys).sort(spatialOrder);
  if (slots.length < 2) return state;
  const xs = slots.map((slot) => slot.rendered_position.x);
  const area = boundedSpan(Math.min(...xs), Math.max(...xs), Math.min(.8, .06 * (slots.length - 1)));
  const y = slots.reduce((sum, slot) => sum + slot.rendered_position.y, 0) / slots.length;
  return reposition(state, new Map(slots.map((slot, index) => [slot.key, { x: area.start + area.span * index / (slots.length - 1), y }])));
};
export const layoutSelectionTwoRows = (state: BlueprintEditorState, keys: ReadonlySet<string>): BlueprintEditorState => {
  const slots = selectedSlots(state, keys).sort(spatialOrder);
  if (slots.length < 3) return state;
  const xs = slots.map((slot) => slot.rendered_position.x);
  const ys = slots.map((slot) => slot.rendered_position.y);
  const columns = Math.ceil(slots.length / 2);
  const xArea = boundedSpan(Math.min(...xs), Math.max(...xs), Math.min(.8, .06 * (columns - 1)));
  const yArea = boundedSpan(Math.min(...ys), Math.max(...ys), .08);
  const topCount = columns;
  return reposition(state, new Map(slots.map((slot, index) => {
    const top = index < topCount;
    const rowIndex = top ? index : index - topCount;
    const rowCount = top ? topCount : slots.length - topCount;
    return [slot.key, { x: xArea.start + (rowCount === 1 ? xArea.span / 2 : xArea.span * rowIndex / (rowCount - 1)), y: yArea.start + (top ? 0 : yArea.span) }];
  })));
};

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
