import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { locationPath } from '../topology/locationPresentation';
import type { LocationDataSource, LocationDocument, PhysicalObjectLocationDocument } from '../topology/locationTypes';

const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
type State = { locations: LocationDocument[]; association: PhysicalObjectLocationDocument };

export function PhysicalObjectLocationSection({ physicalObjectId, dataSource }: { physicalObjectId: string; dataSource?: LocationDataSource }) {
  const { t } = useI18n(); const [state, setState] = useState<State | null>(null); const [error, setError] = useState<string | null>(null); const [revision, setRevision] = useState(0); const [editing, setEditing] = useState(false); const [selected, setSelected] = useState(''); const [saving, setSaving] = useState(false); const [writeError, setWriteError] = useState<string | null>(null); const [refreshAfterWrite, setRefreshAfterWrite] = useState(false);
  const refresh = useCallback(async () => { if (!dataSource) return; setError(null); try { const [association, locations] = await Promise.all([dataSource.loadPhysicalObjectLocation(physicalObjectId), dataSource.loadLocations()]); setState({ association, locations }); setRefreshAfterWrite(false); } catch (reason) { setState(null); setError(message(reason)); throw reason; } }, [dataSource, physicalObjectId]);
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh, revision]);
  const currentId = state?.association.location_ref?.entity_id ?? null;
  const path = useMemo(() => state ? locationPath(state.locations, currentId) : null, [state, currentId]);
  const openEditor = () => { setSelected(currentId ?? ''); setWriteError(null); setEditing(true); };
  const save = async (locationId: string | null) => { if (!dataSource) return; setSaving(true); setWriteError(null); try { await dataSource.setPhysicalObjectLocation(physicalObjectId, locationId); setEditing(false); setState(null); try { await refresh(); } catch { setRefreshAfterWrite(true); } } catch (reason) { setWriteError(message(reason)); } finally { setSaving(false); } };
  if (!dataSource) return null;
  return <section className="detail-section" aria-labelledby="object-location-heading"><h2 id="object-location-heading">{t('object.location')}</h2>
    {refreshAfterWrite && <p role="alert" className="catalog-note catalog-note--gap">{t('object.locationWriteRefreshFailed')} <button type="button" onClick={() => setRevision((value) => value + 1)}>{t('location.retryRefresh')}</button></p>}
    {error ? <p role="alert">{t('object.locationLoadFailed', { error })} <button type="button" onClick={() => setRevision((value) => value + 1)}>{t('action.retry')}</button></p> : !state ? <p>{t('object.locationLoading')}</p> : path ? <p className="object-location-path">{path}</p> : <p>{t('object.locationEmpty')}</p>}
    {state && <div className="object-location-actions"><button type="button" onClick={openEditor}>{t('object.locationChange')}</button>{currentId && <button type="button" onClick={() => void save(null)} disabled={saving}>{saving ? t('location.saving') : t('object.locationClear')}</button>}</div>}
    {editing && <section className="catalog-dialog" role="dialog" aria-modal="true" aria-label={t('object.locationChange')}><div className="catalog-dialog__surface"><h2>{t('object.locationChange')}</h2><label><span>{t('object.locationPicker')}</span><select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">{t('object.locationEmptyOption')}</option>{state?.locations.map((location) => <option key={location.location_ref.entity_id} value={location.location_ref.entity_id}>{locationPath(state.locations, location.location_ref.entity_id)}</option>)}</select></label>{writeError && <p role="alert" className="catalog-dialog__error">{t('object.locationWriteFailed', { error: writeError })}</p>}<div className="catalog-dialog__actions"><button type="button" disabled={saving} onClick={() => setEditing(false)}>{t('action.cancel')}</button><button type="button" disabled={saving} onClick={() => void save(selected || null)}>{saving ? t('location.saving') : t('catalog.save')}</button></div></div></section>}
  </section>;
}
