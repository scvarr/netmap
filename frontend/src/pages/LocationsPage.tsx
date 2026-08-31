import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import type { LocationDataSource, LocationDocument } from '../topology/locationTypes';
import { locationPath } from '../topology/locationPresentation';

type Form = { mode: 'create' | 'edit' | 'reparent'; location?: LocationDocument; name: string; type: string; parentId: string | null; error: string | null };
const failure = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

const descendants = (items: LocationDocument[], id: string) => {
  const children = new Map<string, string[]>();
  items.forEach((item) => { const parent = item.parent_location_ref?.entity_id; if (parent) children.set(parent, [...(children.get(parent) ?? []), item.location_ref.entity_id]); });
  const blocked = new Set([id]); const queue = [id];
  while (queue.length) for (const child of children.get(queue.shift()!) ?? []) if (!blocked.has(child)) { blocked.add(child); queue.push(child); }
  return blocked;
};

function LocationTree({ items, parentId, onEdit, onChild, onMove, onDelete }: { items: LocationDocument[]; parentId: string | null; onEdit: (item: LocationDocument) => void; onChild: (item: LocationDocument) => void; onMove: (item: LocationDocument) => void; onDelete: (item: LocationDocument) => void }) {
  const { t } = useI18n();
  const children = items.filter((item) => (item.parent_location_ref?.entity_id ?? null) === parentId);
  if (!children.length) return null;
  return <ul className="location-tree">{children.map((item) => <li key={item.location_ref.entity_id}>
    <div className="location-tree__item"><span><strong>{item.name}</strong>{item.type && <small>{item.type}</small>}</span><div><button type="button" onClick={() => onChild(item)}>{t('location.createChild')}</button><button type="button" onClick={() => onEdit(item)}>{t('location.edit')}</button><button type="button" onClick={() => onMove(item)}>{t('location.reparent')}</button><button type="button" className="location-tree__danger" onClick={() => onDelete(item)}>{t('location.delete')}</button></div></div>
    <LocationTree items={items} parentId={item.location_ref.entity_id} onEdit={onEdit} onChild={onChild} onMove={onMove} onDelete={onDelete} />
  </li>)}</ul>;
}

