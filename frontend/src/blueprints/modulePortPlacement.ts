import type { ModulePortDefinition } from '../topology/hardwareModules';
import type { BayRectangle } from './moduleBayGeometry';

const gridSize = 100;
type Position = Pick<BayRectangle, 'x' | 'y'>;

export function placeModulePorts(count: number, compatibility: string, name: string, usedNames: string[],
  occupied: BayRectangle[], endpoints: Position[]): ModulePortDefinition[] | undefined {
  // Use the same hundredth-unit grid as the rectangle editors. Round existing
  // footprints outward so that even imported, off-grid rectangles stay clear.
  const blocked = new Uint8Array(gridSize * gridSize);
  for (const rectangle of occupied) {
    const left = Math.floor(rectangle.x * gridSize);
    const right = Math.min(gridSize, Math.ceil((rectangle.x + rectangle.width) * gridSize));
    const bottom = Math.min(gridSize, Math.ceil((rectangle.y + rectangle.height) * gridSize));
    for (let y = Math.floor(rectangle.y * gridSize); y < bottom; y++) {
      blocked.fill(1, y * gridSize + left, y * gridSize + right);
    }
  }
  for (const point of endpoints) {
    const x = Math.min(gridSize - 1, Math.floor(point.x * gridSize));
    const y = Math.min(gridSize - 1, Math.floor(point.y * gridSize));
    blocked[y * gridSize + x] = 1;
  }
  const firstSize = Math.min(30, Math.floor(90 / Math.ceil(Math.sqrt(count))) - 2);
  for (let size = firstSize; size >= 1; size--) {
    const pitch = size === 1 ? 1 : size + 2;
    const inset = Math.floor(((gridSize - size) % pitch) / 2);
    const free: Position[] = [];
    for (let y = inset; y + size <= gridSize; y += pitch) {
      for (let x = inset; x + size <= gridSize; x += pitch) {
        let clear = true;
        for (let row = y; clear && row < y + size; row++) {
          const offset = row * gridSize + x;
          clear = !blocked.subarray(offset, offset + size).includes(1);
        }
        if (clear) free.push({ x, y });
      }
    }
    if (free.length < count) continue;
    const center = (gridSize - size) / 2;
    const distance = ({ x, y }: Position) => (x - center) ** 2 + (y - center) ** 2;
    const positions = free.sort((a, b) => distance(a) - distance(b)).slice(0, count)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const prefix = `${name} `;
    let nextNumber = 1;
    for (const usedName of usedNames) {
      if (!usedName.startsWith(prefix)) continue;
      const number = Number(usedName.slice(prefix.length));
      if (Number.isSafeInteger(number) && number < Number.MAX_SAFE_INTEGER - count) {
        nextNumber = Math.max(nextNumber, number + 1);
      }
    }
    return positions.map(({ x, y }, index) => ({
      key: crypto.randomUUID(), display_name: `${prefix}${nextNumber + index}`, compatibility,
      x: x / gridSize, y: y / gridSize, width: size / gridSize, height: size / gridSize,
    }));
  }
  return undefined;
}
