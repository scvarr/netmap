import type { BlueprintInternalLink, BlueprintSlot, BlueprintSlotKind, CreateObjectBlueprintRequest, ObjectBlueprintVersionDocument, PresentationPanel } from '../topology/objectBlueprintTypes';

export interface BlueprintEditorState {
  name: string; defaultClass: string; width: number; height: number; fillColor: string;
  panels: PresentationPanel[]; slots: BlueprintSlot[]; individualLinks: BlueprintInternalLink[];
  nextLocalNumber?: number;
}
export type BlueprintValidationError = 'nameRequired' | 'dimensionsPositive' | 'colorFormat' | 'duplicateSlotKeys' | 'individualSelfLink' | 'individualMissingPort' | 'duplicateIndividualLink' | 'multiPanelReadOnly';
export const internalLinkPairKey = (first: string, second: string) => [first, second].sort().join('\u0000');
export const cleanupLinks = (links: BlueprintInternalLink[], removed: Set<string>) => links.filter((link) => !removed.has(link.from_slot_key) && !removed.has(link.to_slot_key));
export const removeEndpoints = (state: BlueprintEditorState, keys: ReadonlySet<string>): BlueprintEditorState => ({
  ...state, slots: state.slots.filter((slot) => !keys.has(slot.key)), individualLinks: cleanupLinks(state.individualLinks, new Set(keys)),
});

type Axis = 'x' | 'y';
type Edge = 'start' | 'center' | 'end';
const selectedSlots = (state: BlueprintEditorState, keys: ReadonlySet<string>) => state.slots.filter((slot) => keys.has(slot.key));
const reposition = (state: BlueprintEditorState, positions: Map<string, { x: number; y: number }>): BlueprintEditorState => ({
  ...state, slots: state.slots.map((slot) => positions.has(slot.key) ? { ...slot, rendered_position: positions.get(slot.key)! } : slot),
});
const spatialOrder = (a: BlueprintSlot, b: BlueprintSlot) => a.rendered_position.y - b.rendered_position.y || a.rendered_position.x - b.rendered_position.x || a.key.localeCompare(b.key);
const boundedSpan = (min: number, max: number, minimum: number, inset = 0) => {
  const center = (min + max) / 2;
  const span = Math.min(1 - 2 * inset, Math.max(max - min, minimum));
  return { start: Math.max(inset, Math.min(center - span / 2, 1 - inset - span)), span };
};