export function LocationsPage({ dataSource }: { dataSource: LocationDataSource }) {
  const { t } = useI18n(); const [locations, setLocations] = useState<LocationDocument[] | null>(null); const [loadError, setLoadError] = useState<string | null>(null); const [revision, setRevision] = useState(0); const [form, setForm] = useState<Form | null>(null); const [deleting, setDeleting] = useState<LocationDocument | null>(null); const [deleteError, setDeleteError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [refreshAfterWrite, setRefreshAfterWrite] = useState(false);
  const refresh = useCallback(async () => { setLoadError(null); try { setLocations(await dataSource.loadLocations()); setRefreshAfterWrite(false); } catch (reason) { setLocations(null); setLoadError(failure(reason)); throw reason; } }, [dataSource]);
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh, revision]);
  const sorted = useMemo(() => locations ? [...locations].sort((a, b) => a.name.localeCompare(b.name)) : [], [locations]);
  const openCreate = (parentId: string | null) => setForm({ mode: 'create', name: '', type: '', parentId, error: null });
  const openEdit = (location: LocationDocument) => setForm({ mode: 'edit', location, name: location.name, type: location.type ?? '', parentId: location.parent_location_ref?.entity_id ?? null, error: null });
  const openMove = (location: LocationDocument) => setForm({ mode: 'reparent', location, name: location.name, type: location.type ?? '', parentId: location.parent_location_ref?.entity_id ?? null, error: null });
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!form) return; setBusy(true); const saved = form; try {
    if (saved.mode === 'create') await dataSource.createLocation({ name: saved.name.trim(), type: saved.type.trim() || null, parent_location_id: saved.parentId });
    if (saved.mode === 'edit') await dataSource.updateLocation(saved.location!.location_ref.entity_id, { name: saved.name.trim(), type: saved.type.trim() || null });
    if (saved.mode === 'reparent') await dataSource.reparentLocation(saved.location!.location_ref.entity_id, saved.parentId);
    setForm(null); setLocations(null); try { await refresh(); } catch { setRefreshAfterWrite(true); }
  } catch (reason) { setForm({ ...saved, error: failure(reason) }); } finally { setBusy(false); } };
  const remove = async () => { if (!deleting) return; setBusy(true); try { await dataSource.deleteLocation(deleting.location_ref.entity_id); setDeleting(null); setDeleteError(null); setLocations(null); try { await refresh(); } catch { setRefreshAfterWrite(true); } } catch (reason) { setDeleteError(failure(reason)); } finally { setBusy(false); } };
  const forbiddenParents = form?.location && locations ? descendants(locations, form.location.location_ref.entity_id) : new Set<string>();
  return <main className="catalog-page locations-page"><nav className="breadcrumbs" aria-label={t('location.breadcrumbs')}><Link to="/infrastructure/objects">{t('catalog.infrastructure')}</Link><span>/</span><span>{t('nav.locations')}</span></nav><header className="catalog-page__header"><div><span className="eyebrow">{t('nav.infrastructure')}</span><h1>{t('location.title')}</h1><p>{t('location.description')}</p></div><button className="primary-action" type="button" onClick={() => openCreate(null)}>{t('location.createRoot')}</button></header>
    {refreshAfterWrite && <p role="alert" className="catalog-note catalog-note--gap">{t('location.writeRefreshFailed')} <button type="button" onClick={() => setRevision((value) => value + 1)}>{t('location.retryRefresh')}</button></p>}
    {loadError ? <section className="catalog-note catalog-note--gap" role="alert">{t('location.loadFailed', { error: loadError })} <button type="button" onClick={() => setRevision((value) => value + 1)}>{t('action.retry')}</button></section> : locations === null ? <p>{t('location.loading')}</p> : sorted.length ? <LocationTree items={sorted} parentId={null} onEdit={openEdit} onChild={(item) => openCreate(item.location_ref.entity_id)} onMove={openMove} onDelete={setDeleting} /> : <p>{t('location.empty')}</p>}
    {form && <section className="catalog-dialog" role="dialog" aria-modal="true" aria-label={form.mode === 'create' ? t('location.create') : form.mode === 'edit' ? t('location.edit') : t('location.reparent')}><form className="catalog-dialog__surface" onSubmit={(event) => void submit(event)}><h2>{form.mode === 'create' ? t('location.create') : form.mode === 'edit' ? t('location.edit') : t('location.reparent')}</h2>{form.mode !== 'reparent' && <><label><span>{t('location.name')}</span><input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span>{t('location.type')}</span><input value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} /></label><p className="location-form__hint">{t('location.typeHint')}</p></>} {form.mode !== 'edit' && <label><span>{t('location.parent')}</span><select value={form.parentId ?? ''} onChange={(event) => setForm({ ...form, parentId: event.target.value || null })}><option value="">{t('location.root')}</option>{sorted.filter((item) => !forbiddenParents.has(item.location_ref.entity_id)).map((item) => <option key={item.location_ref.entity_id} value={item.location_ref.entity_id}>{locationPath(sorted, item.location_ref.entity_id)}</option>)}</select></label>}{form.error && <p className="catalog-dialog__error" role="alert">{t('location.writeFailed', { error: form.error })}</p>}<div className="catalog-dialog__actions"><button type="button" disabled={busy} onClick={() => setForm(null)}>{t('action.cancel')}</button><button type="submit" disabled={busy || (form.mode !== 'reparent' && !form.name.trim())}>{busy ? t('location.saving') : t('catalog.save')}</button></div></form></section>}
    {deleting && <section className="catalog-dialog" role="dialog" aria-modal="true" aria-label={t('location.delete')}><div className="catalog-dialog__surface"><h2>{t('location.delete')}</h2><p>{t('location.deleteConfirm', { name: deleting.name })}</p>{deleteError && <p className="catalog-dialog__error" role="alert">{t('location.deleteFailed', { error: deleteError })}</p>}<div className="catalog-dialog__actions"><button type="button" disabled={busy} onClick={() => { setDeleting(null); setDeleteError(null); }}>{t('action.cancel')}</button><button type="button" disabled={busy} onClick={() => void remove()}>{busy ? t('location.deleting') : t('location.delete')}</button></div></div></section>}
  </main>;
}
