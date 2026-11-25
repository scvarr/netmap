import { isModulePlaceMarker, moduleMount, mountTypeId, type ModuleMount } from '../topology/hardwareModules';
import type { BaseInternalLink, BlueprintSlot, BlueprintSlotKind, CreateBaseTemplateRequest, BaseTemplateRevisionDocument, PresentationPanel } from '../topology/baseTemplateTypes';
import { isPlacedBay, moduleBayMarkers, positionModulePort, type BlueprintMarker } from '../topology/hardwareModules';

import { internalOccupancy, memberAddressKey, appendMemberPairs, mappedMemberPairs, memberMapping, removeMemberPairs, validateMemberPairs, type MemberPair, type MemberPairError } from './memberMappings';

export interface EndpointNamingSide {
  panel: string; mode: 'name' | 'spatial' | 'manual'; order: string[];
  horizontal: 'ltr' | 'rtl'; vertical: 'ttb' | 'btt';
  naming: { mask: string; start: string; step: string };
}
export interface BlueprintEditorState {
  endpointNaming?: EndpointNamingSide[];
  name: string; defaultClass: string; width: number; height: number; fillColor: string;
  bays?: import("../topology/hardwareModules").ModuleBay[];
  panels: PresentationPanel[]; slots: BlueprintSlot[]; individualLinks: BaseInternalLink[];
  activePanelKey: string; nextPanelNumber: number; nextLocalNumberByPanel: Record<string, number>;
}
export type BlueprintValidationError = 'nameRequired' | 'panelNameRequired' | 'dimensionsPositive' | 'colorFormat' | 'duplicateSlotKeys' | 'individualSelfLink' | 'individualMissingPort' | 'duplicateIndividualLink' | 'invalidMember' | 'invalidRole' | 'occupied';
export const internalLinkPairKey = (first: string, second: string) => [first, second].sort().join('\u0000');
const singleMemberMapping = { from_member_index: 1, to_member_index: 1 };

export function linkMemberPairs(link: BaseInternalLink): MemberPair[] {
  return mappedMemberPairs(link.from_slot_key, link.to_slot_key, link.member_mappings ?? [singleMemberMapping]);
}

const baseMemberEndpoints = (slots: readonly BlueprintSlot[]) => slots.map(slot => ({
  key: slot.key,
  cardinality: slot.cardinality ?? 1,
  allowsInternalLink: slot.kind === 'CONNECTION_POINT' || slot.kind === 'NETWORK_PORT' && (slot.cardinality ?? 1) === 1,
}));

export const blueprintInternalOccupancy = (state: BlueprintEditorState) => internalOccupancy(state.individualLinks.flatMap(linkMemberPairs));

export function validateBlueprintMemberPairs(
  state: BlueprintEditorState, pairs: readonly MemberPair[], occupied = blueprintInternalOccupancy(state),
): MemberPairError | undefined {
  return validateMemberPairs(baseMemberEndpoints(state.slots), pairs, occupied);
}

export function applyMemberMappings(state: BlueprintEditorState, pairs: readonly MemberPair[]): BlueprintEditorState {
  if (!pairs.length || validateBlueprintMemberPairs(state, pairs)) return state;
  const individualLinks = appendMemberPairs(state.individualLinks, pairs, link => [link.from_slot_key, link.to_slot_key],
    (link, pair) => ({
      from_slot_key: pair.a.endpointKey, to_slot_key: pair.b.endpointKey,
      member_mappings: [...(link ? link.member_mappings ?? [singleMemberMapping] : []), memberMapping(pair)],
    }));
  return { ...state, individualLinks };
}

export function removeMemberMappings(state: BlueprintEditorState, keys: ReadonlySet<string>): BlueprintEditorState {
  return { ...state, individualLinks: removeMemberPairs(state.individualLinks, keys, linkMemberPairs,
    (link, indices) => ({ ...link, member_mappings: indices.map(index => link.member_mappings![index]) })) };
}

