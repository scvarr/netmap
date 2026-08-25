import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { physicalClassPresentationForLocale } from '../topology/presentation';
import type {
  CatalogInventoryCableEndpoint,
  CatalogInventoryDataSource,
  CatalogInventoryDocument,
  CatalogInventoryEquipmentItem,
} from '../topology/catalogInventoryTypes';
import type { PhysicalObjectDeleteDataSource } from '../topology/physicalObjectDeleteTypes';
import type { PhysicalObjectDisplayNameWriteDataSource } from '../topology/physicalObjectDisplayNameWriteTypes';
import { useI18n } from '../i18n';

interface Props {
  catalogInventoryDataSource: CatalogInventoryDataSource;
  physicalObjectDeleteDataSource?: PhysicalObjectDeleteDataSource;
  physicalObjectDisplayNameWriteDataSource?: PhysicalObjectDisplayNameWriteDataSource;
}

interface RenameTarget {
  id: string;
  label: string;
  cable: boolean;
}

const known = new Set(['workstation', 'switch', 'cable', 'outlet', 'patch_panel']);

const fold = (value: string) => value.trim().toLocaleLowerCase();
const objectLink = (id: string) => `/infrastructure/objects/${encodeURIComponent(id)}`;
const mapLink = (map: string, object: string) =>
  `/map?map=${encodeURIComponent(map)}&view=physical&focus=${encodeURIComponent(object)}`;
const classLabel = (value: string | undefined, locale: 'ru' | 'en', t: ReturnType<typeof useI18n>['t']) =>
  value === undefined ? t('catalog.untype') : known.has(value) ? physicalClassPresentationForLocale(value, locale).label : value;