export const translateSelection = (state: BlueprintEditorState, keys: ReadonlySet<string>, dx: number, dy: number): BlueprintEditorState => {
  const slots = selectedSlots(state, keys);
  if (!slots.length) return state;
  const { dx: deltaX, dy: deltaY } = constrainTranslation(slots, dx, dy);
  return reposition(state, new Map(slots.map((slot) => [slot.key, { x: slot.rendered_position.x + deltaX, y: slot.rendered_position.y + deltaY }])));
};
const constrainTranslation = (slots: BlueprintSlot[], dx: number, dy: number) => ({
  dx: Math.max(-Math.min(...slots.map((slot) => slot.rendered_position.x)), Math.min(dx, 1 - Math.max(...slots.map((slot) => slot.rendered_position.x)))),
  dy: Math.max(-Math.min(...slots.map((slot) => slot.rendered_position.y)), Math.min(dy, 1 - Math.max(...slots.map((slot) => slot.rendered_position.y)))),
});
export const alignSelectionLine = (state: BlueprintEditorState, keys: ReadonlySet<string>, line: 'horizontal' | 'vertical', inset = .02): BlueprintEditorState => {
  const slots = selectedSlots(state, keys);
  if (slots.length < 2) return state;
  const axis: Axis = line === 'horizontal' ? 'y' : 'x';
  const along: Axis = line === 'horizontal' ? 'x' : 'y';
  const values = slots.map((slot) => slot.rendered_position[axis]);
  const value = (Math.min(...values) + Math.max(...values)) / 2;
  const alongValues = slots.map((slot) => slot.rendered_position[along]);
  if (Math.max(...alongValues) - Math.min(...alongValues) > 1e-9) {
    return reposition(state, new Map(slots.map((slot) => [slot.key, { ...slot.rendered_position, [axis]: value }])));
  }
  // A row turned vertical (or a column turned horizontal) otherwise stacks every center.
  const ordered = [...slots].sort((first, second) =>
    first.rendered_position[axis] - second.rendered_position[axis] || first.key.localeCompare(second.key));
  const span = Math.min(1 - 2 * inset, .8, .06 * (slots.length - 1));
  const start = Math.max(inset, Math.min(alongValues[0] - span / 2, 1 - inset - span));
  return reposition(state, new Map(ordered.map((slot, index) => [slot.key, {
    ...slot.rendered_position, [axis]: value, [along]: start + span * index / (slots.length - 1),
  }])));
};
export const positionSelection = (state: BlueprintEditorState, keys: ReadonlySet<string>, axis: Axis, edge: Edge, inset = .02): BlueprintEditorState => {
  const slots = selectedSlots(state, keys);
  if (!slots.length) return state;
  const values = slots.map((slot) => slot.rendered_position[axis]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const delta = edge === 'start' ? inset - min : edge === 'end' ? 1 - inset - max : .5 - (min + max) / 2;
  return translateSelection(state, keys, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0);
};

export interface SnapTranslation { dx: number; dy: number; guideX?: number; guideY?: number }
/** Snap the moving bbox center to stationary centers or the body center, then clamp once for the group. */
export const snapSelectionTranslation = (visible: BlueprintSlot[], keys: ReadonlySet<string>, rawDx: number, rawDy: number, thresholdX: number, thresholdY: number): SnapTranslation => {
  const moving = visible.filter((slot) => keys.has(slot.key));
  if (!moving.length) return { dx: 0, dy: 0 };
  const stationary = visible.filter((slot) => !keys.has(slot.key));
  const snapAxis = (axis: Axis, delta: number, threshold: number) => {
    const values = moving.map((slot) => slot.rendered_position[axis]);
    const center = (Math.min(...values) + Math.max(...values)) / 2;
    const candidates = [...new Set([.5, ...stationary.map((slot) => slot.rendered_position[axis])])].sort((a, b) => a - b);
    const nearest = candidates.reduce<{ target?: number; distance: number }>((best, target) => {
      const distance = Math.abs(target - center - delta);
      return distance < best.distance ? { target, distance } : best;
    }, { distance: threshold + Number.EPSILON });
    return nearest.target === undefined || nearest.distance > threshold ? { delta } : { delta: nearest.target - center, guide: nearest.target };
  };
  const x = snapAxis('x', rawDx, thresholdX);
  const y = snapAxis('y', rawDy, thresholdY);
  const constrained = constrainTranslation(moving, x.delta, y.delta);
  return {
    ...constrained,
    ...(x.guide !== undefined && Math.abs(constrained.dx - x.delta) < 1e-9 ? { guideX: x.guide } : {}),
    ...(y.guide !== undefined && Math.abs(constrained.dy - y.delta) < 1e-9 ? { guideY: y.guide } : {}),
  };
};
export type DistributionRange = { mode: 'percent'; percent: number } | { mode: 'full' };
export const distributeSelection = (state: BlueprintEditorState, keys: ReadonlySet<string>, axis: Axis, range: DistributionRange, inset: number): BlueprintEditorState => {
  const slots = selectedSlots(state, keys).sort((a, b) => a.rendered_position[axis] - b.rendered_position[axis] || a.key.localeCompare(b.key));
  if (slots.length < 3) return state;
  if (range.mode === 'percent' && (!Number.isFinite(range.percent) || range.percent < 1 || range.percent > 100)) return state;
  const safeInset = Math.max(0, Math.min(.49, inset));
  const available = 1 - 2 * safeInset;
  const span = range.mode === 'full' ? available : Math.min(available, range.percent / 100);
  const values = slots.map((slot) => slot.rendered_position[axis]);
  const center = (Math.min(...values) + Math.max(...values)) / 2;
  const start = Math.max(safeInset, Math.min(center - span / 2, 1 - safeInset - span));
  return reposition(state, new Map(slots.map((slot, index) => [slot.key, { ...slot.rendered_position, [axis]: start + span * index / (slots.length - 1) }])));
};
interface LayoutMetrics { minGapX: number; minGapY: number; insetX: number; insetY: number }
const defaultLayoutMetrics: LayoutMetrics = { minGapX: 0, minGapY: 0, insetX: 0, insetY: 0 };
export const layoutSelectionRow = (state: BlueprintEditorState, keys: ReadonlySet<string>, metrics: LayoutMetrics = defaultLayoutMetrics): BlueprintEditorState => {
  const slots = selectedSlots(state, keys).sort(spatialOrder);
  if (slots.length < 2) return state;
  const xs = slots.map((slot) => slot.rendered_position.x);
  const area = boundedSpan(Math.min(...xs), Math.max(...xs), Math.max(Math.min(.8, .06 * (slots.length - 1)), metrics.minGapX * (slots.length - 1)), metrics.insetX);
  const y = Math.max(metrics.insetY, Math.min(1 - metrics.insetY, slots.reduce((sum, slot) => sum + slot.rendered_position.y, 0) / slots.length));
  return reposition(state, new Map(slots.map((slot, index) => [slot.key, { x: area.start + area.span * index / (slots.length - 1), y }])));
};
export const layoutSelectionTwoRows = (state: BlueprintEditorState, keys: ReadonlySet<string>, metrics: LayoutMetrics = defaultLayoutMetrics): BlueprintEditorState => {
  const slots = selectedSlots(state, keys).sort(spatialOrder);
  if (slots.length < 3) return state;
  const xs = slots.map((slot) => slot.rendered_position.x);
  const ys = slots.map((slot) => slot.rendered_position.y);
  const columns = Math.ceil(slots.length / 2);
  const xArea = boundedSpan(Math.min(...xs), Math.max(...xs), Math.max(Math.min(.8, .06 * (columns - 1)), metrics.minGapX * (columns - 1)), metrics.insetX);
  const yArea = boundedSpan(Math.min(...ys), Math.max(...ys), Math.max(.08, metrics.minGapY), metrics.insetY);
  const topCount = columns;
  return reposition(state, new Map(slots.map((slot, index) => {
    const top = index < topCount;
    const rowIndex = top ? index : index - topCount;
    const rowCount = top ? topCount : slots.length - topCount;
    return [slot.key, { x: xArea.start + (rowCount === 1 ? xArea.span / 2 : xArea.span * rowIndex / (rowCount - 1)), y: yArea.start + (top ? 0 : yArea.span) }];
  })));
};

/** UUIDs are opaque and independent of names, position, panel, and selection. */
export const addEndpoints = (state: BlueprintEditorState, kind: BlueprintSlotKind, count: number, panelKey: string): BlueprintEditorState => {
  if (state.panels.length !== 1 || !Number.isInteger(count) || count < 1 || count > 256 || state.slots.filter((slot) => slot.panel_key === panelKey).length + count > 400) return state;
  const panel = state.panels.find((item) => item.panel_key === panelKey);
  if (!panel) return state;
  const existing = state.slots.filter((slot) => slot.panel_key === panelKey).length;
  const maximum = Math.max(0, ...state.slots.filter((slot) => slot.panel_key === panelKey).map((slot) => new RegExp(`^${panel.panel_number}-(\\d+)$`).exec(slot.display_name)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1])));
  const next = Math.max(state.nextLocalNumber ?? 1, maximum + 1);
  const slots = Array.from({ length: count }, (_, index): BlueprintSlot => {
    const ordinal = existing + index;
    const column = ordinal % 20;
    const row = Math.floor(ordinal / 20);
    return {
      key: crypto.randomUUID(), kind, panel_key: panelKey,
      display_name: `${panel.panel_number}-${next + index}`,
      rendered_position: { x: (column + .5) / 20, y: (row + .5) / 20 },
    };
  });
  return { ...state, nextLocalNumber: next + count, slots: [...state.slots, ...slots] };
};
export const hydrateBlueprintEditorState = (version: ObjectBlueprintVersionDocument): BlueprintEditorState => ({
  name: version.name, defaultClass: version.default_physical_object_class ?? '', width: version.body.width,
  height: version.body.height, fillColor: version.body.fill_color ?? '#28565a',
  panels: version.panels.map((panel) => ({ ...panel })),
  slots: version.slots.map((slot) => ({ ...slot, rendered_position: { ...slot.rendered_position } })),
  individualLinks: version.internal_links.map((link) => ({ ...link })),
});
export const createBlueprintRequest = (state: BlueprintEditorState): { request?: CreateObjectBlueprintRequest; errors: BlueprintValidationError[] } => {
  const errors: BlueprintValidationError[] = [];
  if (state.panels.length !== 1) errors.push('multiPanelReadOnly');
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
    panels: state.panels.map((panel) => ({ ...panel, width: state.width, height: state.height })),
    slots: state.slots.map((slot) => ({ ...slot, rendered_position: { ...slot.rendered_position } })),
    internal_links: state.individualLinks,
  } };
};