export function blueprintWiringError(state: BlueprintEditorState): BlueprintValidationError | undefined {
  const slots = new Map(state.slots.map(slot => [slot.key, slot]));
  const pairs = new Set<string>();
  for (const link of state.individualLinks) {
    const { from_slot_key: a, to_slot_key: b, member_mappings: mappings } = link;
    if (a === b) return 'individualSelfLink';
    if (!slots.has(a) || !slots.has(b)) return 'individualMissingPort';
    const key = internalLinkPairKey(a, b);
    if (pairs.has(key)) return 'duplicateIndividualLink';
    pairs.add(key);
    if (mappings?.length === 0 || mappings === undefined && [a, b].some(k => (slots.get(k)?.cardinality ?? 1) !== 1)) return 'invalidMember';
  }
  const error = validateMemberPairs(baseMemberEndpoints(state.slots), state.individualLinks.flatMap(linkMemberPairs));
  if (error === 'missingEndpoint') return 'individualMissingPort';
  if (error === 'selfLink') return 'individualSelfLink';
  return error;
}
export const cleanupLinks = (links: BaseInternalLink[], removed: Set<string>) => links.filter((link) => !removed.has(link.from_slot_key) && !removed.has(link.to_slot_key));
export const removeEndpoints = (state: BlueprintEditorState, keys: ReadonlySet<string>): BlueprintEditorState => {
  const slots = state.slots.filter((slot) => !keys.has(slot.key));
  const bays = state.bays?.filter(bay => !isPlacedBay(bay) || !keys.has(bay.bay_key));
  const nextLocalNumberByPanel = { ...state.nextLocalNumberByPanel };
  for (const panel of state.panels) if (!slots.some(slot => slot.panel_key === panel.panel_key)
    && !bays?.some(bay => isPlacedBay(bay) && bay.panel_key === panel.panel_key)) nextLocalNumberByPanel[panel.panel_key] = 1;
  return {
    ...state, slots, bays, nextLocalNumberByPanel,
    individualLinks: cleanupLinks(state.individualLinks, new Set(keys)),
  };
};
export type PanelDirection = 'above' | 'right' | 'below' | 'left';
export type PanelHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export type PanelRectangle = Pick<PresentationPanel, 'x' | 'y' | 'width' | 'height'>;
export interface PanelGeometryResult { rectangle: PanelRectangle; guides: { x?: number; y?: number } }
export const nearestSnap = (edges: number[], targets: number[], threshold: number) => {
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
/** Resize trims in composition coordinates; move keeps panel-relative geometry. */
export const setPanelRectangle = (state: BlueprintEditorState, key: string, rectangle: PanelRectangle, mode: 'move' | 'resize' = 'resize', portPadding = 1): BlueprintEditorState => {
  const panel = state.panels.find(item => item.panel_key === key);
  if (!panel || !Object.values(rectangle).every(Number.isFinite) || rectangle.width <= 0 || rectangle.height <= 0) return state;
  const resized = mode !== 'move';
  const position = (x: number, y: number) => ({ x: (panel.x + x * panel.width - rectangle.x) / rectangle.width, y: (panel.y + y * panel.height - rectangle.y) / rectangle.height });
  const slots = resized ? state.slots.map(slot => slot.panel_key === key ? { ...slot, rendered_position: position(slot.rendered_position.x, slot.rendered_position.y) } : slot) : state.slots;
  const bays = resized ? state.bays?.map(bay => {
    if (bay.panel_key !== key || !isPlacedBay(bay)) return bay;
    const origin = position(bay.x, bay.y);
    if (bay.width == null || bay.height == null) return { ...bay, ...clampPosition(origin) };
    return { ...bay, ...origin, width: bay.width * panel.width / rectangle.width, height: bay.height * panel.height / rectangle.height };
  }) : state.bays;
  // Markers are presentation geometry. The caller supplies their fit-view radius
  // in composition units. Do not worsen any pre-existing edge clipping.
  const crossesPort = blueprintMarkers(state).some(slot => {
    if (slot.panel_key !== key) return false;
    const x = panel.x + slot.rendered_position.x * panel.width;
    const y = panel.y + slot.rendered_position.y * panel.height;
    return rectangle.x > Math.max(panel.x, x - portPadding) + 1e-10 || rectangle.y > Math.max(panel.y, y - portPadding) + 1e-10 || rectangle.x + rectangle.width < Math.min(panel.x + panel.width, x + portPadding) - 1e-10 || rectangle.y + rectangle.height < Math.min(panel.y + panel.height, y + portPadding) - 1e-10;
  });
  if (resized && (crossesPort || bays?.some(bay => bay.panel_key === key && isPlacedBay(bay)
    && bay.width != null && bay.height != null && (bay.x < -1e-10 || bay.y < -1e-10 || bay.x + bay.width > 1 + 1e-10 || bay.y + bay.height > 1 + 1e-10)))) return state;
  return { ...state, slots, bays, panels: state.panels.map(item => item.panel_key === key ? { ...item, ...rectangle } : item) };
};
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
  if (state.panels.length <= 1 || state.bays?.some(bay => bay.panel_key === state.activePanelKey) || state.slots.some((slot) => slot.panel_key === state.activePanelKey)) return state;
  const panels = state.panels.filter((panel) => panel.panel_key !== state.activePanelKey);
  const nextLocalNumberByPanel = { ...state.nextLocalNumberByPanel };
  delete nextLocalNumberByPanel[state.activePanelKey];
  return { ...state, panels, activePanelKey: [...panels].sort((a, b) => a.panel_number - b.panel_number)[0].panel_key, nextLocalNumberByPanel };
};

