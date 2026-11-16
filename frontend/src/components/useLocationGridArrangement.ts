import { useEffect, useRef, useState } from 'react';
import type { LocationDocument } from '../topology/locationTypes';
import type { AutomaticLocationLayout, UniformLocationGrid } from '../topology/savedMapTypes';
import { gridTables } from '../topology/uniformGridPresentation';
import { moveGridLocation, normalizeLocationTable, type GridDirection } from '../topology/locationGridArrangement';
interface Input { automatic?: AutomaticLocationLayout | null; variantId?: string; locations: readonly LocationDocument[]; onAutomaticLayout?: (settings: UniformLocationGrid) => Promise<void> }
export function useLocationGridArrangement(input: Input | undefined, scene?: string) {
  const key = JSON.stringify([scene, input?.variantId, input?.automatic]);
  const currentKey = useRef(key); currentKey.current = key;
  const [draft, setDraft] = useState<{ key: string; settings: UniformLocationGrid } | null>(null);
  const [selected, select] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState(false);
  const preview = draft?.key === key ? draft.settings : null;
  const cancel = () => { setDraft(null); select(null); setError(false); };
  useEffect(() => { cancel(); }, [key]);
  const enter = () => {
    if (pending.current || input?.automatic?.mode !== 'uniform_grid' || !input.onAutomaticLayout) return;
    const tables = gridTables(input.locations, input.automatic.tables);
    setDraft({key, settings: {...input.automatic, tables: Object.fromEntries(Object.entries(tables).map(([id, table]) => [id, normalizeLocationTable(table)]))}});
    select(null); setError(false);
  };
  const operation = (direction: GridDirection) => {
    if (!preview || !selected || busy) return null;
    const location = input?.locations.find(l => l.location_ref.entity_id === selected);
    if (!location) return null;
    const parent = location.parent_location_ref?.entity_id ?? 'root';
    const table = moveGridLocation(preview.tables[parent] ?? [], selected, direction);
    return table ? {...preview, tables: {...preview.tables, [parent]:table}} : null;
  };
  const move = (direction: GridDirection) => { const settings = operation(direction); if (settings) setDraft({key, settings}); };
  const finish = async () => {
    if (pending.current || !preview || !input?.onAutomaticLayout) return;
    pending.current = true; setBusy(true); setError(false);
    try { await input.onAutomaticLayout(preview); if (currentKey.current === key) cancel(); }
    catch { if (currentKey.current === key) { setDraft(null); select(null); setError(true); } }
    finally { pending.current = false; setBusy(false); }
  };
  return {preview, selected: preview ? selected : null, select, busy, error, enter, cancel, move, finish, canMove:(direction: GridDirection) => Boolean(operation(direction))};
}

export type LocationGridArrangement = ReturnType<typeof useLocationGridArrangement>;
