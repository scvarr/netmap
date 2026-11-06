import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useI18n } from '../i18n';
import { Breadcrumbs, PageHeader, PageShell } from '../components/PageChrome';

import { portTypesUrl as endpoint, type PortType } from '../components/PortTypeSelect';

type PortTypeFields = Omit<PortType, 'id'>;

const emptyForm: PortTypeFields = { name: '', description: null, color: '#64748B', is_active: true };
const hex = /^#[0-9A-Fa-f]{6}$/;

export function PortTypesPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<PortType[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'request' | 'conflict' | 'invalid' | 'inUse' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      setItems(await response.json() as PortType[]);
    }).catch(() => {
      if (!controller.signal.aborted) setError('request');
    });
    return () => controller.abort();
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function mutate(method: 'POST' | 'PUT' | 'DELETE', id: string | null, fields?: PortTypeFields) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(id ? `${endpoint}/${id}` : endpoint, {
        method,
        ...(fields && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }),
      });
      if (!response.ok) {
        const inUse = method === 'DELETE' && response.status === 409 &&
          (await response.json()).detail === 'Port type is in use';
        setError(inUse ? 'inUse' : response.status === 409 ? 'conflict' : response.status === 422 ? 'invalid' : 'request');
        return;
      }
      if (method === 'DELETE') {
        setItems((current) => (current ?? []).filter((item) => item.id !== id));
      } else {
        const saved = await response.json() as PortType;
        setItems((current) => [...(current ?? []).filter((item) => item.id !== saved.id), saved]);
      }
      if (method === 'POST' || id === editingId) resetForm();
    } catch {
      setError('request');
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void mutate(editingId ? 'PUT' : 'POST', editingId, form);
  }

  return <PageShell className="catalog-page port-types-page">
    <Breadcrumbs label={t('portTypes.title')} items={[{ label: t('portTypes.section') }, { label: t('portTypes.title') }]} />
    <PageHeader eyebrow={t('portTypes.section')} title={t('portTypes.title')} />
    {error && <p className="catalog-note catalog-note--gap" role="alert">{t(`portTypes.${error}`)}</p>}
    {items === null && !error && <p className="catalog-note" role="status">{t('workspace.working')}</p>}
    <section className="creation-form-surface">
      <form onSubmit={save}>
        <fieldset className="port-types-form" disabled={busy || items === null}>
          <legend>{t(editingId ? 'portTypes.edit' : 'portTypes.create')}</legend>
          <div className="port-types-form__fields">
            <label>{t('portTypes.name')} <input required maxLength={255} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>{t('portTypes.description')} <input value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value || null })} /></label>
          </div>
          <div className="blueprint-editor-color">
            <label>{t('portTypes.palette')} <input type="color" value={hex.test(form.color) ? form.color : emptyForm.color} onChange={(event) => setForm({ ...form, color: event.target.value.toUpperCase() })} /></label>
            <label>HEX <input required pattern="#[0-9A-Fa-f]{6}" maxLength={7} value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></label>
          </div>
          <div className="port-types-form__actions">
            <button className="primary-action" type="submit">{t('portTypes.save')}</button>
            {editingId && <button className="secondary-action" type="button" onClick={resetForm}>{t('portTypes.cancel')}</button>}
          </div>
        </fieldset>
      </form>
    </section>
    {items?.length === 0 && <p className="catalog-note">{t('portTypes.empty')}</p>}
    {!!items?.length && <section className="catalog-surface catalog-table-wrap" aria-label={t('portTypes.title')}>
      <table className="catalog-table">
        <thead>
          <tr>
            <th scope="col">{t('portTypes.name')}</th>
            <th scope="col">{t('blueprint.editor.color')}</th>
            <th scope="col">{t('catalog.status')}</th>
            <th scope="col"><span className="sr-only">{t('catalog.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {[...items].sort((a, b) => a.name.localeCompare(b.name)).map(({ id, ...fields }) => (
            <tr key={id}>
              <td>
                <strong>{fields.name}</strong>
                {fields.description && <small>{fields.description}</small>}
              </td>
              <td><span className="port-types-swatch">
                <span aria-hidden="true" style={{ backgroundColor: fields.color }} />
                <span>{fields.color}</span>
              </span></td>
              <td>{t(fields.is_active ? 'portTypes.active' : 'portTypes.archived')}</td>
              <td><div className="catalog-table__actions">
                <button className="secondary-action" type="button" disabled={busy} onClick={() => { setEditingId(id); setForm(fields); setError(null); }}>{t('portTypes.edit')}</button>
                <button className="secondary-action" type="button" disabled={busy} onClick={() => void mutate('PUT', id, { ...fields, is_active: !fields.is_active })}>{t(fields.is_active ? 'portTypes.archive' : 'portTypes.restore')}</button>
                {!fields.is_active && <button className="danger-action" type="button" disabled={busy} onClick={() => {
                  if (window.confirm(t('portTypes.deleteConfirm'))) void mutate('DELETE', id);
                }}>{t('portTypes.delete')}</button>}
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>}
  </PageShell>;
}
