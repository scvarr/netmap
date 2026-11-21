import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { PageHeader, PageShell } from '../components/PageChrome';

import type { CableType, CatalogType, ConnectorType, Medium, PortType } from '../components/PortTypeSelect';

import type { MountType } from '../components/ModulePortTypeSelect';

type Catalog = 'module-bay-types' | 'module-port-types' | 'port-types' | 'connector-types' | 'cable-types';
type Item = PortType | ConnectorType | CableType | MountType;
type Fields = Omit<CatalogType, 'id'>;
type Payload = Omit<MountType, 'id'> & Partial<Fields> & ReturnType<typeof structureOf>;
const titles = { 'module-bay-types': 'moduleBayTypes.title', 'module-port-types': 'modulePortTypes.title', 'port-types': 'portTypes.title', 'connector-types': 'physicalCatalog.connectorTypes', 'cable-types': 'physicalCatalog.cableTypes' } as const;
const createLabels = { 'module-bay-types': 'moduleBayTypes.create', 'module-port-types': 'modulePortTypes.create', 'port-types': 'portTypes.create', 'connector-types': 'physicalCatalog.createConnector', 'cable-types': 'physicalCatalog.createCable' } as const;
const emptyStructure = { medium: 'COPPER' as Medium, members: '', connector_type_id: '', mating_profile: '', termination: 'SOCKET' as ConnectorType['termination'], construction: '' };

function structureOf(item: Item) {
  if ('members' in item) {
    return { medium: item.medium, members: item.members, connector_type_id: item.connector_type_id };
  }
  if ('mating_profile' in item) return { mating_profile: item.mating_profile, termination: item.termination };
  if ('construction' in item) return { medium: item.medium, construction: item.construction };
  return {};
}

const emptyForm: Fields = { name: '', description: null, color: '#64748B', is_active: true };
const hex = /^#[0-9A-Fa-f]{6}$/;