type Axis = 'x' | 'y';
type Edge = 'start' | 'center' | 'end';
export const blueprintMarkers = (state: BlueprintEditorState): BlueprintMarker[] => [...state.slots, ...moduleBayMarkers(state.bays ?? [])];
const selectedSlots = (state: BlueprintEditorState, keys: ReadonlySet<string>) => blueprintMarkers(state).filter((slot) => keys.has(slot.key));
// Preflight the whole batch: an impossible transform must not damage the draft.
const reposition = (state: BlueprintEditorState, positions: Map<string, { x: number; y: number }>): BlueprintEditorState => {
  if ([...positions.values()].some(point => [point.x, point.y].some(value => !Number.isFinite(value) || value < -1e-12 || value > 1 + 1e-12))) return state;
  return { ...state, bays: state.bays?.map(bay => {
    const point = positions.get(bay.bay_key);
    return point && isPlacedBay(bay) ? positionModulePort(bay, clampPosition(point)) : bay;
  }), slots: state.slots.map(slot => {
    const point = positions.get(slot.key);
    return point ? { ...slot, rendered_position: clampPosition(point) } : slot;
  }) };
};
const clampPosition = ({ x, y }: BlueprintSlot['rendered_position']) => ({
  x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)),
});
const spatialOrder = (a: BlueprintMarker, b: BlueprintMarker) => a.rendered_position.y - b.rendered_position.y || a.rendered_position.x - b.rendered_position.x || a.key.localeCompare(b.key);
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
export const selectionPosition = (state: BlueprintEditorState, keys: ReadonlySet<string>): { x: number; y: number } | undefined => {
  const slots = selectedSlots(state, keys).filter((slot) => slot.panel_key === state.activePanelKey);
  if (!slots.length) return undefined;
  const values = (axis: Axis) => slots.map((slot) => slot.rendered_position[axis]);
  const xs = values('x'); const ys = values('y');
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};
export const positionSelectionAt = (state: BlueprintEditorState, keys: ReadonlySet<string>, axis: Axis, requested: number): BlueprintEditorState => {
  if (!Number.isFinite(requested)) return state;
  const current = selectionPosition(state, keys);
  if (!current) return state;
  const activeKeys = new Set(selectedSlots(state, keys).filter((slot) => slot.panel_key === state.activePanelKey).map((slot) => slot.key));
  const delta = requested - current[axis];
  return translateSelection(state, activeKeys, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0);
};
const constrainTranslation = (slots: BlueprintMarker[], dx: number, dy: number) => ({
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
export const snapSelectionTranslation = (visible: BlueprintMarker[], keys: ReadonlySet<string>, rawDx: number, rawDy: number, thresholdX: number, thresholdY: number): SnapTranslation => {
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
  if (!Number.isFinite(inset) || inset < 0 || inset >= .5) return state;
  if (range.mode === 'percent' && (!Number.isFinite(range.percent) || range.percent < 1 || range.percent > 100)) return state;
  const positions = new Map<string, { x: number; y: number }>();
  for (const panelKey of new Set(selectedSlots(state, keys).map(slot => slot.panel_key))) {
    const slots = selectedSlots(state, keys).filter(slot => slot.panel_key === panelKey)
      .sort((a, b) => a.rendered_position[axis] - b.rendered_position[axis] || a.key.localeCompare(b.key));
    if (slots.length < 3) continue;
    const available = 1 - 2 * inset;
    const span = range.mode === 'full' ? available : Math.min(available, range.percent / 100);
    const values = slots.map(slot => slot.rendered_position[axis]);
    const center = (Math.min(...values) + Math.max(...values)) / 2;
    const start = Math.max(inset, Math.min(center - span / 2, 1 - inset - span));
    slots.forEach((slot, index) => positions.set(slot.key, { ...slot.rendered_position, [axis]: start + span * index / (slots.length - 1) }));
  }
  return positions.size ? reposition(state, positions) : state;
};
interface LayoutMetrics { minGapX: number; minGapY: number; insetX: number; insetY: number }
const defaultLayoutMetrics: LayoutMetrics = { minGapX: 0, minGapY: 0, insetX: 0, insetY: 0 };
export const layoutSelectionRow = (state: BlueprintEditorState, keys: ReadonlySet<string>, metrics: LayoutMetrics = defaultLayoutMetrics): BlueprintEditorState => {
  const slots = selectedSlots(state, keys).sort(spatialOrder);
  if (slots.length < 2) return state;
  if (metrics.minGapX * (slots.length - 1) > 1 - 2 * metrics.insetX || metrics.insetY >= .5) return state;
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
  if (metrics.minGapX * (columns - 1) > 1 - 2 * metrics.insetX || metrics.minGapY > 1 - 2 * metrics.insetY) return state;
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

const panelEndpointLimit = 400;
const hasEndpointCapacity = (state: BlueprintEditorState, panelKey: string, count: number) =>
  blueprintMarkers(state).filter((slot) => slot.panel_key === panelKey).length + count <= panelEndpointLimit;
const nextEndpointNumber = (state: BlueprintEditorState, panel: PresentationPanel) => {
  const maximum = Math.max(0, ...blueprintMarkers(state).filter((slot) => slot.panel_key === panel.panel_key).map((slot) => new RegExp(`^${panel.panel_number}-(\\d+)$`).exec(slot.display_name)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1])));
  return Math.max(state.nextLocalNumberByPanel[panel.panel_key] ?? 1, maximum + 1);
};

export type CopyContinuityError = 'multichannelContinuity' | 'occupiedContinuity';
export function copyContinuityError(state: BlueprintEditorState, keys: ReadonlySet<string>): CopyContinuityError | undefined {
  const slots = state.slots.filter(slot => keys.has(slot.key));
  if (slots.some(slot => (slot.cardinality ?? 1) !== 1)) return 'multichannelContinuity';
  const occupancy = blueprintInternalOccupancy(state);
  if (slots.some(slot => occupancy.has(memberAddressKey({ endpointKey: slot.key, memberIndex: 1 })))) return 'occupiedContinuity';
}

export type CopySelectionError = 'invalidSelection' | 'invalidDestination' | 'capacity' | 'placedBoardBay' | CopyContinuityError;
export const copySelectionError = (state: BlueprintEditorState, keys: ReadonlySet<string>, destinationPanelKey: string): CopySelectionError | undefined => {
  if (destinationPanelKey === state.activePanelKey || !state.panels.some((panel) => panel.panel_key === destinationPanelKey)) return 'invalidDestination';
  const sources = selectedSlots(state, keys).filter(slot => slot.panel_key === state.activePanelKey);
  if (sources.some(source => source.kind === 'MODULE_BAY')) return 'placedBoardBay';
  if (!sources.length || sources.length !== keys.size) return 'invalidSelection';
  if (!hasEndpointCapacity(state, destinationPanelKey, sources.length)) return 'capacity';
};
export interface CopySelectionResult { state: BlueprintEditorState; copiedKeys: string[]; error?: CopySelectionError }
/** Correspondence exists only in this operation; the result contains ordinary slots and links. */
export const copySelectionToPanel = (state: BlueprintEditorState, keys: ReadonlySet<string>, destinationPanelKey: string, createContinuity: boolean): CopySelectionResult => {
  const error = copySelectionError(state, keys, destinationPanelKey) ?? (createContinuity ? copyContinuityError(state, keys) : undefined);
  if (error) return { state, copiedKeys: [], error };
  const panel = state.panels.find((item) => item.panel_key === destinationPanelKey)!;
  const next = nextEndpointNumber(state, panel);
  const sources = selectedSlots(state, keys);
  const slots: BlueprintSlot[] = [], bays: NonNullable<BlueprintEditorState['bays']> = [], links: BaseInternalLink[] = [];
  const copiedKeys = sources.map((source, index) => {
    const key = crypto.randomUUID();
    const display_name = `${panel.panel_number}-${next + index}`;
    if (isModulePlaceMarker(source)) {
      const original = state.bays!.find(bay => bay.bay_key === source.key)!;
      bays.push({ kind: 'PLACED', bay_key: key, display_name, panel_key: destinationPanelKey,
        ...(original.hardware_interface_key && { hardware_interface_key: crypto.randomUUID() }),
        ...moduleMount(original.mount_kind, mountTypeId(original)), ...source.rendered_position });
    } else {
      slots.push({ ...source, key, display_name, panel_key: destinationPanelKey, rendered_position: { ...source.rendered_position } });
      if (createContinuity) links.push({ from_slot_key: source.key, to_slot_key: key, member_mappings: [{ ...singleMemberMapping }] });
    }
    return key;
  });
  return {
    copiedKeys,
    state: {
      ...state, activePanelKey: destinationPanelKey, slots: [...state.slots, ...slots],
      ...(bays.length && { bays: [...state.bays ?? [], ...bays] }),
      nextLocalNumberByPanel: { ...state.nextLocalNumberByPanel, [destinationPanelKey]: next + copiedKeys.length },
      individualLinks: links.length ? [...state.individualLinks, ...links] : state.individualLinks,
    },
  };
};

/** UUIDs are opaque and independent of names, position, panel, and selection. */
function newPanelMarkers(state: BlueprintEditorState, count: number, panelKey: string) {
  if (panelKey !== state.activePanelKey || !Number.isInteger(count) || count < 1 || count > 256 || !hasEndpointCapacity(state, panelKey, count)) return;
  const panel = state.panels.find((item) => item.panel_key === panelKey);
  if (!panel) return;
  const existing = blueprintMarkers(state).filter(slot => slot.panel_key === panelKey);
  const occupied = new Set(existing.map(({ rendered_position: {x, y} }) => `${x.toFixed(10)}:${y.toFixed(10)}`));
  const next = nextEndpointNumber(state, panel);
  const markers = [];
  for (let index = 0; markers.length < count && index < panelEndpointLimit; index++) {
    const ordinal = (existing.length + index) % panelEndpointLimit;
    const x = (ordinal % 20 + .5) / 20, y = (Math.floor(ordinal / 20) + .5) / 20;
    if (occupied.has(`${x.toFixed(10)}:${y.toFixed(10)}`)) continue;
    markers.push({ key: crypto.randomUUID(), display_name: `${panel.panel_number}-${next + markers.length}`,
      panel_key: panelKey, rendered_position: { x, y } });
  }
  if (markers.length !== count) return;
  return { markers, nextLocalNumberByPanel: { ...state.nextLocalNumberByPanel, [panelKey]: next + count } };
}

export const addEndpoints = (state: BlueprintEditorState, kind: BlueprintSlotKind, count: number, panelKey: string, portTypeId: string, cardinality = 1): BlueprintEditorState => {
  const batch = newPanelMarkers(state, count, panelKey);
  if (!batch) return state;
  const slots = batch.markers.map(marker => ({ ...marker, kind, port_type_id: portTypeId, ...(cardinality > 1 && { cardinality }) }));
  return { ...state, nextLocalNumberByPanel: batch.nextLocalNumberByPanel, slots: [...state.slots, ...slots] };
};

export const addModulePlaces = (state: BlueprintEditorState, panelKey: string, count: number, mount: ModuleMount): BlueprintEditorState => {
  if (mount.mount_kind !== 'MODULE_PORT') return state;
  const batch = newPanelMarkers(state, count, panelKey);
  if (!batch) return state;
  const bays = batch.markers.map(({ key, rendered_position, ...marker }) => ({
    ...marker, ...rendered_position, kind: 'PLACED' as const, bay_key: key, ...mount,
    hardware_interface_key: crypto.randomUUID(),
  }));
  return { ...state, nextLocalNumberByPanel: batch.nextLocalNumberByPanel, bays: [...state.bays ?? [], ...bays] };
};
export const hydrateBlueprintEditorState = (version: BaseTemplateRevisionDocument): BlueprintEditorState => ({
  bays: version.bays?.map(bay => ({ ...bay })),
  name: version.name, defaultClass: version.default_physical_object_class ?? '', width: version.body.width,
  height: version.body.height, fillColor: version.body.fill_color ?? '',
  panels: version.panels.map((panel) => ({ ...panel })),
  slots: version.slots.map((slot) => ({ ...slot, rendered_position: { ...slot.rendered_position } })),
  individualLinks: version.internal_links.map(link => ({
    ...link, ...(link.member_mappings && { member_mappings: link.member_mappings.map(mapping => ({ ...mapping })) }),
  })),
  activePanelKey: [...version.panels].sort((a, b) => a.panel_number - b.panel_number)[0].panel_key,
  nextPanelNumber: version.next_panel_number,
  nextLocalNumberByPanel: Object.fromEntries(version.panels.map((panel) => [panel.panel_key, Math.max(1, ...version.slots.filter((slot) => slot.panel_key === panel.panel_key).map((slot) => new RegExp(`^${panel.panel_number}-(\\d+)$`).exec(slot.display_name)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1]) + 1))])),
});
export const createBlueprintRequest = (state: BlueprintEditorState): { request?: CreateBaseTemplateRequest; errors: BlueprintValidationError[] } => {
  const errors: BlueprintValidationError[] = [];
  if (!state.name.trim()) errors.push('nameRequired');
  if (state.panels.some((panel) => !panel.display_name.trim())) errors.push('panelNameRequired');
  const bounds = compositionBounds(state.panels);
  if (!state.panels.length || state.panels.some((panel) => !Number.isFinite(panel.width) || panel.width <= 0 || !Number.isFinite(panel.height) || panel.height <= 0) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) errors.push('dimensionsPositive');
  if (state.fillColor && !/^#[0-9A-Fa-f]{6}$/.test(state.fillColor)) errors.push('colorFormat');
  const keys = new Set(state.slots.map((slot) => slot.key));
  if (keys.size !== state.slots.length) errors.push('duplicateSlotKeys');
  const wiringError = blueprintWiringError(state);
  if (wiringError) errors.push(wiringError);
  if (errors.length) return { errors };
  return { errors, request: {
    name: state.name, ...(state.defaultClass.trim() ? { default_physical_object_class: state.defaultClass.trim() } : {}),
    body: { kind: 'RECTANGLE', width: bounds.width, height: bounds.height, fill_color: state.fillColor || null },
    panels: state.panels.map((panel) => ({ ...panel })),
    slots: state.slots.map((slot) => ({ ...slot, rendered_position: { ...slot.rendered_position } })),
    internal_links: state.individualLinks, bays: state.bays ?? [],
  } };
};

// These operations consume transient ordered keys; they never add an authoring recipe to state.
export const toggleOrderedKey = (keys: readonly string[], key: string): string[] =>
  keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key];
