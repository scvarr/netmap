import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import type { CableLabelDataSource, CableLabelTemplate, CableLabelTemplateWrite } from '../topology/cableLabelTypes';

const blank = (): CableLabelTemplateWrite => ({ name: '', description: '', pattern: '', start_at: 0 });

export function CableLabelTemplatesPage({ dataSource }: { dataSource: CableLabelDataSource }) {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<CableLabelTemplate[]>([]);
  const [uniqueLabels, setUniqueLabels] = useState(false);
  const [form, setForm] = useState<CableLabelTemplateWrite | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => { try { const [list, settings] = await Promise.all([dataSource.loadCableLabelTemplates(), dataSource.loadCableLabelSettings()]); setTemplates(list.templates); setUniqueLabels(settings.unique_labels); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Error'); } };
  useEffect(() => { void load(); }, [dataSource]);
  const save = async (event: FormEvent) => { event.preventDefault(); if (!form) return; try { if (editing) await dataSource.updateCableLabelTemplate(editing, form); else await dataSource.createCableLabelTemplate(form); setForm(null); setEditing(null); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Error'); } };
  const edit = (item: CableLabelTemplate) => { setEditing(item.id); setForm({ name: item.name, description: item.description, pattern: item.pattern, start_at: item.start_at }); };
  return <main className="catalog-page">
    <nav className="breadcrumbs" aria-label={t('catalog.infrastructure')}><Link to="/infrastructure/objects">{t('catalog.infrastructure')}</Link><span>/</span><span>{t('cableTemplates.cables')}</span><span>/</span><span>{t('cableTemplates.title')}</span></nav>
    <header className="catalog-page__header"><div><span className="eyebrow">{t('catalog.infrastructure')}</span><h1>{t('cableTemplates.title')}</h1><p>{t('cableTemplates.description')}</p></div><button className="primary-action" type="button" onClick={() => { setForm(blank()); setEditing(null); }}>{t('cableTemplates.create')}</button></header>
    <section className="catalog-note" aria-label={t('cableTemplates.uniqueLabels')}><label><input type="checkbox" checked={uniqueLabels} onChange={async (event) => { try { const next = await dataSource.setCableLabelSettings({ unique_labels: event.target.checked }); setUniqueLabels(next.unique_labels); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Error'); } }} /> {t('cableTemplates.uniqueLabels')}</label><small>{t('cableNaming.hint')}</small></section>
    {error && <p className="catalog-note catalog-note--gap" role="alert">{error}</p>}
    <section className="catalog-surface">{templates.length === 0 ? <div className="catalog-state"><p>{t('cableTemplates.empty')}</p></div> : <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>{t('cableTemplates.name')}</th><th>{t('cableTemplates.descriptionField')}</th><th>{t('cableTemplates.pattern')}</th><th>{t('cableTemplates.startAt')}</th><th><span className="sr-only">{t('catalog.actions')}</span></th></tr></thead><tbody>{templates.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.description ?? '—'}</td><td><code>{item.pattern}</code></td><td>{item.start_at}</td><td className="catalog-table__actions"><button className="catalog-table__rename" type="button" onClick={() => edit(item)}>{t('cableTemplates.edit')}</button><button className="catalog-table__delete" type="button" aria-label={`${t('cableTemplates.delete')} ${item.name}`} onClick={() => { if (window.confirm(t('cableTemplates.deleteConfirm', { name: item.name }))) void dataSource.deleteCableLabelTemplate(item.id).then(load, (reason) => setError(reason instanceof Error ? reason.message : 'Error')); }}>⌫</button></td></tr>)}</tbody></table></div>}</section>
    {form && <div className="catalog-dialog" role="dialog" aria-modal="true" aria-label={editing ? t('cableTemplates.edit') : t('cableTemplates.create')}><form className="catalog-dialog__surface" onSubmit={save}><h2>{editing ? t('cableTemplates.edit') : t('cableTemplates.create')}</h2><label><span>{t('cableTemplates.name')}</span><input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span>{t('cableTemplates.descriptionField')}</span><input value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label><span>{t('cableTemplates.pattern')}</span><input value={form.pattern} onChange={(event) => setForm({ ...form, pattern: event.target.value })} /></label><label><span>{t('cableTemplates.startAt')}</span><input type="number" min="0" value={form.start_at} onChange={(event) => setForm({ ...form, start_at: Number(event.target.value) })} /></label><p className="location-form__hint">{t('cableNaming.hint')}</p><div className="catalog-dialog__actions"><button type="button" onClick={() => { setForm(null); setEditing(null); }}>{t('cableTemplates.cancel')}</button><button type="submit">{t('cableTemplates.save')}</button></div></form></div>}
  </main>;
}
