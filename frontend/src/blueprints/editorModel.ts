import type { BlueprintInternalLink, BlueprintSlot, BlueprintSlotKind, CreateObjectBlueprintRequest, ObjectBlueprintVersionDocument, PresentationPanel } from '../topology/objectBlueprintTypes';

export interface BlueprintEditorState {
  name: string; defaultClass: string; width: number; height: number; fillColor: string;
  panels: PresentationPanel[]; slots: BlueprintSlot[]; individualLinks: BlueprintInternalLink[];
  activePanelKey: string; nextPanelNumber: number; nextLocalNumberByPanel: Record<string, number>;
}
export type BlueprintValidationError = 'nameRequired' | 'panelNameRequired' | 'dimensionsPositive' | 'colorFormat' | 'duplicateSlotKeys' | 'individualSelfLink' | 'individualMissingPort' | 'duplicateIndividualLink';
export const internalLinkPairKey = (first: string, second: string) => [first, second].sort().join('\u0000');
export const cleanupLinks = (links: BlueprintInternalLink[], removed: Set<string>) => links.filter((link) => !removed.has(link.from_slot_key) && !removed.has(link.to_slot_key));
export const removeEndpoints = (state: BlueprintEditorState, keys: ReadonlySet<string>): BlueprintEditorState => {
  const slots = state.slots.filter((slot) => !keys.has(slot.key));
  const nextLocalNumberByPanel = { ...state.nextLocalNumberByPanel };
  for (const panel of state.panels) if (!slots.some((slot) => slot.panel_key === panel.panel_key)) nextLocalNumberByPanel[panel.panel_key] = 1;
  return {
    ...state, slots, nextLocalNumberByPanel,
    individualLinks: cleanupLinks(state.individualLinks, new Set(keys)),
  };
};
export type PanelDirection = 'above' | 'right' | 'below' | 'left';
export type PanelHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export type PanelRectangle = Pick<PresentationPanel, 'x' | 'y' | 'width' | 'height'>;
export interface PanelGeometryResult { rectangle: PanelRectangle; guides: { x?: number; y?: number } }
const nearestSnap = (edges: number[], targets: number[], threshold: number) => {
  let best: { delta: number; guide: number } | undefined;
  for (const edge of edges) for (const target of targets) {
    const delta = target - edge;
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, guide: target };
  }
  return best;
};
export const panelGestureGeometry = (
  panel: PresentationPanel, others: PresentationPanel[], kind: 'move' | PanelHandle,
  dx: number, dy: number, snapThreshold: number, minimum: number,
): PanelGeometryResult => {
  const horizontal = others.flatMap((item) => [item.x, item.x + item.width]);
  const vertical = others.flatMap((item) => [item.y, item.y + item.height]);
  if (kind === 'move') {
    const x = panel.x + dx; const y = panel.y + dy;
    const sx = nearestSnap([x, x + panel.width], horizontal, snapThreshold);
    const sy = nearestSnap([y, y + panel.height], vertical, snapThreshold);
    return { rectangle: { x: x + (sx?.delta ?? 0), y: y + (sy?.delta ?? 0), width: panel.width, height: panel.height }, guides: { x: sx?.guide, y: sy?.guide } };
  }
  const west = kind.includes('w'); const east = kind.includes('e');
  const north = kind.includes('n'); const south = kind.includes('s');
  const minWidth = Math.min(panel.width, minimum); const minHeight = Math.min(panel.height, minimum);
  let left = panel.x + (west ? Math.min(dx, panel.width - minWidth) : 0);
  let right = panel.x + panel.width + (east ? Math.max(dx, minWidth - panel.width) : 0);
  let top = panel.y + (north ? Math.min(dy, panel.height - minHeight) : 0);
  let bottom = panel.y + panel.height + (south ? Math.max(dy, minHeight - panel.height) : 0);
  const sx = west || east ? nearestSnap([west ? left : right], horizontal, snapThreshold) : undefined;
  const sy = north || south ? nearestSnap([north ? top : bottom], vertical, snapThreshold) : undefined;
  if (sx && (west ? right - (left + sx.delta) >= minWidth : right + sx.delta - left >= minWidth)) {
    if (west) left += sx.delta; else right += sx.delta;
  }
  if (sy && (north ? bottom - (top + sy.delta) >= minHeight : bottom + sy.delta - top >= minHeight)) {
    if (north) top += sy.delta; else bottom += sy.delta;
  }
  const snappedX = sx && (west ? left === sx.guide : right === sx.guide) ? sx.guide : undefined;
  const snappedY = sy && (north ? top === sy.guide : bottom === sy.guide) ? sy.guide : undefined;
  return { rectangle: { x: left, y: top, width: right - left, height: bottom - top }, guides: { x: snappedX, y: snappedY } };
};
export const setPanelRectangle = (state: BlueprintEditorState, key: string, rectangle: PanelRectangle): BlueprintEditorState => ({
  ...state, panels: state.panels.map((panel) => panel.panel_key === key ? { ...panel, ...rectangle } : panel),
});
export const compositionBounds = (panels: PresentationPanel[]) => ({
  x: Math.min(...panels.map((panel) => panel.x)), y: Math.min(...panels.map((panel) => panel.y)),
  width: Math.max(...panels.map((panel) => panel.x + panel.width)) - Math.min(...panels.map((panel) => panel.x)),
  height: Math.max(...panels.map((panel) => panel.y + panel.height)) - Math.min(...panels.map((panel) => panel.y)),
});
export const addPanel = (state: BlueprintEditorState, direction: PanelDirection): BlueprintEditorState => {
  const active = state.panels.find((panel) => panel.panel_key === state.activePanelKey);
  if (!active) return state;
  const number = state.nextPanelNumber;
  const panel: PresentationPanel = {
    panel_key: crypto.randomUUID(), panel_number: number, display_name: `Панель ${number}`,
    x: active.x + (direction === 'right' ? active.width : direction === 'left' ? -active.width : 0),
    y: active.y + (direction === 'below' ? active.height : direction === 'above' ? -active.height : 0),
    width: active.width, height: active.height,
  };
  return { ...state, panels: [...state.panels, panel], activePanelKey: panel.panel_key, nextPanelNumber: number + 1, nextLocalNumberByPanel: { ...state.nextLocalNumberByPanel, [panel.panel_key]: 1 } };
};
export const renameActivePanel = (state: BlueprintEditorState, name: string): BlueprintEditorState => ({
  ...state, panels: state.panels.map((panel) => panel.panel_key === state.activePanelKey ? { ...panel, display_name: name } : panel),
});
export const deleteActivePanel = (state: BlueprintEditorState): BlueprintEditorState => {
  if (state.panels.length <= 1 || state.slots.some((slot) => slot.panel_key === state.activePanelKey)) return state;
  const panels = state.panels.filter((panel) => panel.panel_key !== state.activePanelKey);
  const nextLocalNumberByPanel = { ...state.nextLocalNumberByPanel };
  delete nextLocalNumberByPanel[state.activePanelKey];
  return { ...state, panels, activePanelKey: [...panels].sort((a, b) => a.panel_number - b.panel_number)[0].panel_key, nextLocalNumberByPanel };
};

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
  if (panelKey !== state.activePanelKey || !Number.isInteger(count) || count < 1 || count > 256 || state.slots.filter((slot) => slot.panel_key === panelKey).length + count > 400) return state;
  const panel = state.panels.find((item) => item.panel_key === panelKey);
  if (!panel) return state;
  const existing = state.slots.filter((slot) => slot.panel_key === panelKey).length;
  const maximum = Math.max(0, ...state.slots.filter((slot) => slot.panel_key === panelKey).map((slot) => new RegExp(`^${panel.panel_number}-(\\d+)$`).exec(slot.display_name)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1])));
  const next = Math.max(state.nextLocalNumberByPanel[panelKey] ?? 1, maximum + 1);
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
  return { ...state, nextLocalNumberByPanel: { ...state.nextLocalNumberByPanel, [panelKey]: next + count }, slots: [...state.slots, ...slots] };
};
export const hydrateBlueprintEditorState = (version: ObjectBlueprintVersionDocument): BlueprintEditorState => ({
  name: version.name, defaultClass: version.default_physical_object_class ?? '', width: version.body.width,
  height: version.body.height, fillColor: version.body.fill_color ?? '#28565a',
  panels: version.panels.map((panel) => ({ ...panel })),
  slots: version.slots.map((slot) => ({ ...slot, rendered_position: { ...slot.rendered_position } })),
  individualLinks: version.internal_links.map((link) => ({ ...link })),
  activePanelKey: [...version.panels].sort((a, b) => a.panel_number - b.panel_number)[0].panel_key,
  nextPanelNumber: version.next_panel_number,
  nextLocalNumberByPanel: Object.fromEntries(version.panels.map((panel) => [panel.panel_key, Math.max(1, ...version.slots.filter((slot) => slot.panel_key === panel.panel_key).map((slot) => new RegExp(`^${panel.panel_number}-(\\d+)$`).exec(slot.display_name)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1]) + 1))])),
});
export const createBlueprintRequest = (state: BlueprintEditorState): { request?: CreateObjectBlueprintRequest; errors: BlueprintValidationError[] } => {
  const errors: BlueprintValidationError[] = [];
  if (!state.name.trim()) errors.push('nameRequired');
  if (state.panels.some((panel) => !panel.display_name.trim())) errors.push('panelNameRequired');
  const bounds = compositionBounds(state.panels);
  if (!state.panels.length || state.panels.some((panel) => !Number.isFinite(panel.width) || panel.width <= 0 || !Number.isFinite(panel.height) || panel.height <= 0) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) errors.push('dimensionsPositive');
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
    body: { kind: 'RECTANGLE', width: bounds.width, height: bounds.height, fill_color: state.fillColor },
    panels: state.panels.map((panel) => ({ ...panel })),
    slots: state.slots.map((slot) => ({ ...slot, rendered_position: { ...slot.rendered_position } })),
    internal_links: state.individualLinks,
  } };
};
