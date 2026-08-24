import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { physicalClassPresentation } from '../topology/presentation';
import type {
  CatalogInventoryCableEndpoint,
  CatalogInventoryDataSource,
  CatalogInventoryDocument,
  CatalogInventoryEquipmentItem,
} from '../topology/catalogInventoryTypes';
import type { PhysicalObjectDeleteDataSource } from '../topology/physicalObjectDeleteTypes';

interface Props {
  catalogInventoryDataSource: CatalogInventoryDataSource;
  physicalObjectDeleteDataSource?: PhysicalObjectDeleteDataSource;
}

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
const known = new Set(['workstation', 'switch', 'cable', 'outlet', 'patch_panel']);

const fold = (value: string) => value.trim().toLocaleLowerCase();
const objectLink = (id: string) => `/infrastructure/objects/${encodeURIComponent(id)}`;
const mapLink = (map: string, object: string) =>
  `/map?map=${encodeURIComponent(map)}&view=physical&focus=${encodeURIComponent(object)}`;
const classLabel = (value?: string) =>
  value === undefined ? 'Без типа' : known.has(value) ? physicalClassPresentation(value).label : value;

function CatalogState({
  kind,
  message,
  onRetry,
}: {
  kind: 'loading' | 'error';
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className={`catalog-state view-state view-state--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <div className="view-state__signal">{kind === 'loading' ? <span className="spinner" /> : '!'}</div>
      <h2>{kind === 'loading' ? 'Загружаем каталог' : 'Не удалось загрузить каталог'}</h2>
      <p>{kind === 'loading' ? 'Получаем инвентарный список оборудования и кабелей…' : message}</p>
      {kind === 'error' && onRetry && <button onClick={onRetry}>Повторить</button>}
    </div>
  );
}

export function InfrastructureObjectsPage({
  catalogInventoryDataSource,
  physicalObjectDeleteDataSource,
}: Props) {
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
  const sequence = useRef(0);

  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);

    try {
      const next = await catalogInventoryDataSource.loadCatalogInventory();
      if (current === sequence.current) {
        setDocument(next);
      }
    } catch (reason) {
      if (current === sequence.current) {
        setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
      }
    } finally {
      if (current === sequence.current) {
        setLoading(false);
      }
    }
  }, [catalogInventoryDataSource]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = async (id: string, label: string, cable: boolean) => {
    if (
      !physicalObjectDeleteDataSource ||
      !window.confirm(cable ? `Удалить кабель «${label}» и разорвать соединение?` : `Удалить объект «${label}»?`)
    ) {
      return;
    }

    setDeleteError(null);

    try {
      await physicalObjectDeleteDataSource.deletePhysicalObject(id);
      await reload();
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : 'Не удалось удалить объект');
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
          <span className="eyebrow">Инфраструктура</span>
          <h1>Каталог</h1>
          <p>Оборудование, кабели, физические порты и размещение на картах.</p>
        </div>
        {tab === 'equipment' && (
          <Link className="primary-action" to="/infrastructure/objects/new">
            Создать объект
          </Link>
        )}
      </header>

      <div className="catalog-tabs" role="tablist" aria-label="Разделы каталога">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'equipment'}
          onClick={() => setTab('equipment')}
        >
          Оборудование ({equipmentAll.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'cables'}
          onClick={() => setTab('cables')}
        >
          Кабели ({cablesAll.length})
        </button>
      </div>

      <section className="catalog-controls" aria-label="Поиск и фильтры">
        <label>
          Поиск
          <input aria-label="Поиск" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        {tab === 'equipment' ? (
          <div className="catalog-controls__filters">
            <label>
              Тип
              <select aria-label="Тип" value={type} onChange={(event) => setType(event.target.value)}>
                <option value="all">Все</option>
                <option value="none">Без типа</option>
                {classes.map((value) => (
                  <option key={value} value={value}>
                    {classLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Карта
              <select aria-label="Карта" value={map} onChange={(event) => setMap(event.target.value)}>
                <option value="all">Все карты</option>
                <option value="none">Без карты</option>
                {maps.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Порты
              <select aria-label="Порты" value={ports} onChange={(event) => setPorts(event.target.value)}>
                <option value="all">Все</option>
                <option value="connected">Есть подключения</option>
                <option value="free">Есть свободные порты</option>
                <option value="busy">Все порты заняты</option>
                <option value="unknown">Состояние неизвестно</option>
              </select>
            </label>
          </div>
        ) : (
          <label>
            Состояние
            <select
              aria-label="Состояние кабеля"
              value={cableState}
              onChange={(event) => setCableState(event.target.value)}
            >
              <option value="all">Все</option>
              <option value="SIMPLE_CABLE">Разрешённые</option>
              <option value="UNRESOLVED">Неоднозначные</option>
            </select>
          </label>
        )}
      </section>

      <section className="catalog-surface" aria-label="Список каталога">
        {loading && !document && <CatalogState kind="loading" />}
        {error && !document && <CatalogState kind="error" message={error} onRetry={() => void reload()} />}
        {inventoryEmpty && <div className="catalog-state"><p>Каталог пока пуст.</p></div>}
        {document && !inventoryEmpty && currentTotal === 0 && (
          <div className="catalog-state">
            <p>
              {tab === 'equipment'
                ? 'Оборудование пока не создано.'
                : 'Кабели создаются через существующее физическое соединение.'}
            </p>
          </div>
        )}
        {document && !inventoryEmpty && currentTotal > 0 && shown === 0 && (
          <div className="catalog-state"><p>По заданным условиям ничего не найдено.</p></div>
        )}
        {document && shown > 0 && tab === 'equipment' && (
          <Equipment rows={equipment} remove={physicalObjectDeleteDataSource ? remove : undefined} />
        )}
        {document && shown > 0 && tab === 'cables' && (
          <Cables rows={cables} remove={physicalObjectDeleteDataSource ? remove : undefined} />
        )}
      </section>

      {error && document && (
        <p className="catalog-note catalog-note--gap" role="alert">
          Не удалось обновить каталог: {error}{' '}
          <button type="button" onClick={() => void reload()}>
            Повторить
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
    </main>
  );
}

function Equipment({
  rows,
  remove,
}: {
  rows: CatalogInventoryEquipmentItem[];
  remove?: (id: string, label: string, cable: boolean) => Promise<void>;
}) {
  return (
    <div className="catalog-table-wrap">
      <table className="catalog-table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Тип</th>
            <th>Порты</th>
            <th>Карты</th>
            <th><span className="sr-only">Действия</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const id = item.physical_object_ref.entity_id;

            return (
              <tr key={id}>
                <td><Link to={objectLink(id)}>{item.label}</Link></td>
                <td>
                  <strong>{classLabel(item.class)}</strong>
                  {item.class && known.has(item.class) && <code>{item.class}</code>}
                </td>
                <td>
                  {item.occupancy ? (
                    <>
                      <strong>{item.occupancy.connected_ports} / {item.occupancy.total_ports}</strong>
                      <small>{item.occupancy.free_ports} свободно</small>
                    </>
                  ) : (
                    'Состояние не определено'
                  )}
                </td>
                <td>
                  {item.map_memberships.length === 0
                    ? 'Нет'
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
                <Actions id={id} label={item.label} cable={false} remove={remove} />
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
}: {
  rows: CatalogInventoryDocument['cables'];
  remove?: (id: string, label: string, cable: boolean) => Promise<void>;
}) {
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
            <th>Название</th>
            <th>Конец A</th>
            <th>Конец B</th>
            <th>Состояние</th>
            <th><span className="sr-only">Действия</span></th>
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
                <td>{item.resolution === 'SIMPLE_CABLE' ? 'Разрешён' : 'Неоднозначно'}</td>
                <Actions id={id} label={item.label} cable remove={remove} />
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
}: {
  id: string;
  label: string;
  cable: boolean;
  remove?: (id: string, label: string, cable: boolean) => Promise<void>;
}) {
  return (
    <td className="catalog-table__actions">
      <Link className="catalog-table__open" aria-label={`Открыть ${label}`} to={objectLink(id)}>
        →
      </Link>
      {remove && (
        <button
          type="button"
          className="catalog-table__delete"
          aria-label={`Удалить ${label}`}
          onClick={() => void remove(id, label, cable)}
        >
          ⌫
        </button>
      )}
    </td>
  );
}