function CatalogState({
  kind,
  message,
  onRetry,
}: {
  kind: 'loading' | 'error';
  message?: string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`catalog-state view-state view-state--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <div className="view-state__signal">{kind === 'loading' ? <span className="spinner" /> : '!'}</div>
      <h2>{kind === 'loading' ? t('catalog.loading.title') : t('catalog.error.title')}</h2>
      <p>{kind === 'loading' ? t('catalog.loading.body') : message}</p>
      {kind === 'error' && onRetry && <button onClick={onRetry}>{t('action.retry')}</button>}
    </div>
  );
}

export function InfrastructureObjectsPage({
  catalogInventoryDataSource,
  physicalObjectDeleteDataSource,
  physicalObjectDisplayNameWriteDataSource,
}: Props) {
  const { collator, locale, t } = useI18n();
  const [document, setDocument] = useState<CatalogInventoryDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'equipment' | 'cables'>('equipment');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [map, setMap] = useState('all');
  const [ports, setPorts] = useState('all');
  const [cableState, setCableState] = useState('all');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameSavedPendingRefresh, setRenameSavedPendingRefresh] = useState(false);
  const sequence = useRef(0);

  const reload = useCallback(async (): Promise<boolean> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);

    try {
      const next = await catalogInventoryDataSource.loadCatalogInventory();
      if (current === sequence.current) {
        setDocument(next);
        return true;
      }
    } catch (reason) {
      if (current === sequence.current) {
        setError(reason instanceof Error ? reason.message : t('catalog.unknownError'));
      }
      return false;
    } finally {
      if (current === sequence.current) {
        setLoading(false);
      }
    }
    return false;
  }, [catalogInventoryDataSource, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = async (id: string, label: string, cable: boolean) => {
    if (
      !physicalObjectDeleteDataSource ||
      !window.confirm(cable ? t('catalog.deleteCableConfirm', { name: label }) : t('catalog.deleteObjectConfirm', { name: label }))
    ) {
      return;
    }

    setDeleteError(null);

    try {
      await physicalObjectDeleteDataSource.deletePhysicalObject(id);
      await reload();
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : t('catalog.error.title'));
    }
  };

  const openRename = (target: RenameTarget) => {
    setRenameTarget(target);
    setRenameValue(target.label);
    setRenameError(null);
    setRenameSavedPendingRefresh(false);
  };

  const rename = async () => {
    if (!renameTarget || !physicalObjectDisplayNameWriteDataSource || renaming) {
      return;
    }
    const displayName = renameValue.trim();
    if (!displayName || displayName === renameTarget.label) {
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      await physicalObjectDisplayNameWriteDataSource.renamePhysicalObject(renameTarget.id, displayName);
      if (await reload()) {
        setRenameTarget(null);
      } else {
        setRenameSavedPendingRefresh(true);
        setRenameError(t('catalog.renameRefreshError'));
      }
    } catch (reason) {
      setRenameError(reason instanceof Error ? reason.message : t('catalog.renameObject'));
    } finally {
      setRenaming(false);
    }
  };

  const retryRenameRefresh = async () => {
    if (await reload()) {
      setRenameTarget(null);
    }
  };

  const query = fold(search);
  const equipmentAll = document?.equipment ?? [];
  const cablesAll = document?.cables ?? [];

  const equipment = equipmentAll
    .filter((item) => {
      const occupancy = item.occupancy ?? undefined;
      const text = [item.label, item.class, ...item.map_memberships.map((membership) => membership.name)].some(
        (value) => !query || fold(value ?? '').includes(query),
      );
      const typeOk =
        type === 'all' || type === 'none'
          ? type !== 'none' || item.class === undefined
          : item.class === type;
      const mapOk =
        map === 'all' || map === 'none'
          ? map !== 'none' || item.map_memberships.length === 0
          : item.map_memberships.some((membership) => membership.map_ref.entity_id === map);
      const portsOk =
        ports === 'all' ||
        (ports === 'connected' && !!occupancy && occupancy.connected_ports > 0) ||
        (ports === 'free' && !!occupancy && occupancy.free_ports > 0) ||
        (ports === 'busy' && !!occupancy && occupancy.total_ports > 0 && occupancy.free_ports === 0) ||
        (ports === 'unknown' && !occupancy);

      return text && typeOk && mapOk && portsOk;
    })
    .sort((a, b) => collator.compare(a.label, b.label));

  const cables = cablesAll
    .filter((item) => {
      const values = [
        item.label,
        item.endpoint_a?.remote_physical_object_label,
        item.endpoint_a?.remote_connection_point_label,
        item.endpoint_b?.remote_physical_object_label,
        item.endpoint_b?.remote_connection_point_label,
      ];

      return (
        values.some((value) => !query || fold(value ?? '').includes(query)) &&
        (cableState === 'all' || item.resolution === cableState)
      );
    })
    .sort((a, b) => collator.compare(a.label, b.label));

  const classes = [...new Set(equipmentAll.flatMap((item) => (item.class ? [item.class] : [])))].sort(
    collator.compare,
  );
  const maps = [
    ...new Map(
      equipmentAll.flatMap((item) =>
        item.map_memberships.map((membership) => [membership.map_ref.entity_id, membership.name] as const),
      ),
    ).entries(),
  ].sort((a, b) => collator.compare(a[1], b[1]));
  const currentTotal = tab === 'equipment' ? equipmentAll.length : cablesAll.length;
  const shown = tab === 'equipment' ? equipment.length : cables.length;
  const inventoryEmpty = !!document && equipmentAll.length === 0 && cablesAll.length === 0;

  return (
    <main className="catalog-page">
      <header className="catalog-page__header">
        <div>
          <span className="eyebrow">{t('catalog.infrastructure')}</span>
          <h1>{t('catalog.title')}</h1>
          <p>{t('catalog.description')}</p>
        </div>
        {tab === 'equipment' && (
          <Link className="primary-action" to="/infrastructure/objects/new">
            {t('catalog.createObject')}
          </Link>
        )}
      </header>

      <div className="catalog-tabs" role="tablist" aria-label={t('catalog.sections')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'equipment'}
          onClick={() => setTab('equipment')}
        >
          {t('catalog.equipment', { count: equipmentAll.length })}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'cables'}
          onClick={() => setTab('cables')}
        >
          {t('catalog.cables', { count: cablesAll.length })}
        </button>
      </div>

      <section className="catalog-controls" aria-label={t('catalog.searchFilters')}>
        <label>
          {t('catalog.search')}
          <input aria-label={t('catalog.search')} value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        {tab === 'equipment' ? (
          <div className="catalog-controls__filters">
            <label>
              {t('catalog.type')}
              <select aria-label={t('catalog.type')} value={type} onChange={(event) => setType(event.target.value)}>
                <option value="all">{t('catalog.all')}</option>
                <option value="none">{t('catalog.untype')}</option>
                {classes.map((value) => (
                  <option key={value} value={value}>
                    {classLabel(value, locale, t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('catalog.map')}
              <select aria-label={t('catalog.map')} value={map} onChange={(event) => setMap(event.target.value)}>
                <option value="all">{t('catalog.allMaps')}</option>
                <option value="none">{t('catalog.noMap')}</option>
                {maps.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('catalog.ports')}
              <select aria-label={t('catalog.ports')} value={ports} onChange={(event) => setPorts(event.target.value)}>
                <option value="all">{t('catalog.all')}</option><option value="connected">{t('catalog.connectedPorts')}</option><option value="free">{t('catalog.freePorts')}</option><option value="busy">{t('catalog.busyPorts')}</option><option value="unknown">{t('catalog.occupancyUnknown')}</option>
              </select>
            </label>
          </div>
        ) : (
          <label>
            {t('catalog.status')}
            <select
              aria-label={t('catalog.cableState')}
              value={cableState}
              onChange={(event) => setCableState(event.target.value)}
            >
              <option value="all">{t('catalog.all')}</option><option value="SIMPLE_CABLE">{t('catalog.resolved')}</option><option value="UNRESOLVED">Неоднозначные</option>
            </select>
          </label>
        )}
      </section>

      <section className="catalog-surface" aria-label={t('catalog.list')}>
        {loading && !document && <CatalogState kind="loading" />}
        {error && !document && <CatalogState kind="error" message={error} onRetry={() => void reload()} />}
        {inventoryEmpty && <div className="catalog-state"><p>{t('catalog.empty')}</p></div>}
        {document && !inventoryEmpty && currentTotal === 0 && (
          <div className="catalog-state">
            <p>
              {tab === 'equipment'
                ? t('catalog.noEquipment') : t('catalog.cablesHint')}
            </p>
          </div>
        )}
        {document && !inventoryEmpty && currentTotal > 0 && shown === 0 && (
          <div className="catalog-state"><p>{t('catalog.noResults')}</p></div>
        )}
        {document && shown > 0 && tab === 'equipment' && (
          <Equipment
            rows={equipment}
            remove={physicalObjectDeleteDataSource ? remove : undefined}
            onRename={physicalObjectDisplayNameWriteDataSource ? openRename : undefined}
          />
        )}
        {document && shown > 0 && tab === 'cables' && (
          <Cables
            rows={cables}
            remove={physicalObjectDeleteDataSource ? remove : undefined}
            onRename={physicalObjectDisplayNameWriteDataSource ? openRename : undefined}
          />
        )}
      </section>

      {error && document && (
        <p className="catalog-note catalog-note--gap" role="alert">
          {t('catalog.refreshError', { error })}{' '}
          <button type="button" onClick={() => void reload()}>
            {t('action.retry')}
          </button>
        </p>
      )}
      {deleteError && (
        <p className="catalog-note catalog-note--gap" role="alert">
          {deleteError}
        </p>
      )}
      {document?.warnings.map((warning, index) => (
        <p className="catalog-note" key={`warning-${index}`} role="status">
          {warning}
        </p>
      ))}
      {document?.gaps.map((gap, index) => (
        <p className="catalog-note catalog-note--gap" key={`gap-${index}`} role="status">
          {gap}
        </p>
      ))}
      {renameTarget && (
        <RenameDialog
          target={renameTarget}
          value={renameValue}
          error={renameError}
          pending={renaming}
          savedPendingRefresh={renameSavedPendingRefresh}
          onChange={setRenameValue}
          onCancel={() => setRenameTarget(null)}
          onSave={() => void rename()}
          onRetryRefresh={() => void retryRenameRefresh()}
        />
      )}
    </main>
  );
}

function RenameDialog({
  target,
  value,
  error,
  pending,
  savedPendingRefresh,
  onChange,
  onCancel,
  onSave,
  onRetryRefresh,
}: {
  target: RenameTarget;
  value: string;
  error: string | null;
  pending: boolean;
  savedPendingRefresh: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onRetryRefresh: () => void;
}) {
  const { t } = useI18n();
  const normalized = value.trim();
  const unchanged = normalized === target.label;

  return (
    <div className="catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title">
      <form
        className="catalog-dialog__surface"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <h2 id="rename-title">{target.cable ? t('catalog.renameCable') : t('catalog.renameObject')}</h2>
        <label>
          {t('catalog.name')}
          <input
            autoFocus
            aria-label={t('catalog.name')}
            value={value}
            disabled={pending || savedPendingRefresh}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        {error && <p className="catalog-dialog__error" role="alert">{error}</p>}
        <div className="catalog-dialog__actions">
          <button type="button" onClick={onCancel} disabled={pending}>
            {t('map.cancel')}
          </button>
          {savedPendingRefresh ? (
            <button type="button" onClick={onRetryRefresh} disabled={pending}>
              {t('catalog.retryRefresh')}
            </button>
          ) : (
            <button type="submit" disabled={pending || !normalized || unchanged}>
              {t('catalog.save')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Equipment({
  rows,
  remove,
  onRename,
}: {
  rows: CatalogInventoryEquipmentItem[];
  remove?: (id: string, label: string, cable: boolean) => Promise<void>;
  onRename?: (target: RenameTarget) => void;
}) {
  const { collator, locale, t } = useI18n();
  return (
    <div className="catalog-table-wrap">
      <table className="catalog-table">
        <thead>
          <tr>
            <th>{t('catalog.name')}</th><th>{t('catalog.type')}</th><th>{t('catalog.ports')}</th><th>{t('object.maps')}</th><th><span className="sr-only">{t('catalog.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const id = item.physical_object_ref.entity_id;

            return (
              <tr key={id}>
                <td><Link to={objectLink(id)}>{item.label}</Link></td>
                <td>
                  <strong>{classLabel(item.class, locale, t)}</strong>
                  {item.class && known.has(item.class) && <code>{item.class}</code>}
                </td>
                <td>
                  {item.occupancy ? (
                    <>
                      <strong>{item.occupancy.connected_ports} / {item.occupancy.total_ports}</strong>
                      <small>{t('catalog.freeCount', { count: item.occupancy.free_ports })}</small>
                    </>
                  ) : (
                    t('catalog.undefined')
                  )}
                </td>
                <td>
                  {item.map_memberships.length === 0
                    ? t('catalog.notAvailable')
                    : [...item.map_memberships]
                        .sort((a, b) => collator.compare(a.name, b.name))
                        .map((membership) => (
                          <Link
                            className="catalog-map-link"
                            key={membership.map_ref.entity_id}
                            to={mapLink(membership.map_ref.entity_id, id)}
                          >
                            {membership.name}
                          </Link>
                        ))}
                </td>
                <Actions id={id} label={item.label} cable={false} remove={remove} onRename={onRename} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cables({
  rows,
  remove,
  onRename,
}: {
  rows: CatalogInventoryDocument['cables'];
  remove?: (id: string, label: string, cable: boolean) => Promise<void>;
  onRename?: (target: RenameTarget) => void;
}) {
  const { t } = useI18n();
  const part = (value?: CatalogInventoryCableEndpoint) =>
    value ? (
      <>
        <Link to={objectLink(value.remote_physical_object_ref.entity_id)}>
          {value.remote_physical_object_label}
        </Link>
        <span className="catalog-endpoint__port"> / {value.remote_connection_point_label}</span>
      </>
    ) : (
      '—'
    );

  return (
    <div className="catalog-table-wrap">
      <table className="catalog-table">
        <thead>
          <tr>
            <th>{t('catalog.name')}</th><th>{t('catalog.endpointA')}</th><th>{t('catalog.endpointB')}</th><th>{t('catalog.status')}</th><th><span className="sr-only">{t('catalog.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const id = item.cable_ref.entity_id;

            return (
              <tr key={id}>
                <td><Link to={objectLink(id)}>{item.label}</Link></td>
                <td className="catalog-endpoint">
                  {item.resolution === 'SIMPLE_CABLE' ? part(item.endpoint_a) : '—'}
                </td>
                <td className="catalog-endpoint">
                  {item.resolution === 'SIMPLE_CABLE' ? part(item.endpoint_b) : '—'}
                </td>
                <td>{item.resolution === 'SIMPLE_CABLE' ? t('catalog.resolved') : t('catalog.unresolved')}</td>
                <Actions id={id} label={item.label} cable remove={remove} onRename={onRename} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Actions({
  id,
  label,
  cable,
  remove,
  onRename,
}: {
  id: string;
  label: string;
  cable: boolean;
  remove?: (id: string, label: string, cable: boolean) => Promise<void>;
  onRename?: (target: RenameTarget) => void;
}) {
  const { t } = useI18n();
  return (
    <td className="catalog-table__actions">
      <Link className="catalog-table__open" aria-label={`${t('inspector.open')} ${label}`} to={objectLink(id)}>
        →
      </Link>
      {onRename && (
        <button
          type="button"
          className="catalog-table__rename"
          aria-label={`${t('catalog.rename')} ${label}`}
          onClick={() => onRename({ id, label, cable })}
        >
          {t('catalog.rename')}
        </button>
      )}
      {remove && (
        <button
          type="button"
          className="catalog-table__delete"
          aria-label={`${t('catalog.delete')} ${label}`}
          onClick={() => void remove(id, label, cable)}
        >
          ⌫
        </button>
      )}
    </td>
  );
}
