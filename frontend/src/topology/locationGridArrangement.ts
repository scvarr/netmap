export type GridDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
export type LocationTable = readonly (readonly (string | null)[])[];
/** Remove only wholly empty tracks, retaining holes in active tracks and track order. */
export function normalizeLocationTable(table: LocationTable): (string | null)[][] {
  const rows = table.filter(row => row.some(cell => cell !== null));
  const width = Math.max(0, ...rows.map(row => row.length));
  const columns = Array.from({ length: width }, (_, c) => c).filter(c => rows.some(row => row[c] != null));
  return rows.map(row => columns.map(c => row[c] ?? null));
}
/** Address-based one-cell move/swap. Null means impossible or unchanged after normalization. */
export function moveGridLocation(table: LocationTable, id: string, direction: GridDirection): (string | null)[][] | null {
  const source = normalizeLocationTable(table);
  if (source.flat().filter(cell => cell === id).length !== 1) return null;
  const rows = source.map(row => [...row]);
  let r = rows.findIndex(row => row.includes(id)), c = rows[r].indexOf(id);
  if (direction === 'UP' && r === 0) { rows.unshift(Array(rows[0].length).fill(null)); r++; }
  if (direction === 'DOWN' && r === rows.length - 1) rows.push(Array(rows[0].length).fill(null));
  if (direction === 'LEFT' && c === 0) { rows.forEach(row => row.unshift(null)); c++; }
  if (direction === 'RIGHT' && c === rows[0].length - 1) rows.forEach(row => row.push(null));
  const nr = r + (direction === 'UP' ? -1 : direction === 'DOWN' ? 1 : 0);
  const nc = c + (direction === 'LEFT' ? -1 : direction === 'RIGHT' ? 1 : 0);
  [rows[r][c], rows[nr][nc]] = [rows[nr][nc], rows[r][c]];
  const next = normalizeLocationTable(rows);
  return JSON.stringify(next) === JSON.stringify(source) ? null : next;
}
