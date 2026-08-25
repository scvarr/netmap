import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  displayNodeLabel,
  physicalClassPresentation,
} from "../topology/presentation";
import { physicalObjectIdForNode } from "../topology/projection";
import type {
  CatalogInventoryDataSource,
  CatalogInventoryDocument,
} from "../topology/catalogInventoryTypes";
import type {
  PhysicalObjectDetailsDataSource,
  PhysicalObjectDetailsDocument,
  ConnectionPointDetails,
} from "../topology/physicalObjectDetailsTypes";
import type {
  TopologyProjectionDocument,
  TopologyProjectionNode,
  TopologyProjectionEdge,
  TopologySelection,
} from "../topology/types";

interface QuickInspectorProps {
  document: TopologyProjectionDocument | null;
  selection: TopologySelection;
  onSelectNode: (node: TopologyProjectionNode) => void;
  onClose: () => void;
  physicalObjectDetailsDataSource?: PhysicalObjectDetailsDataSource;
  catalogInventoryDataSource?: CatalogInventoryDataSource;
  onDeletePhysicalObject?: (id: string) => Promise<void>;
  onRemoveFromMap?: (id: string) => Promise<void>;
  onAddContinuationToMap?: (id: string) => Promise<void>;
  placementLocked?: boolean;
  onSetPlacementLock?: (locked: boolean) => Promise<void>;
  mapOperation?: {
    kind: "remove" | "add" | "delete";
    id: string;
    status: "pending" | "refresh-failed";
    message?: string;
  } | null;
  onRetryMapRefresh?: () => Promise<void>;
}
const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const url = (id: string) => `/infrastructure/objects/${encodeURIComponent(id)}`;
const authoritative = (d: PhysicalObjectDetailsDocument) =>
  d.connection_points.length > 0 &&
  d.connection_points.every(
    (p) =>
      p.cardinality === 1 && Array.isArray(p.external_physical_attachments),
  );
const connections = (d: PhysicalObjectDetailsDocument) =>
  d.connection_points
    .filter((p) => p.external_physical_attachments?.length)
    .sort((a, b) =>
      natural(a.ordering_key ?? a.label, b.ordering_key ?? b.label),
    );
const endpointLabels = (
  edge: TopologyProjectionEdge,
  source?: TopologyProjectionNode,
  target?: TopologyProjectionNode,
) =>
  (edge.attributes.endpoint_pairs ?? []).flatMap((pair) => {
    const from = source?.attributes.connection_points?.find(
      (point) => point.connection_point_id === pair.from_connection_point_id,
    );
    const to = target?.attributes.connection_points?.find(
      (point) => point.connection_point_id === pair.to_connection_point_id,
    );
    return from && to
      ? [
          `${displayNodeLabel(source!)} / ${from.display_name} ↔ ${displayNodeLabel(target!)} / ${to.display_name}`,
        ]
      : [];
  });

