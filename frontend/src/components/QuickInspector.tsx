import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  displayNodeLabel,
  physicalClassPresentation,
} from "../topology/presentation";
import { cableIdForNode, physicalObjectIdForNode } from "../topology/projection";
import { useI18n } from "../i18n";
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
  onDeleteCable?: (id: string) => Promise<void>;
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
  cableRoutePresentation?: { present: boolean; waypointCount: number; editing: boolean; selectedWaypointIndex: number | null; savePending: boolean; refreshFailed: boolean; error: string | null; resetPending: boolean; resetRefreshFailed: boolean };
  onEditCableRoute?: () => void;
  onCancelCableRouteEdit?: () => void;
  onDeleteCableRouteWaypoint?: () => void;
  onSaveCableRoute?: () => void;
  onRetryCableRouteRefresh?: () => void;
  onResetCableRoute?: () => void;
  onRetryCableRouteReset?: () => void;
  blueprintSize?: { displayWidth: number; copiedDisplayWidth?: number };
  onApplyBlueprintSize?: (displayWidth: number) => Promise<void>;
  onCopyBlueprintSize?: () => void;
  onApplyCopiedBlueprintSize?: () => Promise<void>;
  onApplyBlueprintSizeToSameBlueprint?: () => Promise<void>;
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
  const { t } = useI18n();
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
  const [sizeDraft, setSizeDraft] = useState("");
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [sizePending, setSizePending] = useState(false);
  const node = selection?.type === "node" ? selection.item : null;
  const id = node && physicalObjectIdForNode(node);
  const cableId = node && cableIdForNode(node);
  const isL1 = document?.layer === "L1";
  const cable = Boolean(cableId);
  useEffect(() => {
    let active = true;
    setDetails(null);
    setDetailError(null);
    setLoading(false);
    setInventory(null);
    setInventoryError(null);
    if (!node || (!id && !cableId) || !isL1)
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
              e instanceof Error ? e.message : t("catalog.error.title"),
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
      .loadPhysicalObjectDetails(id!)
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
                : t("view.error.title"),
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
    cableId,
    isL1,
    cable,
    props.physicalObjectDetailsDataSource,
    props.catalogInventoryDataSource,
    readRevision,
  ]);
  useEffect(() => {
    setSizeDraft(props.blueprintSize ? String(props.blueprintSize.displayWidth) : "");
    setSizeError(null);
  }, [props.blueprintSize?.displayWidth]);
  if (!selection) return null;
  const shell = (children: React.ReactNode) => (
    <aside className="quick-inspector" aria-label={t("inspector.label")}>
      <button
        className="quick-inspector__close"
        onClick={onClose}
        aria-label={t("inspector.close")}
      >
        ×
      </button>
      {children}
    </aside>
  );
  const technical = (
    <details className="quick-inspector__technical">
      <summary>{t("inspector.technical")}</summary>
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
        e instanceof Error ? e.message : t("inspector.remove"),
      );
    } finally {
      setPending(null);
    }
  };
  const destroy = async () => {
    const targetId = cableId ?? id;
    const deleteTarget = cable ? props.onDeleteCable : props.onDeletePhysicalObject;
    if (
      !targetId ||
      !deleteTarget ||
      pending ||
      activeOperationFor(targetId)
    )
      return;
    const message = cable
      ? `Удалить кабель «${displayNodeLabel(node!)}» и разорвать соединение?`
      : `Удалить объект «${displayNodeLabel(node!)}»?`;
    if (!window.confirm(message)) return;
    setPending("delete");
    setDeleteError(null);
    try {
      await deleteTarget(targetId);
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : t("map.delete"),
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
        reason instanceof Error ? reason.message : t("view.error.title"),
      );
    } finally {
      setLockPending(false);
    }
  };
  const placementLockAction = props.onSetPlacementLock ? (
    <>
      <button disabled={lockPending} onClick={() => void togglePlacementLock()}>
        {props.placementLocked ? t("inspector.unlock") : t("inspector.lock")}
      </button>
      {lockError && <p role="alert">{lockError}</p>}
    </>
  ) : null;
  const blueprintSizeAction = props.blueprintSize ? (
    <section className="quick-inspector__blueprint-size">
      <h3>{t("inspector.size")}</h3>
      <label>{t("inspector.width")}
        <input type="number" min="0" step="1" value={sizeDraft} onChange={(event) => setSizeDraft(event.target.value)} />
      </label>
      <button disabled={sizePending || !Number.isFinite(Number(sizeDraft)) || Number(sizeDraft) <= 0} onClick={() => void (async () => {
        if (!props.onApplyBlueprintSize) return;
        setSizePending(true); setSizeError(null);
        try { await props.onApplyBlueprintSize(Number(sizeDraft)); }
        catch (reason) { setSizeError(reason instanceof Error ? reason.message : t("view.error.title")); }
        finally { setSizePending(false); }
      })()}>{t("inspector.applySize")}</button>
      <button disabled={sizePending} onClick={props.onCopyBlueprintSize}>{t("inspector.copySize")}</button>
      <button disabled={sizePending || props.blueprintSize.copiedDisplayWidth === undefined} onClick={() => void (async () => {
        if (!props.onApplyCopiedBlueprintSize) return;
        setSizePending(true); setSizeError(null);
        try { await props.onApplyCopiedBlueprintSize(); }
        catch (reason) { setSizeError(reason instanceof Error ? reason.message : t("view.error.title")); }
        finally { setSizePending(false); }
      })()}>{t("inspector.applyCopiedSize")}</button>
      <button disabled={sizePending} onClick={() => void (async () => {
        if (!props.onApplyBlueprintSizeToSameBlueprint) return;
        setSizePending(true); setSizeError(null);
        try { await props.onApplyBlueprintSizeToSameBlueprint(); }
        catch (reason) { setSizeError(reason instanceof Error ? reason.message : t("view.error.title")); }
        finally { setSizePending(false); }
      })()}>{t("inspector.applySizeToSameBlueprint")}</button>
      {sizeError && <p role="alert">{sizeError}</p>}
    </section>
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
            : t("map.add"),
        );
      }
    };
    return shell(
      <>
        <span className="eyebrow">{t("inspector.offMap")}</span>
        <h2>{c.remote_display_name}</h2>
        <p>{t("inspector.connected")}</p>
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
            {t("map.add")}
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
        <Link to={url(remote)}>{t("inspector.open")}</Link>
        <details className="quick-inspector__technical">
          <summary>{t("inspector.technical")}</summary>
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
  if (node && isL1 && cable && cableId) {
    const item = inventory?.cables.find((x) => x.cable_ref.entity_id === cableId);
    return shell(
      <>
        <span className="eyebrow">{t("inspector.cable")}</span>
        <h2>{displayNodeLabel(node)}</h2>
        {!inventory && !inventoryError && (
          <p>{t("inspector.loadingCable")}</p>
        )}
        {inventoryError && <p role="alert">{inventoryError}</p>}
        {inventoryError && (
          <button onClick={() => setReadRevision((revision) => revision + 1)}>
            Повторить
          </button>
        )}
        {item?.resolution === "RESOLVED" && (
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
        {item &&
          [...item.warnings, ...item.gaps].map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        {inventory && !item && <p>{t("inspector.cableUnavailable")}</p>}
        {props.cableRoutePresentation && (
          <section className="quick-inspector__cable-route">
            <h3>{t("inspector.route")}</h3>
            {props.cableRoutePresentation.present ? <p>{t("inspector.routePoints", { count: props.cableRoutePresentation.waypointCount })}</p> : <p>{t("inspector.noRoute")}</p>}
            {!props.cableRoutePresentation.editing ? <>
              <button onClick={props.onEditCableRoute}>{t("inspector.editRoute")}</button>
              {props.cableRoutePresentation.present && <button disabled={props.cableRoutePresentation.resetPending} onClick={props.onResetCableRoute}>{t("inspector.resetRoute")}</button>}
              {props.cableRoutePresentation.resetRefreshFailed && <><p role="alert">{t("inspector.routeResetFailed")}</p><button onClick={props.onRetryCableRouteReset}>{t("map.retryRefresh")}</button></>}
            </> : <>
              <p>{t("inspector.routeEditHelp")}</p>
              <button disabled={props.cableRoutePresentation.selectedWaypointIndex === null} onClick={props.onDeleteCableRouteWaypoint}>{t("inspector.deleteSelectedPoint")}</button>
              {props.cableRoutePresentation.refreshFailed ? <button onClick={props.onRetryCableRouteRefresh}>{t("map.retryRefresh")}</button> : <button disabled={props.cableRoutePresentation.savePending} onClick={props.onSaveCableRoute}>{t("inspector.saveRoute")}</button>}
              <button disabled={props.cableRoutePresentation.savePending} onClick={props.onCancelCableRouteEdit}>{t("action.cancel")}</button>
              {props.cableRoutePresentation.error && <p role="alert">{props.cableRoutePresentation.error}</p>}
            </>}
          </section>
        )}
        <details>
          <summary>{t("inspector.actions")}</summary>
          {props.onDeleteCable && (
            <button
              disabled={Boolean(activeOperationFor(cableId))}
              onClick={() => void destroy()}
            >
              Удалить кабель и разорвать физическое соединение
            </button>
          )}
        </details>
        {deleteError && <p role="alert">{deleteError}</p>}
        {operationFor("delete", cableId)?.status === "refresh-failed" && (
          <>
            <p role="alert">{operationFor("delete", cableId)?.message}</p>
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
        {loading && <p>{t("inspector.loadingConnections")}</p>}
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
                ? t("inspector.noPorts")
                : authoritative(details)
                  ? t("inspector.portSummary", { ports: details.connection_points.length, attached: attached.length, free: details.connection_points.length - attached.length })
                  : t("inspector.portOccupancyUnknown", { ports: details.connection_points.length })}
            </p>
            {details.owned_interface_count > 0 && (
              <p>{t("inspector.interfaces", { count: details.owned_interface_count })}</p>
            )}
            {attached.length === 0 ? (
              <p>{t("inspector.noConnections")}</p>
            ) : (
              <div>
                {attached.slice(0, 6).map((p: ConnectionPointDetails) => (
                  <div key={p.connection_point_ref.entity_id}>
                    <strong>{p.label}</strong>
                    {p.external_physical_attachments!.map((a, i) => (
                      <p key={i}>
                        →{" "}
                        {`${a.remote_physical_object_label ?? t("inspector.remoteObject")} / ${a.remote_connection_point_label ?? t("inspector.port")}${a.kind === "CABLE" ? t("inspector.viaCable", { cable: a.cable_label ?? "cable" }) : ""}`}
                      </p>
                    ))}
                  </div>
                ))}
                {attached.length > 6 && (
                  <p>{t("inspector.moreConnections", { count: attached.length - 6 })}</p>
                )}
              </div>
            )}
            {[...details.warnings, ...details.gaps].map((notice) => (
              <p key={notice}>{notice}</p>
            ))}
          </>
        )}
        <Link to={url(id)}>{t("inspector.open")}</Link>
        {blueprintSizeAction}
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
          <summary>{t("inspector.actions")}</summary>
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
        <span className="eyebrow">{t("inspector.networkObject")}</span>
        <h2>{displayNodeLabel(node)}</h2>
        {id ? (
          <Link to={url(id)}>{t("inspector.open")}</Link>
        ) : (
          <p>{t("inspector.noCanonicalRef")}</p>
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
      <span className="eyebrow">{t("inspector.connection")}</span>
      <h2>
        {source ? displayNodeLabel(source) : t("inspector.unknownObject")} ↔{" "}
        {target ? displayNodeLabel(target) : t("inspector.unknownObject")}
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
        <summary>{t("inspector.technical")}</summary>
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
