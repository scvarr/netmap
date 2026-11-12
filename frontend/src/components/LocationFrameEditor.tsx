import { useState, type PointerEvent, type ReactNode } from 'react';
import type { LocationFrame } from '../topology/locationFrames';
import type { MapLocationGeometry, MapLocationState } from '../topology/savedMapTypes';
import { projectBoundaryWaypoint, resolveBoundaryWaypoint } from '../topology/locationBoundaryAnchors';
import { useI18n } from '../i18n';

export function LocationFrameEditor({ frame, state, screenToFlowPosition, onSave, actions }: {
  frame: LocationFrame; state?: MapLocationState;
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
  onSave?: (id: string, geometry: MapLocationGeometry) => Promise<void>; actions: ReactNode;
}) {
  const { t } = useI18n();
  const initial = state?.geometry ?? { ...frame.bounds, edge: 'right' as const, offset: .5 };
  const [draft, setDraft] = useState<MapLocationGeometry | null>(null);
  const [selected, select] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<{ mode: 'move' | 'resize' | 'point'; x: number; y: number; geometry: MapLocationGeometry } | null>(null);
  const geometry = draft ?? initial;
  const point = resolveBoundaryWaypoint({ x: 0, y: 0, anchor: { location_id: frame.locationId, edge: geometry.edge, offset: geometry.offset } }, [{ locationId: frame.locationId, bounds: geometry }]);
  const start = (event: PointerEvent<HTMLElement>, mode: 'move' | 'resize' | 'point') => {
    if (busy) return;
    event.stopPropagation(); event.preventDefault(); select(true);
    const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setDrag({ mode, ...p, geometry }); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const dx = p.x - drag.x, dy = p.y - drag.y;
    const g = drag.geometry;
    if (drag.mode === 'point') {
      const anchor = projectBoundaryWaypoint(frame.locationId, g, p).anchor!;
      setDraft({ ...g, edge: anchor.edge, offset: anchor.offset });
    } else setDraft(drag.mode === 'move' ? { ...g, x: g.x + dx, y: g.y + dy } : { ...g, width: Math.max(80, g.width + dx), height: Math.max(60, g.height + dy) });
  };
  const handlers = { onPointerMove: move, onPointerUp: () => setDrag(null), onPointerCancel: () => { setDrag(null); setDraft(null); } };
  return <div className={'location-frame' + (selected ? ' location-frame--selected' : '')} data-location-id={frame.locationId} style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }}>
    <span className="location-frame__heading nodrag nopan" onPointerDown={e => start(e, 'move')} {...handlers}>
      <span className="location-frame__label">{frame.label}</span>
      <span onPointerDown={e => e.stopPropagation()}>{actions}</span>
    </span>
    <button type="button" className="location-boundary-point nodrag nopan" aria-label={t('map.boundaryPoint')} data-boundary-point-id={state?.boundary_point_id} style={{ left: point.x - geometry.x, top: point.y - geometry.y }} onPointerDown={e => start(e, 'point')} {...handlers} />
    {selected && <>
      <button type="button" className="location-frame__resize nodrag nopan" aria-label={t('map.resizeLocation')} onPointerDown={e => start(e, 'resize')} {...handlers}>↘</button>
      <span className="location-frame__save nodrag nopan">
        <button type="button" disabled={busy || !draft || !onSave} onClick={async () => { setBusy(true); setError(''); try { await onSave?.(frame.locationId, geometry); setDraft(null); select(false); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>{t('map.saveLocation')}</button>
        <button type="button" disabled={busy} onClick={() => { setDraft(null); select(false); }}>{t('map.cancelLocation')}</button>
        {error && <span role="alert">{error}</span>}
      </span>
    </>}
  </div>;
}
