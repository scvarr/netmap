import type { ModuleBay } from '../topology/hardwareModules';
import { nearestSnap, type PanelHandle } from './editorModel';

export type BayRectangle = Pick<ModuleBay, 'x' | 'y' | 'width' | 'height'>;
export const minimumBaySize = .01;
const bounded = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const units = (value: number) => Math.round((value + Number.EPSILON) * 100);

export function normalizeBayGeometry(bay: BayRectangle): BayRectangle {
  const x = bounded(units(bay.x), 0, 99), y = bounded(units(bay.y), 0, 99);
  return { x: x / 100, y: y / 100, width: bounded(units(bay.width), 1, 100 - x) / 100, height: bounded(units(bay.height), 1, 100 - y) / 100 };
}

export function duplicateModuleBay(bay: ModuleBay): ModuleBay {
  const geometry = normalizeBayGeometry(bay);
  const shift = (position: number, size: number) => {
    const offset = .025;
    if (position + offset <= 1 - size) return position + offset;
    if (position - offset >= 0) return position - offset;
    return position;
  };
  return { ...bay, bay_key: crypto.randomUUID(), ...normalizeBayGeometry({ ...geometry, x: shift(geometry.x, geometry.width), y: shift(geometry.y, geometry.height) }) };
}

export function bayGestureGeometry(bay: BayRectangle, handle: 'move' | PanelHandle, dx: number, dy: number, others: BayRectangle[], threshold: { x: number; y: number }): { rectangle: BayRectangle; guides: { x?: number; y?: number } } {
  const horizontal = [0, 1, ...others.flatMap(item => [units(item.x) / 100, units(item.x + item.width) / 100])];
  const vertical = [0, 1, ...others.flatMap(item => [units(item.y) / 100, units(item.y + item.height) / 100])];
  const translate = (position: number, size: number, targets: number[], distance: number) => {
    const start = nearestSnap([position], targets.filter(target => target >= 0 && target <= 1 - size), distance);
    const end = nearestSnap([position + size], targets.filter(target => target >= size && target <= 1), distance);
    return !start || (end && Math.abs(end.delta) < Math.abs(start.delta)) ? end : start;
  };
  if (handle === 'move') {
    const x = bounded(bay.x + dx, 0, 1 - bay.width), y = bounded(bay.y + dy, 0, 1 - bay.height);
    const sx = translate(x, bay.width, horizontal, threshold.x), sy = translate(y, bay.height, vertical, threshold.y);
    return { rectangle: normalizeBayGeometry({ ...bay, x: x + (sx?.delta ?? 0), y: y + (sy?.delta ?? 0) }), guides: { x: sx?.guide, y: sy?.guide } };
  }
  let left = bay.x, top = bay.y, right = bay.x + bay.width, bottom = bay.y + bay.height;
  const minWidth = Math.min(minimumBaySize, bay.width), minHeight = Math.min(minimumBaySize, bay.height);
  if (handle.includes('w')) left = bounded(left + dx, 0, right - minWidth);
  if (handle.includes('e')) right = bounded(right + dx, left + minWidth, 1);
  if (handle.includes('n')) top = bounded(top + dy, 0, bottom - minHeight);
  if (handle.includes('s')) bottom = bounded(bottom + dy, top + minHeight, 1);
  const west = handle.includes('w'), east = handle.includes('e'), north = handle.includes('n'), south = handle.includes('s');
  const sx = west || east ? nearestSnap([west ? left : right], horizontal.filter(target => west ? target <= right - minWidth : target >= left + minWidth), threshold.x) : undefined;
  const sy = north || south ? nearestSnap([north ? top : bottom], vertical.filter(target => north ? target <= bottom - minHeight : target >= top + minHeight), threshold.y) : undefined;
  if (sx) { if (west) left = sx.guide; else right = sx.guide; }
  if (sy) { if (north) top = sy.guide; else bottom = sy.guide; }
  return { rectangle: normalizeBayGeometry({ x: left, y: top, width: right - left, height: bottom - top }), guides: { x: sx?.guide, y: sy?.guide } };
}

export function bayNumericGeometry(bay: BayRectangle, axis: keyof BayRectangle, value: number): BayRectangle {
  const next = { x: bay.x, y: bay.y, width: bay.width, height: bay.height };
  if (axis === 'x') next.x = bounded(value, 0, 1 - bay.width);
  if (axis === 'y') next.y = bounded(value, 0, 1 - bay.height);
  if (axis === 'width') next.width = bounded(value, Math.min(minimumBaySize, 1 - bay.x), 1 - bay.x);
  if (axis === 'height') next.height = bounded(value, Math.min(minimumBaySize, 1 - bay.y), 1 - bay.y);
  return normalizeBayGeometry(next);
}
