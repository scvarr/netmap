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

export type GridSortScope = { kind: 'row' | 'column'; index: number } | { kind: 'all'; traversal: 'rows' | 'columns' };
/** Pure address permutation: whole-table sorts retain the exact empty-cell mask. */
export function sortLocationTable(table: LocationTable, names: ReadonlyMap<string, string>, scope: GridSortScope, descending = false): (string | null)[][] {
  const next = table.map(row => [...row]);
  const addresses: [number, number][] = [];
  if (scope.kind === 'column' || (scope.kind === 'all' && scope.traversal === 'columns')) {
    for (let c = 0; c < Math.max(0, ...table.map(row => row.length)); c++)
      for (let r = 0; r < table.length; r++) if (c < table[r].length && (scope.kind === 'all' || c === scope.index)) addresses.push([r,c]);
  } else {
    table.forEach((row,r) => row.forEach((_,c) => { if (scope.kind === 'all' || r === scope.index) addresses.push([r,c]); }));
  }
  const collator = new Intl.Collator('ru', {numeric:true});
  const ids = addresses.map(([r,c]) => table[r][c]).filter((id): id is string => id !== null);
  ids.sort((a,b) => (descending ? -1 : 1) * (collator.compare(names.get(a) ?? '', names.get(b) ?? '') || (a < b ? -1 : a > b ? 1 : 0)));
  const targets = scope.kind === 'all' ? addresses.filter(([r,c]) => table[r][c] !== null) : addresses;
  targets.forEach(([r,c], i) => { next[r][c] = ids[i] ?? null; });
  return next;
}