export function PhysicalCatalogPage({ catalog }: { catalog: Catalog }) {
  const { t, locale } = useI18n();
  const endpoint = '/api/v1/' + catalog;
  const title = t(titles[catalog]);
  const modular = catalog === 'module-port-types' || catalog === 'module-bay-types';
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const status = params.get('status') ?? 'all';
  const direction = params.get('sort') === 'desc' ? 'descending' : 'ascending';
  const requestedSize = Number(params.get('size'));
  const size = requestedSize === 50 || requestedSize === 100 ? requestedSize : 25;
  const requestedPage = Number(params.get('page'));
  const [items, setItems] = useState<Item[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [structure, setStructure] = useState(emptyStructure);
  const [connectors, setConnectors] = useState<ConnectorType[]>();
  const [attempt, setAttempt] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'request' | 'conflict' | 'invalid' | 'inUse' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const response = await fetch(endpoint, { signal: controller.signal });
      if (!response.ok) throw new Error();
      if (catalog === 'port-types') {
        const connectorResponse = await fetch('/api/v1/connector-types', { signal: controller.signal });
        if (!connectorResponse.ok) throw new Error();
        setConnectors(await connectorResponse.json() as ConnectorType[]);
      }
      setItems(await response.json() as Item[]);
    }
    setError(null);
    void load().catch(() => {
      if (!controller.signal.aborted) setError('request');
    });
    return () => controller.abort();
  }, [attempt, catalog, endpoint]);

  function changeList(key: string, value: string) {
    setParams(current => {
      const next = new URLSearchParams(current);
      if (key !== 'page') next.delete('page');
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setStructure(emptyStructure);
  }

  async function mutate(method: 'POST' | 'PUT' | 'DELETE', id: string | null, fields?: Payload) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(id ? `${endpoint}/${id}` : endpoint, {
        method,
        ...(fields && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }),
      });
      if (!response.ok) {
        const inUse = response.status === 409 && ['Catalog type is in use', 'Catalog type structure is in use'].includes((await response.json()).detail);
        setError(inUse ? 'inUse' : response.status === 409 ? 'conflict' : response.status === 422 ? 'invalid' : 'request');
        return;
      }
      if (method === 'DELETE') {
        setItems((current) => (current ?? []).filter((item) => item.id !== id));
      } else {
        const saved = await response.json() as Item;
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
    const fields = modular ? { name: form.name, is_active: form.is_active } : form;
    const payload = modular ? {} : catalog === 'port-types'
      ? { medium: structure.medium, members: structure.members.split('\n').map(member => member.trim()).filter(Boolean), connector_type_id: structure.connector_type_id || null }
      : catalog === 'connector-types'
        ? { mating_profile: structure.mating_profile, termination: structure.termination }
        : { medium: structure.medium, construction: structure.construction };
    void mutate(editingId ? 'PUT' : 'POST', editingId, { ...fields, ...payload });
  }

  const query = search.trim().toLocaleLowerCase(locale);
  const visible = (items ?? []).filter(item =>
    (status === 'all' || item.is_active === (status === 'active')) &&
    `${item.name} ${('description' in item ? item.description : '') ?? ''}`.toLocaleLowerCase(locale).includes(query),
  ).sort((a, b) => {
    const byName = a.name.localeCompare(b.name, locale, { numeric: true });
    return (direction === 'ascending' ? byName : -byName) || a.id.localeCompare(b.id);
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / size));
  const page = Number.isInteger(requestedPage) ? Math.min(Math.max(1, requestedPage), pageCount) : 1;
  const rows = visible.slice((page - 1) * size, page * size);

  return <PageShell className="catalog-page port-types-page">
    <PageHeader eyebrow={t('portTypes.section')} title={title} />
    {error && items === null && <button type="button" className="secondary-action" onClick={() => setAttempt(attempt + 1)}>{t('physicalCatalog.retry')}</button>}
    {error && <p className="catalog-note catalog-note--gap" role="alert">{t(`portTypes.${error}`)}</p>}
    {items === null && !error && <p className="catalog-note" role="status">{t('workspace.working')}</p>}
    <section className="creation-form-surface">
      <form onSubmit={save}>
        <fieldset className="port-types-form" disabled={busy || items === null}>
          <legend>{t(editingId ? 'portTypes.edit' : createLabels[catalog])}</legend>
          <div className="port-types-form__fields">
            <label>{t('portTypes.name')} <input required maxLength={255} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            {!modular && <label>{t('portTypes.description')} <input value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value || null })} /></label>}
          </div>
          {!modular && <><div className="port-types-form__fields">
            {catalog !== 'connector-types' && <label>{t('physicalCatalog.medium')}
              <select value={structure.medium} onChange={event => setStructure({ ...structure, medium: event.target.value as Medium })}>
                <option value="COPPER">{t('physicalCatalog.COPPER')}</option>
                <option value="FIBER">{t('physicalCatalog.FIBER')}</option>
              </select>
            </label>}
            {catalog === 'port-types' && <>
              <label>{t('physicalCatalog.members')}
                <textarea required rows={3} value={structure.members} onChange={event => setStructure({ ...structure, members: event.target.value })} />
              </label>
              <label>{t('physicalCatalog.connector')}
                <select value={structure.connector_type_id} onChange={event => setStructure({ ...structure, connector_type_id: event.target.value })}>
                  <option value="">{t('physicalCatalog.noConnector')}</option>
                  {connectors?.filter(item => item.is_active || item.id === structure.connector_type_id).map(item =>
                    <option key={item.id} value={item.id} disabled={!item.is_active}>
                      {item.name}{!item.is_active && ` · ${t('portTypes.archived')}`}
                    </option>)}
                </select>
              </label>
            </>}
            {catalog === 'connector-types' && <>
              <label>{t('physicalCatalog.profile')}
                <input required maxLength={255} value={structure.mating_profile} onChange={event => setStructure({ ...structure, mating_profile: event.target.value })} />
              </label>
              <label>{t('physicalCatalog.termination')}
                <select value={structure.termination} onChange={event => setStructure({ ...structure, termination: event.target.value as ConnectorType['termination'] })}>
                  <option value="SOCKET">{t('physicalCatalog.SOCKET')}</option>
                  <option value="PLUG">{t('physicalCatalog.PLUG')}</option>
                </select>
              </label>
            </>}
            {catalog === 'cable-types' && <label>{t('physicalCatalog.construction')}
              <input required maxLength={255} value={structure.construction} onChange={event => setStructure({ ...structure, construction: event.target.value })} />
            </label>}
          </div>
          <div className="blueprint-editor-color">
            <label>{t('portTypes.palette')} <input type="color" value={hex.test(form.color) ? form.color : emptyForm.color} onChange={(event) => setForm({ ...form, color: event.target.value.toUpperCase() })} /></label>
            <label>HEX <input required pattern="#[0-9A-Fa-f]{6}" maxLength={7} value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></label>
          </div></>}
          <div className="port-types-form__actions">
            <button className="primary-action" type="submit">{t('portTypes.save')}</button>
            {editingId && <button className="secondary-action" type="button" onClick={resetForm}>{t('portTypes.cancel')}</button>}
          </div>
        </fieldset>
      </form>
    </section>
    {items?.length === 0 && <p className="catalog-note">{t('physicalCatalog.empty')}</p>}
    {!!items?.length && <section className="catalog-controls" aria-label={t('catalog.searchFilters')}>
      <label>{t('catalog.search')}<input value={search} onChange={event => changeList('q', event.target.value)} /></label>
      <label>{t('catalog.status')}
        <select value={status} onChange={event => changeList('status', event.target.value)}>
          <option value="all">{t('catalog.all')}</option>
          <option value="active">{t('portTypes.active')}</option>
          <option value="archived">{t('portTypes.archived')}</option>
        </select>
      </label>
      <span role="status">{t('physicalCatalog.results', { count: visible.length })}</span>
    </section>}
    {!!items?.length && !rows.length && <p className="catalog-note">{t('catalog.noResults')}</p>}
    {!!rows.length && <section className="catalog-surface catalog-table-wrap" aria-label={title}>
      <table className="catalog-table">
        <thead>
          <tr>
            <th scope="col" aria-sort={direction}>
              <button className="text-action" type="button" onClick={() => changeList('sort', direction === 'ascending' ? 'desc' : '')}>
                {t('portTypes.name')} <span aria-hidden="true">{direction === 'ascending' ? '↑' : '↓'}</span>
              </button>
            </th>
            {!modular && <><th scope="col">{t('physicalCatalog.structure')}</th>
            <th scope="col">{t('blueprint.editor.color')}</th></>}
            <th scope="col">{t('catalog.status')}</th>
            <th scope="col"><span className="sr-only">{t('catalog.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(item => {
            const { id, name, is_active } = item;
            const fields = { name, is_active };
            const appearance = 'color' in item ? { color: item.color, description: item.description } : undefined;
            const physicalFields = structureOf(item);
            return (
            <tr key={id}>
              <td>
                <strong>{fields.name}</strong>
                {appearance?.description && <small>{appearance.description}</small>}
              </td>
              {appearance && <><td>
                {'medium' in item && t(`physicalCatalog.${item.medium}`)}
                {'members' in item && <> · {item.cardinality} <small>{item.members.join(', ')}</small>
                  {item.connector_type_id && <small>{connectors?.find(connector => connector.id === item.connector_type_id)?.name}</small>}
                </>}
                {'mating_profile' in item && <>{item.mating_profile} · {t(`physicalCatalog.${item.termination}`)}</>}
                {'construction' in item && <> · {item.construction}</>}
              </td>
              <td><span className="port-types-swatch">
                <span aria-hidden="true" style={{ backgroundColor: appearance.color }} />
                <span>{appearance.color}</span>
              </span></td></>}
              <td>{t(fields.is_active ? 'portTypes.active' : 'portTypes.archived')}</td>
              <td><div className="catalog-table__actions">
                <button className="secondary-action" type="button" disabled={busy} onClick={() => { setEditingId(id); setForm({ ...emptyForm, ...fields, ...appearance }); setStructure('members' in item ? {
                  ...emptyStructure, medium: item.medium, members: item.members.join('\n'),
                  connector_type_id: item.connector_type_id ?? '',
                } : 'mating_profile' in item ? { ...emptyStructure, mating_profile: item.mating_profile, termination: item.termination }
                  : 'construction' in item ? { ...emptyStructure, medium: item.medium, construction: item.construction } : emptyStructure); setError(null); }}>{t('portTypes.edit')}</button>
                <button className="secondary-action" type="button" disabled={busy} onClick={() => void mutate('PUT', id, { ...physicalFields, ...appearance, ...fields, is_active: !fields.is_active })}>{t(fields.is_active ? 'portTypes.archive' : 'portTypes.restore')}</button>
                {!fields.is_active && <button className="danger-action" type="button" disabled={busy} onClick={() => {
                  if (window.confirm(t('portTypes.deleteConfirm'))) void mutate('DELETE', id);
                }}>{t('portTypes.delete')}</button>}
              </div></td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </section>}
    {visible.length > 25 && <div className="catalog-controls">
      <label>{t('physicalCatalog.pageSize')}
        <select value={size} onChange={event => changeList('size', event.target.value)}>
          {[25, 50, 100].map(value => <option key={value}>{value}</option>)}
        </select>
      </label>
      <div className="catalog-table__actions">
        <button className="secondary-action" type="button" disabled={page === 1} onClick={() => changeList('page', String(page - 1))}>{t('physicalCatalog.previous')}</button>
        <span>{page} / {pageCount}</span>
        <button className="secondary-action" type="button" disabled={page === pageCount} onClick={() => changeList('page', String(page + 1))}>{t('physicalCatalog.next')}</button>
      </div>
    </div>}
  </PageShell>;
}
