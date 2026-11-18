import type { FlowRectangle } from './nodeFootprint';
import type { GridObjectSequence } from './savedMapTypes';

export interface GridSize { readonly width: number; readonly height: number }

/** Ephemeral measurement input, not a persistence format. Children must be
 * canonical direct children, each occurring exactly once in the table.
 * directObjects includes canonical members even when their display is collapsed.
 * Sizes are complete rendered footprints; no coordinates or zoom are inputs.
 */
export interface LocationGridNode {
  readonly id: string;
  readonly minimum: GridSize;
  readonly directObjects: readonly GridSize[];
  readonly objectDirection?: GridObjectSequence['direction'];
  readonly children: readonly (readonly (LocationGridNode | null)[])[];
  readonly collapsed?: boolean;
  readonly visibleChildren?: readonly string[];
  readonly visibleObjects?: readonly number[];
}

export interface LocationGridResult {
  readonly id: string;
  readonly populated: boolean;
  /** Local to the parent frame. The root starts at zero. */
  readonly bounds: FlowRectangle;
  /** Local, unchanged equipment footprints; absent for a collapsed node. */
  readonly objects: readonly FlowRectangle[];
  readonly children: readonly LocationGridResult[];
}

const SIDE = 12, TOP = 24, COLUMN_GAP = 20, ROW_GAP = 12;

/** Bottom-up measurement and table-wide equalization. Runtime inputs are supplied by uniformGridPresentation.
 * Hide-empty removes wholly invisible tracks, retaining holes in active tracks.
 * Collapse measures the minimum frame before its parent's uniform sizing.
 */
export function layoutLocationGrid(root: LocationGridNode, hideEmpty = false): LocationGridResult {
  const ids = new Set<string>();
  const measure = (node: LocationGridNode): LocationGridResult => {
    if (ids.has(node.id)) throw new Error(`Repeated Location: ${node.id}`);
    ids.add(node.id);
    for (const size of [node.minimum, ...node.directObjects]) {
      if (![size.width, size.height].every(n => Number.isFinite(n) && n >= 0)) {
        throw new Error(`Invalid footprint: ${node.id}`);
      }
    }
    const cells = node.children.flatMap((row, r) => row.flatMap((child, c) =>
      child ? [{ r, c, result: measure(child) }] : []));
    const populated = node.directObjects.length > 0 || cells.some(cell => cell.result.populated);
    const shown = node.collapsed ? [] : cells.filter(cell => (!hideEmpty || cell.result.populated) && (!node.visibleChildren || node.visibleChildren.includes(cell.result.id)));
    const filled = shown.filter(cell => cell.result.populated);
    const width = Math.max(0, ...filled.map(cell => cell.result.bounds.width));
    const height = Math.max(0, ...filled.map(cell => cell.result.bounds.height));
    // An empty frame can require space for empty descendants, but never sets
    // the uniform size of populated cells. Track extents still prevent overlaps.
    for (const cell of filled) {
      cell.result.bounds.width = width;
      cell.result.bounds.height = height;
    }
    const columnWidths = new Map<number, number>(), rowHeights = new Map<number, number>();
    if (!hideEmpty && !node.collapsed) {
      // Explicit blank rows/columns retain compact slots, not populated maxima.
      node.children.forEach((row, r) => {
        rowHeights.set(r, 32);
        row.forEach((_, c) => columnWidths.set(c, 100));
      });
    }
    for (const { r, c, result } of shown) {
      columnWidths.set(c, Math.max(columnWidths.get(c) ?? 0, result.bounds.width));
      rowHeights.set(r, Math.max(rowHeights.get(r) ?? 0, result.bounds.height));
    }
    const offsets = (tracks: Map<number, number>, gap: number) => {
      const result = new Map<number, number>();
      let cursor = 0;
      for (const key of [...tracks.keys()].sort((a, b) => a - b)) {
        result.set(key, cursor); cursor += tracks.get(key)! + gap;
      }
      return { result, extent: tracks.size ? cursor - gap : 0 };
    };
    const columns = offsets(columnWidths, COLUMN_GAP), rows = offsets(rowHeights, ROW_GAP);
    let bottom = SIDE;
    let right = SIDE;
    const horizontal = node.objectDirection === 'HORIZONTAL';
    const objects = node.collapsed ? [] : node.directObjects.filter((_, i) => !node.visibleObjects || node.visibleObjects.includes(i)).map(size => {
      const box = { x: horizontal ? right : SIDE, y: horizontal ? SIDE : bottom, width: size.width, height: size.height };
      right = Math.max(right, box.x + box.width + (horizontal ? COLUMN_GAP : SIDE));
      bottom = Math.max(bottom, box.y + box.height + ROW_GAP);
      return box;
    });
    const hasTable = rowHeights.size > 0;
    const tableTop = hasTable ? Math.max(TOP, bottom) : 0;
    for (const { r, c, result } of shown) {
      result.bounds.x = SIDE + columns.result.get(c)!;
      result.bounds.y = tableTop + rows.result.get(r)!;
    }
    return {
      id: node.id, populated,
      bounds: { x: 0, y: 0,
        width: Math.max(node.minimum.width, columns.extent + (hasTable ? 2 * SIDE : 0),
          objects.length ? right + (horizontal ? SIDE - COLUMN_GAP : 0) : 0),
        height: Math.max(node.minimum.height, objects.length ? bottom : 0, hasTable ? tableTop + rows.extent + SIDE : 0) },
      objects, children: shown.map(cell => cell.result),
    };
  };
  return measure(root);
}
