import type { ModuleBay } from '../topology/hardwareModules';
import type { PanelHandle } from './editorModel';

export type BayRectangle = Pick<ModuleBay, 'x' | 'y' | 'width' | 'height'>;
export const minimumBaySize = .01;
const bounded = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function duplicateModuleBay(bay: ModuleBay): ModuleBay {
  const shift = (position: number, size: number) => {
    const offset = .025;
    if (position + offset <= 1 - size) return position + offset;
    if (position - offset >= 0) return position - offset;
    return position;
  };
  return { ...bay, bay_key: crypto.randomUUID(), x: shift(bay.x, bay.width), y: shift(bay.y, bay.height) };
}

export function bayGestureGeometry(bay: BayRectangle, handle: 'move' | PanelHandle, dx: number, dy: number): BayRectangle {
  if (handle === 'move') return { ...bay, x: bounded(bay.x + dx, 0, 1 - bay.width), y: bounded(bay.y + dy, 0, 1 - bay.height) };
  let left = bay.x, top = bay.y, right = bay.x + bay.width, bottom = bay.y + bay.height;
  const minWidth = Math.min(minimumBaySize, bay.width), minHeight = Math.min(minimumBaySize, bay.height);
  if (handle.includes('w')) left = bounded(left + dx, 0, right - minWidth);
  if (handle.includes('e')) right = bounded(right + dx, left + minWidth, 1);
  if (handle.includes('n')) top = bounded(top + dy, 0, bottom - minHeight);
  if (handle.includes('s')) bottom = bounded(bottom + dy, top + minHeight, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function bayNumericGeometry(bay: BayRectangle, axis: keyof BayRectangle, value: number): BayRectangle {
  const next = { x: bay.x, y: bay.y, width: bay.width, height: bay.height };
  if (axis === 'x') next.x = bounded(value, 0, 1 - bay.width);
  if (axis === 'y') next.y = bounded(value, 0, 1 - bay.height);
  if (axis === 'width') next.width = bounded(value, Math.min(minimumBaySize, 1 - bay.x), 1 - bay.x);
  if (axis === 'height') next.height = bounded(value, Math.min(minimumBaySize, 1 - bay.y), 1 - bay.y);
  return next;
}