export const reorderOrderedKeys = (keys: readonly string[], index: number, direction: -1 | 1): string[] => {
  const next = [...keys]; const destination = index + direction;
  if (index < 0 || index >= next.length || destination < 0 || destination >= next.length) return next;
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
};
// Row membership uses a fixed panel-local tolerance, anchored to the first Y in each row.
// Sorting is total (Y, X, stable key); no coordinates or persisted records change.
export const spatialOrderedKeys = (state: BlueprintEditorState, keys: readonly string[], horizontal: 'ltr' | 'rtl', vertical: 'ttb' | 'btt'): string[] => {
  const slots = blueprintMarkers(state).filter(slot => keys.includes(slot.key) && slot.panel_key === state.activePanelKey)
    .sort((a, b) => a.rendered_position.y - b.rendered_position.y || a.rendered_position.x - b.rendered_position.x || (a.key < b.key ? -1 : 1));
  const rows: typeof slots[] = [];
  for (const slot of slots) {
    const row = rows.at(-1);
    if (!row || slot.rendered_position.y - row[0].rendered_position.y > .01) rows.push([slot]);
    else row.push(slot);
  }
  if (vertical === 'btt') rows.reverse();
  return rows.flatMap(row => row.sort((a, b) => (horizontal === 'ltr' ? 1 : -1) * (a.rendered_position.x - b.rendered_position.x) || a.rendered_position.y - b.rendered_position.y || (a.key < b.key ? -1 : 1)).map(slot => slot.key));
};
export interface BulkNameParameters { mask: string; start: string; step: string }
export const bulkNamePreview = (state: BlueprintEditorState, keys: readonly string[], parameters: BulkNameParameters) => {
  const { mask, start, step } = parameters;
  const first = Number(start); const increment = Number(step);
  if ((mask.match(/#+/g) ?? []).length !== 1 || !start.trim() || !step.trim() || !Number.isSafeInteger(first) || !Number.isSafeInteger(increment) || increment <= 0 || new Set(keys).size !== keys.length) return undefined;
  const slots = new Map(blueprintMarkers(state).map((slot) => [slot.key, slot]));
  if (keys.some((key) => slots.get(key)?.panel_key !== state.activePanelKey || !slots.has(key))) return undefined;
  if (keys.some((_, index) => !Number.isSafeInteger(first + index * increment))) return undefined;
  return keys.map((key, index) => ({ key, currentName: slots.get(key)!.display_name, display_name: mask.replace(/#+/, (token) => { const number = first + index * increment; return (number < 0 ? '-' : '') + String(Math.abs(number)).padStart(token.length, '0'); }) }));
};
export const applyBulkNames = (state: BlueprintEditorState, keys: readonly string[], parameters: BulkNameParameters): BlueprintEditorState => {
  const preview = bulkNamePreview(state, keys, parameters);
  if (!preview?.length) return state;
  const names = new Map(preview.map((item) => [item.key, item.display_name]));
  return {
    ...state,
    slots: state.slots.map(slot => names.has(slot.key) ? { ...slot, display_name: names.get(slot.key)! } : slot),
    ...(state.bays && { bays: state.bays.map(bay => isPlacedBay(bay) && names.has(bay.bay_key)
      ? { ...bay, display_name: names.get(bay.bay_key)! } : bay) }),
  };
};
