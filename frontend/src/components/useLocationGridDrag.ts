import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { LocationDocument } from '../topology/locationTypes';
import type { AutomaticLocationLayout, UniformLocationGrid } from '../topology/savedMapTypes';
import type { LocationFrame } from '../topology/locationFrames';
import { gridTables } from '../topology/uniformGridPresentation';
import { gridDropDirection, insertLocation } from '../topology/locationGridInsertion';

type Point = { x: number; y: number };
interface Input { automatic?: AutomaticLocationLayout | null; variantId?: string; locations: readonly LocationDocument[]; onAutomaticLayout?: (settings: UniformLocationGrid) => Promise<void> }
export function useLocationGridDrag(input: Input | undefined, screenToFlow: (point: Point) => Point, scene?: string) {
  const frames = useRef<readonly LocationFrame[]>([]);
  const [preview, setPreview] = useState<UniformLocationGrid | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const session = useRef<{ id: string; pointer: number; parent: string; settings: UniformLocationGrid; frames: readonly LocationFrame[]; save: NonNullable<Input['onAutomaticLayout']>; next: UniformLocationGrid | null; target: string } | null>(null);
  const saving = useRef(false);
  const cancel = () => { session.current = null; setPreview(null); setMoving(null); };
  useEffect(() => { cancel(); setError(false); }, [input?.variantId, input?.automatic, scene]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const s = session.current;
      if (!s || event.pointerId !== s.pointer) return;
      event.preventDefault();
      const point = screenToFlow({ x: event.clientX, y: event.clientY });
      const target = s.frames.find(f => f.locationId !== s.id && (f.parentLocationId ?? 'root') === s.parent && gridDropDirection(f.bounds, point));
      const direction = target && gridDropDirection(target.bounds, point);
      const key = target && direction ? target.locationId + ':' + direction : '';
      if (s.target === key) return;
      s.target = key;
      s.next = target && direction ? { ...s.settings, tables: { ...s.settings.tables, [s.parent]: insertLocation(s.settings.tables[s.parent], s.id, target.locationId, direction) } } : null;
      setPreview(s.next);
    };
    const up = (event: PointerEvent) => {
      if (!session.current || event.pointerId !== session.current.pointer) return;
      move(event);
      const s = session.current!;
      session.current = null;
      if (!s.next) { cancel(); return; }
      saving.current = true; setBusy(true);
      void s.save(s.next).catch(() => setError(true)).finally(() => { saving.current = false; setBusy(false); cancel(); });
    };
    const abort = () => { if (session.current) cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') abort(); };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', abort); window.addEventListener('keydown', key); window.addEventListener('blur', abort);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', abort); window.removeEventListener('keydown', key); window.removeEventListener('blur', abort); };
  }, [screenToFlow]);
  const start = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    event.stopPropagation(); event.preventDefault();
    if (event.button !== 0 || saving.current || input?.automatic?.mode !== 'uniform_grid' || !input.onAutomaticLayout) return;
    const parent = input.locations.find(l => l.location_ref.entity_id === id)?.parent_location_ref?.entity_id ?? 'root';
    session.current = { id, pointer: event.pointerId, parent, frames: frames.current, settings: { ...input.automatic, tables: gridTables(input.locations, input.automatic.tables) }, save: input.onAutomaticLayout, next: null, target: '' };
    setError(false); setMoving(id);
  };
  return { frames, preview, moving, busy, error, start };
}