export function QuickInspector(props: QuickInspectorProps) {
  const { document, selection, onClose, onSelectNode } = props;
  const [details, setDetails] = useState<PhysicalObjectDetailsDocument | null>(
    null,
  );
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inventory, setInventory] = useState<CatalogInventoryDocument | null>(
    null,
  );
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [readRevision, setReadRevision] = useState(0);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pending, setPending] = useState<"delete" | "remove" | null>(null);
  const [continuationError, setContinuationError] = useState<string | null>(
    null,
  );
  const [lockError, setLockError] = useState<string | null>(null);
  const [lockPending, setLockPending] = useState(false);
  const node = selection?.type === "node" ? selection.item : null;
  const id = node && physicalObjectIdForNode(node);
  const isL1 = document?.layer === "L1";
  const cable = Boolean(node && node.attributes.class === "cable");
  useEffect(() => {
    let active = true;
    setDetails(null);
    setDetailError(null);
    setLoading(false);
    setInventory(null);
    setInventoryError(null);
    if (!node || !id || !isL1)
      return () => {
        active = false;
      };
    if (cable) {
      if (props.catalogInventoryDataSource)
        void props.catalogInventoryDataSource.loadCatalogInventory().then(
          (x) => active && setInventory(x),
          (e) =>
            active &&
            setInventoryError(
              e instanceof Error ? e.message : "Не удалось загрузить кабели",
            ),
        );
      return () => {
        active = false;
      };
    }
    if (!props.physicalObjectDetailsDataSource)
      return () => {
        active = false;
      };
    setLoading(true);
    void props.physicalObjectDetailsDataSource
      .loadPhysicalObjectDetails(id)
      .then(
        (x) => {
          if (active) {
            setDetails(x);
            setLoading(false);
          }
        },
        (e) => {
          if (active) {
            setDetailError(
              e instanceof Error
                ? e.message
                : "Не удалось загрузить подключения",
            );
            setLoading(false);
          }
        },
      );
    return () => {
      active = false;
    };
  }, [
    id,
    isL1,
    cable,
    props.physicalObjectDetailsDataSource,
    props.catalogInventoryDataSource,
    readRevision,
  ]);
  if (!selection) return null;
  const shell = (children: React.ReactNode) => (
    <aside className="quick-inspector" aria-label="Быстрый инспектор">
      <button
        className="quick-inspector__close"
        onClick={onClose}
        aria-label="Закрыть инспектор"
      >
        ×
      </button>
      {children}
    </aside>
  );
  const technical = (
    <details className="quick-inspector__technical">
      <summary>Технические детали</summary>
      <dl>
        {node && (
          <>
            {id && (
              <div>
                <dt>PhysicalObject</dt>
                <dd>{id}</dd>
              </div>
            )}
            <div>
              <dt>Projection ID</dt>
              <dd>{node.id}</dd>
            </div>
            <div>
              <dt>Kind</dt>
              <dd>{node.kind}</dd>
            </div>
          </>
        )}
      </dl>
    </details>
  );
  const operationFor = (kind: "remove" | "add" | "delete", objectId: string) =>
    props.mapOperation?.kind === kind && props.mapOperation.id === objectId
      ? props.mapOperation
      : null;
  const activeOperationFor = (objectId: string) =>
    props.mapOperation?.id === objectId ? props.mapOperation : null;
  const remove = async () => {
    if (!id || !props.onRemoveFromMap || pending || operationFor("remove", id))
      return;
    setPending("remove");
    setRemoveError(null);
    try {
      await props.onRemoveFromMap(id);
    } catch (e) {
      setRemoveError(
        e instanceof Error ? e.message : "Не удалось убрать с карты",
      );
    } finally {
      setPending(null);
    }
  };
  const destroy = async () => {
    if (
      !id ||
      !props.onDeletePhysicalObject ||
      pending ||
      activeOperationFor(id)
    )
      return;
    const message = cable
      ? `Удалить кабель «${displayNodeLabel(node!)}» и разорвать соединение?`
      : `Удалить объект «${displayNodeLabel(node!)}»?`;
    if (!window.confirm(message)) return;
    setPending("delete");
    setDeleteError(null);
    try {
      await props.onDeletePhysicalObject(id);
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : "Не удалось удалить объект",
      );
    } finally {
      setPending(null);
    }
  };
  const togglePlacementLock = async () => {
    if (!props.onSetPlacementLock || lockPending) return;
    setLockPending(true);
    setLockError(null);
    try {
      await props.onSetPlacementLock(!props.placementLocked);
    } catch (reason) {
      setLockError(
        reason instanceof Error ? reason.message : "Не удалось изменить фиксацию положения",
      );
    } finally {
      setLockPending(false);
    }
  };
  const placementLockAction = props.onSetPlacementLock ? (
    <>
      <button disabled={lockPending} onClick={() => void togglePlacementLock()}>
        {props.placementLocked ? "Разблокировать положение" : "Зафиксировать положение"}
      </button>
      {lockError && <p role="alert">{lockError}</p>}
    </>
  ) : null;
  if (selection.type === "continuation") {
    const c = selection.item;
    const remote = c.remote_physical_object_ref.entity_id;
    const local = document?.nodes.find((item) => item.id === c.local_node_id);
    const add = async () => {
      if (!props.onAddContinuationToMap || activeOperationFor(remote)) return;
      setContinuationError(null);
      try {
        await props.onAddContinuationToMap(remote);
      } catch (reason) {
        setContinuationError(
          reason instanceof Error
            ? reason.message
            : "Не удалось добавить на карту",
        );
      }
    };
    return shell(
      <>
        <span className="eyebrow">ВНЕ КАРТЫ</span>
        <h2>{c.remote_display_name}</h2>
        <p>Подключено:</p>
        <p>
          {local ? `${displayNodeLabel(local)} / ` : ""}
          {c.local_connection_point_display_name}
          <br />→ {c.cable_display_name}
          <br />→ {c.remote_display_name} /{" "}
          {c.remote_connection_point_display_name}
        </p>
        {props.onAddContinuationToMap && (
          <button
            disabled={Boolean(activeOperationFor(remote))}
            onClick={() => void add()}
          >
            Добавить на карту
          </button>
        )}
        {operationFor("add", remote)?.status === "refresh-failed" && (
          <>
            <p role="alert">{operationFor("add", remote)?.message}</p>
            <button onClick={() => void props.onRetryMapRefresh?.()}>
              Повторить обновление
            </button>
          </>
        )}
        {continuationError && <p role="alert">{continuationError}</p>}
        <Link to={url(remote)}>Открыть объект</Link>
        <details className="quick-inspector__technical">
          <summary>Технические детали</summary>
          <dl>
            <div>
              <dt>Continuation</dt>
              <dd>{c.id}</dd>
            </div>
            <div>
              <dt>Local PhysicalObject</dt>
              <dd>{c.local_physical_object_ref.entity_id}</dd>
            </div>
            <div>
              <dt>Local ConnectionPoint</dt>
              <dd>{c.local_connection_point_ref.entity_id}</dd>
            </div>
            <div>
              <dt>Cable</dt>
              <dd>{c.cable_ref.entity_id}</dd>
            </div>
            <div>
              <dt>Remote PhysicalObject</dt>
              <dd>{c.remote_physical_object_ref.entity_id}</dd>
            </div>
            <div>
              <dt>Remote ConnectionPoint</dt>
              <dd>{c.remote_connection_point_ref.entity_id}</dd>
            </div>
          </dl>
        </details>
      </>,
    );
  }
  if (node && isL1 && cable && id) {
    const item = inventory?.cables.find((x) => x.cable_ref.entity_id === id);
    return shell(
      <>
        <span className="eyebrow">КАБЕЛЬ</span>
        <h2>{displayNodeLabel(node)}</h2>
        {!inventory && !inventoryError && (
          <p>Загружаем проверенные концы кабеля…</p>
        )}
        {inventoryError && <p role="alert">{inventoryError}</p>}
        {inventoryError && (
          <button onClick={() => setReadRevision((revision) => revision + 1)}>
            Повторить
          </button>
        )}
        {item?.resolution === "SIMPLE_CABLE" &&
          item.endpoint_a &&
          item.endpoint_b && (
            <p>
              <Link
                to={url(item.endpoint_a.remote_physical_object_ref.entity_id)}
              >
                {item.endpoint_a.remote_physical_object_label} /{" "}
                {item.endpoint_a.remote_connection_point_label}
              </Link>
              <br />↕<br />
              <Link
                to={url(item.endpoint_b.remote_physical_object_ref.entity_id)}
              >
                {item.endpoint_b.remote_physical_object_label} /{" "}
                {item.endpoint_b.remote_connection_point_label}
              </Link>
            </p>
          )}
        {item?.resolution === "UNRESOLVED" && (
          <p>Концы кабеля не удалось однозначно определить.</p>
        )}
        {item &&
          [...item.warnings, ...item.gaps].map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        {inventory && !item && <p>Проверенные данные кабеля недоступны.</p>}
        <Link to={url(id)}>Открыть объект</Link>
        {placementLockAction}
        {props.onRemoveFromMap && (
          <button
            disabled={pending !== null || Boolean(activeOperationFor(id))}
            onClick={() => void remove()}
          >
            Убрать с карты
          </button>
        )}
        <details>
          <summary>Дополнительные действия</summary>
          {props.onDeletePhysicalObject && (
            <button
              disabled={Boolean(activeOperationFor(id))}
              onClick={() => void destroy()}
            >
              Удалить кабель и разорвать физическое соединение
            </button>
          )}
        </details>
        {removeError && <p role="alert">{removeError}</p>}
        {operationFor("remove", id)?.status === "refresh-failed" && (
          <>
            <p role="alert">{operationFor("remove", id)?.message}</p>
            <button onClick={() => void props.onRetryMapRefresh?.()}>
              Повторить обновление
            </button>
          </>
        )}
        {deleteError && <p role="alert">{deleteError}</p>}
        {operationFor("delete", id)?.status === "refresh-failed" && (
          <>
            <p role="alert">{operationFor("delete", id)?.message}</p>
            <button onClick={() => void props.onRetryMapRefresh?.()}>
              Повторить обновление
            </button>
          </>
        )}
        {technical}
      </>,
    );
  }
  if (node && isL1 && id) {
    const attached = details ? connections(details) : [];
    return shell(
      <>
        <span className="eyebrow">
          {
            physicalClassPresentation(
              details?.physical_object.class ?? node.attributes.class,
            ).label
          }
        </span>
        <h2>{details?.physical_object.label ?? displayNodeLabel(node)}</h2>
        {loading && <p>Загружаем физические подключения…</p>}
        {detailError && <p role="alert">{detailError}</p>}
        {detailError && (
          <button onClick={() => setReadRevision((revision) => revision + 1)}>
            Повторить
          </button>
        )}
        {details && (
          <>
            <p>
              {details.connection_points.length === 0
                ? "Портов нет"
                : authoritative(details)
                  ? `${details.connection_points.length} портов · ${attached.length} подключено · ${details.connection_points.length - attached.length} свободно`
                  : `${details.connection_points.length} порта · Занятость не определена`}
            </p>
            {details.owned_interface_count > 0 && (
              <p>Сетевых интерфейсов: {details.owned_interface_count}</p>
            )}
            {attached.length === 0 ? (
              <p>Физических подключений нет.</p>
            ) : (
              <div>
                {attached.slice(0, 6).map((p: ConnectionPointDetails) => (
                  <div key={p.connection_point_ref.entity_id}>
                    <strong>{p.label}</strong>
                    {p.external_physical_attachments!.map((a, i) => (
                      <p key={i}>
                        →{" "}
                        {a.kind === "UNRESOLVED"
                          ? "Физическая связь не разрешена"
                          : `${a.remote_physical_object_label ?? "Удалённый объект"} / ${a.remote_connection_point_label ?? "порт"}${a.kind === "SIMPLE_CABLE" ? ` через ${a.cable_label ?? "кабель"}` : ""}`}
                      </p>
                    ))}
                  </div>
                ))}
                {attached.length > 6 && (
                  <p>Ещё {attached.length - 6} подключений</p>
                )}
              </div>
            )}
            {[...details.warnings, ...details.gaps].map((notice) => (
              <p key={notice}>{notice}</p>
            ))}
          </>
        )}
        <Link to={url(id)}>Открыть объект</Link>
        {placementLockAction}
        {props.onRemoveFromMap && (
          <button
            disabled={pending !== null || Boolean(activeOperationFor(id))}
            onClick={() => void remove()}
          >
            Убрать с карты
          </button>
        )}
        <details>
          <summary>Дополнительные действия</summary>
          {props.onDeletePhysicalObject && (
            <button
              disabled={Boolean(activeOperationFor(id))}
              onClick={() => void destroy()}
            >
              Удалить объект из NetMap
            </button>
          )}
        </details>
        {removeError && <p role="alert">{removeError}</p>}
        {deleteError && <p role="alert">{deleteError}</p>}
        {operationFor("remove", id)?.status === "refresh-failed" && (
          <>
            <p role="alert">{operationFor("remove", id)?.message}</p>
            <button onClick={() => void props.onRetryMapRefresh?.()}>
              Повторить обновление
            </button>
          </>
        )}
        {operationFor("delete", id)?.status === "refresh-failed" && (
          <>
            <p role="alert">{operationFor("delete", id)?.message}</p>
            <button onClick={() => void props.onRetryMapRefresh?.()}>
              Повторить обновление
            </button>
          </>
        )}
        {technical}
      </>,
    );
  }
  if (node)
    return shell(
      <>
        <span className="eyebrow">СЕТЕВОЙ ОБЪЕКТ</span>
        <h2>{displayNodeLabel(node)}</h2>
        {id ? (
          <Link to={url(id)}>Открыть объект</Link>
        ) : (
          <p>У объекта нет однозначной canonical-ссылки.</p>
        )}
        {placementLockAction}
        {technical}
      </>,
    );
  const edge = selection.item as TopologyProjectionEdge;
  const source = document?.nodes.find((n) => n.id === edge.from_node_id);
  const target = document?.nodes.find((n) => n.id === edge.to_node_id);
  const pairs = endpointLabels(edge, source, target).slice(0, 6);
  return shell(
    <>
      <span className="eyebrow">Связь</span>
      <h2>
        {source ? displayNodeLabel(source) : "Неизвестный объект"} ↔{" "}
        {target ? displayNodeLabel(target) : "Неизвестный объект"}
      </h2>
      <div>
        {source && (
          <button onClick={() => onSelectNode(source)}>
            {displayNodeLabel(source)}
          </button>
        )}
        {target && (
          <button onClick={() => onSelectNode(target)}>
            {displayNodeLabel(target)}
          </button>
        )}
      </div>
      {pairs.map((pair) => (
        <p key={pair}>{pair}</p>
      ))}
      <details className="quick-inspector__technical">
        <summary>Технические детали</summary>
        <dl>
          <div>
            <dt>Projection ID</dt>
            <dd>{edge.id}</dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd>{edge.kind}</dd>
          </div>
          {edge.source_refs.map((ref) => (
            <div key={`${ref.entity_type}/${ref.entity_id}`}>
              <dt>Source ref</dt>
              <dd>
                {ref.entity_type}: {ref.entity_id}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </>,
  );
}
