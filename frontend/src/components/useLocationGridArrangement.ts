import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocationDocument } from '../topology/locationTypes';
import type { AutomaticLocationLayout, GridObjectSequence, MapPlacement, UniformLocationGrid } from '../topology/savedMapTypes';
import { directGridObjects, gridObjectSequence, gridTables } from '../topology/uniformGridPresentation';
import { moveGridLocation, normalizeLocationTable, sortLocationTable, type GridSortScope, type GridDirection } from '../topology/locationGridArrangement';
interface Input { automatic?: AutomaticLocationLayout | null; variantId?: string; locations: readonly LocationDocument[]; placements?: readonly MapPlacement[]; onAutomaticLayout?: (settings: UniformLocationGrid) => Promise<void> }
export function useLocationGridArrangement(input: Input | undefined, scene?: string) {
  const key = JSON.stringify([scene, input?.variantId, input?.automatic]);
  const currentKey = useRef(key); currentKey.current = key;
  const [draft, setDraft] = useState<{ key: string; settings: UniformLocationGrid } | null>(null);
  const [selected, select] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState(false);
  const preview = draft?.key === key ? draft.settings : null;
  const automatic = input?.automatic?.mode === 'uniform_grid' ? input.automatic : null;
  const placements = input?.placements;
  const direct = useMemo(() => directGridObjects(placements ?? []), [placements]);
  const hasChanges = preview !== null && input !== undefined && automatic !== null &&
    (JSON.stringify(preview.tables) !== JSON.stringify(gridTables(input.locations, automatic.tables)) ||
      Object.entries(preview.object_sequences ?? {}).some(([parent, entry]) =>
        JSON.stringify(gridObjectSequence(direct.get(parent), entry)) !==
        JSON.stringify(gridObjectSequence(direct.get(parent), automatic.object_sequences?.[parent]))));
  const objectSequence = (parent: string) => gridObjectSequence(direct.get(parent), (preview ?? automatic)?.object_sequences?.[parent]);
  const cancel = () => { setDraft(null); select(null); setError(false); };
  useEffect(() => { cancel(); }, [key]);
  const enter = () => {
    if (pending.current || input?.automatic?.mode !== 'uniform_grid' || !input.onAutomaticLayout) return;
    const tables = gridTables(input.locations, input.automatic.tables);
    setDraft({key, settings: {...input.automatic, tables: Object.fromEntries(Object.entries(tables).map(([id, table]) => [id, normalizeLocationTable(table)]))}});
    select(null); setError(false);
  };
  const operation = (direction: GridDirection) => {
    if (!preview || !selected || pending.current) return null;
    const location = input?.locations.find(l => l.location_ref.entity_id === selected);
    if (!location) return null;
    const parent = location.parent_location_ref?.entity_id ?? 'root';
    const table = moveGridLocation(preview.tables[parent] ?? [], selected, direction);
    return table ? {...preview, tables: {...preview.tables, [parent]:table}} : null;
  };
  const move = (direction: GridDirection) => { const settings = operation(direction); if (settings) setDraft({key, settings}); };
  const sort = (parent: string, scope: GridSortScope, descending: boolean) => {
    if (pending.current || input?.automatic?.mode !== 'uniform_grid' || !input.onAutomaticLayout) return;
    const automatic = input.automatic;
    setDraft(current => {
      const base = current?.key === key ? current.settings : {...automatic, tables: gridTables(input.locations, automatic.tables)};
      const names = new Map(input.locations.map(l => [l.location_ref.entity_id, l.name]));
      return {key, settings: {...base, tables: {...base.tables, [parent]: sortLocationTable(base.tables[parent] ?? [], names, scope, descending)}}};
    });
    setError(false);
  };
  const editObjects = (parent: string, update: (sequence: GridObjectSequence) => GridObjectSequence) => {
    if (pending.current || !automatic || !input?.onAutomaticLayout) return;
    setDraft(current => {
      const base = current?.key === key ? current.settings : {...automatic, tables: gridTables(input.locations, automatic.tables)};
      const sequence = gridObjectSequence(direct.get(parent), base.object_sequences?.[parent]);
      return { key, settings: {...base, object_sequences: {...base.object_sequences, [parent]: update(sequence)}} };
    });
    setError(false);
  };
  const finish = async () => {
    if (pending.current || !preview || !input?.onAutomaticLayout) return false;
    pending.current = true; setBusy(true); setError(false);
    try {
      await input.onAutomaticLayout(preview);
      if (currentKey.current === key) cancel();
      return true;
    } catch {
      if (currentKey.current === key) { setDraft(null); select(null); setError(true); }
      return false;
    }
    finally { pending.current = false; setBusy(false); }
  };
  return {preview, hasChanges, selected: preview ? selected : null, select, busy, error, enter, cancel, move, sort, objectSequence, editObjects, finish, canMove:(direction: GridDirection) => Boolean(operation(direction))};
}

export type LocationGridArrangement = ReturnType<typeof useLocationGridArrangement>;
