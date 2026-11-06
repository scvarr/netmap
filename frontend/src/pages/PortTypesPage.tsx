import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useI18n } from '../i18n';
import { Breadcrumbs, PageHeader, PageShell } from '../components/PageChrome';

type PortTypeFields = {
  name: string;
  description: string | null;
  color: string;
  is_active: boolean;
};
type PortType = PortTypeFields & { id: string };

const emptyForm: PortTypeFields = { name: '', description: null, color: '#64748B', is_active: true };
const endpoint = '/api/v1/port-types';
const hex = /^#[0-9A-Fa-f]{6}$/;

export function PortTypesPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<PortType[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'request' | 'conflict' | 'invalid' | null>(null);

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
        setError(response.status === 409 ? 'conflict' : response.status === 422 ? 'invalid' : 'request');
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

  return <PageShell className="catalog-page">
    <Breadcrumbs label={t('portTypes.title')} items={[{ label: t('portTypes.section') }, { label: t('portTypes.title') }]} />
    <PageHeader eyebrow={t('portTypes.section')} title={t('portTypes.title')} />
    {error && <p role="alert">{t(`portTypes.${error}`)}</p>}
    {items === null && !error && <p role="status">{t('workspace.working')}</p>}
    <section className="catalog-surface">
      <form onSubmit={save}>
        <fieldset disabled={busy || items === null}>
          <legend>{t(editingId ? 'portTypes.edit' : 'portTypes.create')}</legend>
          <label>{t('portTypes.name')} <input required maxLength={255} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>{t('portTypes.description')} <input value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value || null })} /></label>
          <label>{t('portTypes.palette')} <input type="color" value={hex.test(form.color) ? form.color : emptyForm.color} onChange={(event) => setForm({ ...form, color: event.target.value.toUpperCase() })} /></label>
          <label>HEX <input required pattern="#[0-9A-Fa-f]{6}" maxLength={7} value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></label>
          <button className="primary-action" type="submit">{t('portTypes.save')}</button>
          {editingId && <button className="secondary-action" type="button" onClick={resetForm}>{t('portTypes.cancel')}</button>}
        </fieldset>
      </form>
    </section>
    {items?.length === 0 && <p>{t('portTypes.empty')}</p>}
    {!!items?.length && <section className="catalog-surface" aria-label={t('portTypes.title')}>
      <ul>
        {[...items].sort((a, b) => a.name.localeCompare(b.name)).map(({ id, ...fields }) => (
          <li key={id}>
            <span aria-hidden="true" style={{ display: 'inline-block', width: '1em', height: '1em', border: '1px solid currentColor', backgroundColor: fields.color }} />{' '}
            <strong>{fields.name}</strong> <code>{fields.color}</code> · {t(fields.is_active ? 'portTypes.active' : 'portTypes.archived')}
            {fields.description && <p>{fields.description}</p>}
            <div>
              <button className="secondary-action" type="button" disabled={busy} onClick={() => { setEditingId(id); setForm(fields); setError(null); }}>{t('portTypes.edit')}</button>
              <button className="secondary-action" type="button" disabled={busy} onClick={() => void mutate('PUT', id, { ...fields, is_active: !fields.is_active })}>{t(fields.is_active ? 'portTypes.archive' : 'portTypes.restore')}</button>
              {!fields.is_active && <button className="danger-action" type="button" disabled={busy} onClick={() => {
                if (window.confirm(t('portTypes.deleteConfirm'))) void mutate('DELETE', id);
              }}>{t('portTypes.delete')}</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>}
  </PageShell>;
}
