import type { FlowRectangle } from './nodeFootprint';
export type GridDirection = 'ABOVE' | 'BELOW' | 'LEFT' | 'RIGHT';
export function insertLocation(table: readonly (readonly (string | null)[])[], moving: string, anchor: string, direction: GridDirection): (string | null)[][] {
  const cells = table.flat().filter(Boolean);
  if (moving === anchor || !cells.includes(moving) || !cells.includes(anchor) || new Set(cells).size !== cells.length) throw new Error('Invalid sibling insertion');
  let width = Math.max(...table.map(row => row.length));
  const rows = table.map(row => Array.from({ length: width }, (_, c) => row[c] === moving ? null : row[c] ?? null));
  // Only the source tracks can have become empty in this operation.
  // Preserve every pre-existing empty track, including ragged-table holes.
  const sourceRow = table.findIndex(row => row.includes(moving));
  const sourceColumn = table[sourceRow].indexOf(moving);
  const removeRow = rows[sourceRow].every(cell => cell === null);
  const removeColumn = rows.every(row => row[sourceColumn] === null);
  if (removeRow) rows.splice(sourceRow, 1);
  if (removeColumn) {
    rows.forEach(row => row.splice(sourceColumn, 1));
    width -= 1;
  }
  // Normalization can shift the anchor on either axis.
  const r = rows.findIndex(row => row.includes(anchor)), c = rows[r].indexOf(anchor);
  const vertical = direction === 'ABOVE' || direction === 'BELOW';
  const after = direction === 'BELOW' || direction === 'RIGHT';
  const nr = r + (vertical ? (after ? 1 : -1) : 0), nc = c + (!vertical ? (after ? 1 : -1) : 0);
  if (nr >= 0 && nr < rows.length && nc >= 0 && nc < width && rows[nr][nc] === null) rows[nr][nc] = moving;
  else if (vertical) { const row = Array<string | null>(width).fill(null); row[c] = moving; rows.splice(r + Number(after), 0, row); }
  else rows.forEach((row, i) => row.splice(c + Number(after), 0, i === r ? moving : null));
  return rows;
}
/** Outer quarter bands; the central half is deliberately not a drop target. Ties prefer vertical. */
export function gridDropDirection(box: FlowRectangle, point: { x: number; y: number }): GridDirection | null {
  const x = (point.x - box.x) / box.width, y = (point.y - box.y) / box.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  const distances = [y, 1-y, x, 1-x];
  const min = Math.min(...distances);
  return min <= .25 ? (['ABOVE', 'BELOW', 'LEFT', 'RIGHT'] as const)[distances.indexOf(min)] : null;
}
