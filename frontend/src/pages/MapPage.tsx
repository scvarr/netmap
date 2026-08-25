import { ReactFlowProvider, type XYPosition } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  MapInsertionPicker,
  mapCandidateChoices,
} from "../components/MapInsertionPicker";
import { QuickInspector } from "../components/QuickInspector";
import { TraceCommandBar } from "../components/TraceCommandBar";
import { TopologyCanvas } from "../components/TopologyCanvas";
import { ViewState } from "../components/ViewState";
import { physicalTraceOverlayFor } from "../topology/interfacePhysicalTraceOverlay";
import type {
  CatalogInventoryDataSource,
  CatalogInventoryDocument,
} from "../topology/catalogInventoryTypes";
import type { DeviceDetailsDataSource } from "../topology/deviceDetailsTypes";
import type {
  PhysicalObjectL1TraceArtifact,
  PhysicalObjectL1TraceDataSource,
} from "../topology/physicalObjectL1TraceTypes";
import type { TopologyLayoutStore } from "../topology/layoutStore";
import type { PhysicalObjectDeleteDataSource } from "../topology/physicalObjectDeleteTypes";
import type { PhysicalObjectDetailsDataSource } from "../topology/physicalObjectDetailsTypes";
import {
  nodeForPhysicalObject,
  physicalObjectIdForNode,
  physicalObjectIdForSelection,
  projectionRequestFor,
  type TopologyViewMode,
} from "../topology/projection";
import type {
  SavedMap,
  SavedMapDataSource,
  SavedMapSummary,
  SavedMapView,
  SavedMapViewKey,
} from "../topology/savedMapTypes";
import type {
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologySelection,
} from "../topology/types";

export { mapCandidateChoices } from "../components/MapInsertionPicker";

interface MapPageProps {
  dataSource: TopologyDataSource;
  /** Retained for callers that share App wiring; L1 object trace does not use it. */
  deviceDetailsDataSource?: DeviceDetailsDataSource;
  savedMapDataSource?: SavedMapDataSource;
  catalogInventoryDataSource?: CatalogInventoryDataSource;
  physicalObjectDeleteDataSource?: PhysicalObjectDeleteDataSource;
  physicalObjectDetailsDataSource?: PhysicalObjectDetailsDataSource;
  traceDataSource?: PhysicalObjectL1TraceDataSource;
  topologyLayoutStore?: TopologyLayoutStore;
}

interface SceneDocument {
  sceneKey: string;
  document: TopologyProjectionDocument;
}
interface InsertionState {
  mapId: string;
  anchor: XYPosition;
  inventory: CatalogInventoryDocument | null;
  status: "loading" | "ready" | "saving" | "saved-refresh-failed";
  error: string | null;
  requestedObjectId?: string;
}
interface ContextMenuState {
  anchor: XYPosition;
  screen: XYPosition;
}
interface MapOperation {
  kind: "remove" | "add" | "delete";
  id: string;
  mapId: string;
  status: "pending" | "refresh-failed";
  message?: string;
}

const view = (value: string | null): TopologyViewMode =>
  value === "physical" ? "physical" : "logical";
const savedMapViewKey = (value: SavedMapView): SavedMapViewKey =>
  value === "physical" ? "L1/PHYSICAL_OBJECT" : "L2/DEVICE";
const natural = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
const errorMessage = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : fallback;
const emptyPhysicalDocument: TopologyProjectionDocument = {
  schema_version: "1.0",
  layer: "L1",
  detail_level: "PHYSICAL_OBJECT",
  nodes: [],
  edges: [],
  gaps: [],
  warnings: [],
};

export function MapPage({
  dataSource,
  savedMapDataSource,
  catalogInventoryDataSource,
  physicalObjectDeleteDataSource,
  physicalObjectDetailsDataSource,
  traceDataSource,
}: MapPageProps) {
  const [params, setParams] = useSearchParams();
  const mapId = params.get("map");
  const addIntent = mapId ? params.get("add") : null;
  const viewMode = view(params.get("view"));
  const [maps, setMaps] = useState<SavedMapSummary[] | null>(null);
  const [map, setMap] = useState<SavedMap | null>(null);
  const [sceneDocument, setSceneDocument] = useState<SceneDocument | null>(
    null,
  );
  const [logicalDocument, setLogicalDocument] =
    useState<TopologyProjectionDocument | null>(null);
  const [traceArtifact, setTraceArtifact] =
    useState<PhysicalObjectL1TraceArtifact | null>(null);
  const [selectedTraceBranchId, setSelectedTraceBranchId] = useState<string | null>(null);
  const [traceViewNotice, setTraceViewNotice] = useState<string | null>(null);
  const [selection, setSelection] = useState<TopologySelection>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [insertion, setInsertion] = useState<InsertionState | null>(null);
  const [contextAnchor, setContextAnchor] = useState<ContextMenuState | null>(
    null,
  );
  const [pendingPhysicalToolbarInsertion, setPendingPhysicalToolbarInsertion] =
    useState<{ mapId: string } | null>(null);
  const [continuationAnchor, setContinuationAnchor] = useState<{
    continuationId: string;
    mapId: string;
    anchor: XYPosition;
  } | null>(null);
  const [mapOperation, setMapOperation] = useState<MapOperation | null>(null);
  const [authoritativePositionRevision, setAuthoritativePositionRevision] =
    useState(0);
  const [coordinateBridgeRevision, setCoordinateBridgeRevision] = useState(0);
  const selectedMapId = useRef<string | null>(mapId);
  const insertionSequence = useRef(0);
  const viewportCenter = useRef<(() => XYPosition) | null>(null);
  const consumedAddIntent = useRef<string | null>(null);

  selectedMapId.current = mapId;
  const legacy = !savedMapDataSource;
  const presentationSceneKey =
    !legacy && mapId ? `${mapId}/${viewMode}` : `legacy/${viewMode}`;
  const activeMap = !legacy && map?.map_ref.entity_id === mapId ? map : null;
  const document =
    sceneDocument?.sceneKey === presentationSceneKey
      ? sceneDocument.document
      : null;
  const ids =
    activeMap?.placements.map((item) => item.physical_object_ref.entity_id) ??
    [];
  const placementMembershipKey = ids.join(",");
  const hasLoadedMap = legacy || Boolean(activeMap);

  const selectMap = useCallback(
    (id: string) => {
      setSelection(null);
      setSceneDocument(null);
      setInsertion(null);
      setContextAnchor(null);
      setPendingPhysicalToolbarInsertion(null);
      setContinuationAnchor(null);
      setMapOperation(null);
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("map", id);
        next.set("view", next.get("view") ?? "physical");
        next.delete("focus");
        return next;
      });
    },
    [setParams],
  );

  const reloadMap = useCallback(
    async (targetMapId = mapId): Promise<boolean> => {
      if (!savedMapDataSource || !targetMapId) return false;
      const detail = await savedMapDataSource.loadMap(targetMapId);
      if (selectedMapId.current !== targetMapId) return false;
      setMap(detail);
      return true;
    },
    [mapId, savedMapDataSource],
  );

  useEffect(() => {
    if (!savedMapDataSource) return undefined;
    let active = true;
    void savedMapDataSource.listMaps().then(
      (items) => {
        if (!active) return;
        const sorted = [...items].sort((left, right) =>
          natural(left.name, right.name),
        );
        setMaps(sorted);
        if (!mapId && sorted[0]) selectMap(sorted[0].map_ref.entity_id);
      },
      (reason) =>
        active && setError(errorMessage(reason, "Не удалось загрузить карты")),
    );
    return () => {
      active = false;
    };
  }, [mapId, savedMapDataSource, selectMap]);

  useEffect(() => {
    if (!savedMapDataSource || !mapId) {
      setMap(null);
      setSceneDocument(null);
      return undefined;
    }
    if (maps && !maps.some((item) => item.map_ref.entity_id === mapId)) {
      setMap(null);
      setSceneDocument(null);
      setSelection(null);
      setError("Выбранная карта не найдена.");
      return undefined;
    }
    let active = true;
    setError(null);
    void savedMapDataSource.loadMap(mapId).then(
      (detail) => active && setMap(detail),
      (reason) =>
        active && setError(errorMessage(reason, "Не удалось загрузить карту")),
    );
    return () => {
      active = false;
    };
  }, [mapId, maps, savedMapDataSource]);

  useEffect(() => {
    if (savedMapDataSource && !hasLoadedMap) {
      setSceneDocument(null);
      return undefined;
    }
    if (savedMapDataSource && ids.length === 0) {
      setSceneDocument(
        viewMode === "physical"
          ? { sceneKey: presentationSceneKey, document: emptyPhysicalDocument }
          : null,
      );
      return undefined;
    }
    let active = true;
    void dataSource
      .loadProjection(
        projectionRequestFor(
          viewMode,
          savedMapDataSource ? ids : undefined,
          Boolean(savedMapDataSource && viewMode === "physical"),
        ),
      )
      .then(
        (next) =>
          active &&
          setSceneDocument({ sceneKey: presentationSceneKey, document: next }),
        (reason) =>
          active &&
          setError(errorMessage(reason, "Не удалось загрузить projection")),
      );
    return () => {
      active = false;
    };
  }, [
    dataSource,
    hasLoadedMap,
    placementMembershipKey,
    presentationSceneKey,
    savedMapDataSource,
    viewMode,
  ]);

  useEffect(() => {
    if (
      savedMapDataSource
        ? !hasLoadedMap || ids.length === 0
        : viewMode === "logical"
    )
      return;
    let active = true;
    void dataSource.loadProjection(projectionRequestFor("logical")).then(
      (next) => active && setLogicalDocument(next),
      () => active && setLogicalDocument(null),
    );
    return () => {
      active = false;
    };
  }, [
    dataSource,
    hasLoadedMap,
    ids.length,
    mapId,
    savedMapDataSource,
    viewMode,
  ]);

  useEffect(() => {
    const focus = params.get("focus");
    if (!document || !focus) return;
    const node = nodeForPhysicalObject(document.nodes, focus);
    setSelection(node ? { type: "node", item: node } : null);
  }, [document, params]);

  useEffect(() => {
    if (!document) return;
    setSelection((current) => {
      if (!current) return null;
      if (current.type === "edge")
        return document.edges.some((edge) => edge.id === current.item.id)
          ? current
          : null;
      if (current.type === "continuation")
        return document.l1_off_map_continuations?.some(
          (item) => item.id === current.item.id,
        )
          ? current
          : null;
      const id = physicalObjectIdForSelection(current);
      const node = id ? nodeForPhysicalObject(document.nodes, id) : null;
      return node ? { type: "node", item: node } : null;
    });
  }, [document]);

  const create = async () => {
    if (!savedMapDataSource || !name.trim()) return;
    try {
      const created = await savedMapDataSource.createMap(name.trim());
      setMaps(
        [...(await savedMapDataSource.listMaps())].sort((left, right) =>
          natural(left.name, right.name),
        ),
      );
      setName("");
      setCreating(false);
      selectMap(created.map_ref.entity_id);
    } catch (reason) {
      setError(errorMessage(reason, "Не удалось создать карту"));
    }
  };

  const openInsertion = useCallback(
    (anchor: XYPosition, requestedObjectId?: string) => {
      if (!catalogInventoryDataSource || !mapId || !activeMap) return;
      const request = ++insertionSequence.current;
      setContextAnchor(null);
      setInsertion({
        mapId,
        anchor,
        inventory: null,
        status: "loading",
        error: null,
        ...(requestedObjectId ? { requestedObjectId } : {}),
      });
      void catalogInventoryDataSource.loadCatalogInventory().then(
        (inventory) => {
          if (
            request !== insertionSequence.current ||
            selectedMapId.current !== mapId
          )
            return;
          setInsertion((current) =>
            current?.mapId === mapId
              ? { ...current, inventory, status: "ready" }
              : current,
          );
        },
        (reason) => {
          if (
            request !== insertionSequence.current ||
            selectedMapId.current !== mapId
          )
            return;
          setInsertion((current) =>
            current?.mapId === mapId
              ? {
                  ...current,
                  status: "ready",
                  error: errorMessage(
                    reason,
                    "Не удалось загрузить оборудование",
                  ),
                }
              : current,
          );
        },
      );
    },
    [activeMap, catalogInventoryDataSource, mapId],
  );

  useEffect(() => {
    if (!pendingPhysicalToolbarInsertion) return;
    if (pendingPhysicalToolbarInsertion.mapId !== mapId) {
      setPendingPhysicalToolbarInsertion(null);
      return;
    }
    if (
      viewMode !== "physical" ||
      !activeMap ||
      !document ||
      !viewportCenter.current
    )
      return;
    setPendingPhysicalToolbarInsertion(null);
    openInsertion(viewportCenter.current());
  }, [
    activeMap,
    coordinateBridgeRevision,
    document,
    mapId,
    openInsertion,
    pendingPhysicalToolbarInsertion,
    viewMode,
  ]);

  useEffect(() => {
    if (!mapId || !addIntent) return;
    const intentKey = `${mapId}/${addIntent}`;
    if (consumedAddIntent.current === intentKey) return;
    if (viewMode !== "physical") {
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("view", "physical");
        return next;
      }, { replace: true });
      return;
    }
    if (!activeMap || !document || !viewportCenter.current) return;
    consumedAddIntent.current = intentKey;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("add");
      if (ids.includes(addIntent)) next.set("focus", addIntent);
      return next;
    }, { replace: true });
    if (!ids.includes(addIntent)) openInsertion(viewportCenter.current(), addIntent);
  }, [activeMap, addIntent, coordinateBridgeRevision, document, ids, mapId, openInsertion, setParams, viewMode]);

  const startToolbarInsertion = () => {
    if (!mapId || !activeMap) return;
    setPendingPhysicalToolbarInsertion({ mapId });
    if (viewMode === "logical") {
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("view", "physical");
        return next;
      });
    }
  };

  const setViewMode = (nextView: TopologyViewMode) => {
    if (nextView !== "physical") setPendingPhysicalToolbarInsertion(null);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", nextView);
      return next;
    });
  };

  const submitInsertion = async (id: string, operation = insertion) => {
    if (!savedMapDataSource || !operation || operation.status !== "ready")
      return;
    const request = ++insertionSequence.current;
    const targetMapId = operation.mapId;
    setInsertion((current) =>
      current?.mapId === targetMapId
        ? { ...current, status: "saving", error: null }
        : current,
    );
    try {
      await savedMapDataSource.addPlacement(
        targetMapId,
        id,
        operation.anchor.x,
        operation.anchor.y,
      );
    } catch (reason) {
      if (
        request !== insertionSequence.current ||
        selectedMapId.current !== targetMapId
      )
        return;
      setInsertion((current) =>
        current?.mapId === targetMapId
          ? {
              ...current,
              status: "ready",
              error: errorMessage(reason, "Не удалось добавить на карту"),
            }
          : current,
      );
      return;
    }
    try {
      const refreshed = await reloadMap(targetMapId);
      if (
        request !== insertionSequence.current ||
        selectedMapId.current !== targetMapId
      )
        return;
      if (refreshed) setInsertion(null);
      else
        setInsertion((current) =>
          current?.mapId === targetMapId
            ? {
                ...current,
                status: "saved-refresh-failed",
                error: "Размещение сохранено, но карту не удалось обновить.",
              }
            : current,
        );
    } catch (reason) {
      if (
        request !== insertionSequence.current ||
        selectedMapId.current !== targetMapId
      )
        return;
      setInsertion((current) =>
        current?.mapId === targetMapId
          ? {
              ...current,
              status: "saved-refresh-failed",
              error: errorMessage(
                reason,
                "Размещение сохранено, но карту не удалось обновить",
              ),
            }
          : current,
      );
    }
  };

  const retryInsertionRefresh = async () => {
    if (!insertion || insertion.status !== "saved-refresh-failed") return;
    const targetMapId = insertion.mapId;
    setInsertion((current) =>
      current?.mapId === targetMapId
        ? { ...current, status: "saving", error: null }
        : current,
    );
    try {
      const refreshed = await reloadMap(targetMapId);
      if (selectedMapId.current === targetMapId && refreshed)
        setInsertion(null);
    } catch (reason) {
      if (selectedMapId.current === targetMapId) {
        setInsertion((current) =>
          current?.mapId === targetMapId
            ? {
                ...current,
                status: "saved-refresh-failed",
                error: errorMessage(reason, "Не удалось обновить карту"),
              }
            : current,
        );
      }
    }
  };

  const move = async (id: string, position: XYPosition) => {
    if (!savedMapDataSource || !mapId) return;
    setError(null);
    const targetMapId = mapId;
    const positionKey = savedMapViewKey(viewMode);
    try {
      await savedMapDataSource.movePosition(
        targetMapId,
        id,
        viewMode,
        position.x,
        position.y,
      );
      if (selectedMapId.current === targetMapId) {
        setMap((current) =>
          current?.map_ref.entity_id === targetMapId
            ? {
                ...current,
                placements: current.placements.map((placement) =>
                  placement.physical_object_ref.entity_id === id
                    ? {
                        ...placement,
                        positions: {
                          ...placement.positions,
                          [positionKey]: {
                            ...placement.positions[positionKey],
                            ...position,
                            locked: placement.positions[positionKey]?.locked ?? false,
                          },
                        },
                      }
                    : placement,
                ),
              }
            : current,
        );
      }
    } catch (reason) {
      if (selectedMapId.current !== targetMapId) return;
      setError(errorMessage(reason, "Не удалось сохранить позицию"));
      try {
        await reloadMap(targetMapId);
      } catch {
        // The original persistence error remains the bounded user-facing failure.
      }
      if (selectedMapId.current === targetMapId)
        setAuthoritativePositionRevision((revision) => revision + 1);
    }
  };

  const setPlacementLock = async (id: string, locked: boolean) => {
    if (!savedMapDataSource || !mapId) return;
    const targetMapId = mapId;
    const positionKey = savedMapViewKey(viewMode);
    await savedMapDataSource.setPositionLock(targetMapId, id, viewMode, locked);
    if (selectedMapId.current !== targetMapId) return;
    setMap((current) =>
      current?.map_ref.entity_id === targetMapId
        ? {
            ...current,
            placements: current.placements.map((placement) =>
              placement.physical_object_ref.entity_id === id && placement.positions[positionKey]
                ? {
                    ...placement,
                    positions: {
                      ...placement.positions,
                      [positionKey]: { ...placement.positions[positionKey], locked },
                    },
                  }
                : placement,
            ),
          }
        : current,
    );
  };

  const remove = async (id: string) => {
    if (!savedMapDataSource || !mapId) return;
    const targetMapId = mapId;
    setMapOperation({
      kind: "remove",
      id,
      mapId: targetMapId,
      status: "pending",
    });
    try {
      await savedMapDataSource.removePlacement(targetMapId, id);
    } catch (reason) {
      if (selectedMapId.current === targetMapId) setMapOperation(null);
      throw reason;
    }
    try {
      await reloadMap(targetMapId);
      if (selectedMapId.current === targetMapId) {
        setMapOperation(null);
        setSelection(null);
      }
    } catch {
      if (selectedMapId.current === targetMapId)
        setMapOperation({
          kind: "remove",
          id,
          mapId: targetMapId,
          status: "refresh-failed",
          message: "Объект убран с карты, но карту не удалось обновить.",
        });
    }
  };

  const addContinuationAtViewportCenter = async (id: string) => {
    if (!savedMapDataSource || !mapId) return;
    const targetMapId = mapId;
    const center = viewportCenter.current;
    const captured =
      continuationAnchor?.mapId === targetMapId &&
      selection?.type === "continuation" &&
      continuationAnchor.continuationId === selection.item.id
        ? continuationAnchor.anchor
        : null;
    if (!captured && !center) return;
    const anchor = captured ?? center!();
    setMapOperation({ kind: "add", id, mapId: targetMapId, status: "pending" });
    try {
      await savedMapDataSource.addPlacement(
        targetMapId,
        id,
        anchor.x,
        anchor.y,
      );
    } catch (reason) {
      if (selectedMapId.current === targetMapId) setMapOperation(null);
      throw reason;
    }
    try {
      await reloadMap(targetMapId);
      if (selectedMapId.current === targetMapId) setMapOperation(null);
    } catch {
      if (selectedMapId.current === targetMapId)
        setMapOperation({
          kind: "add",
          id,
          mapId: targetMapId,
          status: "refresh-failed",
          message: "Объект добавлен, но карту не удалось обновить.",
        });
    }
  };
  const retryMapRefresh = async () => {
    if (!mapOperation || mapOperation.status !== "refresh-failed") return;
    const operation = mapOperation;
    setMapOperation({ ...operation, status: "pending" });
    try {
      await reloadMap(operation.mapId);
      if (selectedMapId.current === operation.mapId) {
        setMapOperation(null);
        setSelection(null);
      }
    } catch {
      if (selectedMapId.current === operation.mapId) setMapOperation(operation);
    }
  };

  const positions = useMemo(() => {
    const positionKey = savedMapViewKey(viewMode);
    return Object.fromEntries(
      (activeMap?.placements ?? [])
        .map((item) => {
          const node = nodeForPhysicalObject(
            document?.nodes ?? [],
            item.physical_object_ref.entity_id,
          );
          const position = item.positions[positionKey];
          return node && position ? [node.id, { x: position.x, y: position.y }] : null;
        })
        .filter((item): item is [string, XYPosition] => item !== null),
    );
  }, [activeMap, document, viewMode]);
  const draggableNodeIds = useMemo(
    () =>
      new Set(
        (activeMap?.placements ?? [])
          .map(
            (item) =>
              nodeForPhysicalObject(
                document?.nodes ?? [],
                item.physical_object_ref.entity_id,
              )?.id,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    [activeMap, document],
  );
  const lockedNodeIds = useMemo(() => {
    const positionKey = savedMapViewKey(viewMode);
    return new Set(
      (activeMap?.placements ?? [])
        .filter((item) => item.positions[positionKey]?.locked)
        .map((item) => nodeForPhysicalObject(document?.nodes ?? [], item.physical_object_ref.entity_id)?.id)
        .filter((id): id is string => Boolean(id)),
    );
  }, [activeMap, document, viewMode]);
  const selectedPlacementPosition = useMemo(() => {
    const id = physicalObjectIdForSelection(selection);
    return activeMap?.placements.find((item) => item.physical_object_ref.entity_id === id)
      ?.positions[savedMapViewKey(viewMode)];
  }, [activeMap, selection, viewMode]);
  const receiveViewportCenter = useCallback(
    (getter: (() => XYPosition) | null) => {
      viewportCenter.current = getter;
      setCoordinateBridgeRevision((revision) => revision + 1);
    },
    [],
  );

  return (
    <main className="map-page">
      <div className="map-page__toolbar topology-mode-switch">
        <label>
          Карты:{" "}
          {legacy ? (
            "—"
          ) : (
            <select
              aria-label="Карты"
              value={mapId ?? ""}
              onChange={(event) => selectMap(event.target.value)}
            >
              <option value="" disabled>
                Выберите карту
              </option>
              {(maps ?? []).map((item) => (
                <option
                  key={item.map_ref.entity_id}
                  value={item.map_ref.entity_id}
                >
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </label>
        {!legacy && (
          <>
            <button type="button" onClick={() => setCreating(true)}>
              + Новая карта
            </button>
            <button
              type="button"
              onClick={startToolbarInsertion}
              disabled={!activeMap || !catalogInventoryDataSource}
            >
              + Добавить на карту
            </button>
          </>
        )}
        <button
          type="button"
          aria-pressed={viewMode === "logical"}
          onClick={() => setViewMode("logical")}
        >
          Логическая
        </button>
        <button
          type="button"
          aria-pressed={viewMode === "physical"}
          onClick={() => setViewMode("physical")}
        >
          Физическая
        </button>
      </div>

      {creating && (
        <section
          className="map-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Новая карта"
        >
          <div className="map-dialog__surface">
            <label>
              Название
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button type="button" onClick={() => setCreating(false)}>
              Отмена
            </button>
            <button type="button" onClick={() => void create()}>
              Создать
            </button>
          </div>
        </section>
      )}
      {insertion && insertion.mapId === mapId && (
        <MapInsertionPicker
          inventory={insertion.inventory}
          placedIds={ids}
          status={insertion.status}
          error={insertion.error}
          onSelect={(candidate) => void submitInsertion(candidate.id)}
          onClose={() => setInsertion(null)}
          onRetryRefresh={() => void retryInsertionRefresh()}
          requestedObjectId={insertion.requestedObjectId}
        />
      )}
      {contextAnchor && viewMode === "physical" && (
        <div
          className="map-context-menu"
          role="menu"
          style={{ left: contextAnchor.screen.x, top: contextAnchor.screen.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => openInsertion(contextAnchor.anchor)}
          >
            Добавить на карту…
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {document &&
        params.get("focus") &&
        !nodeForPhysicalObject(document.nodes, params.get("focus")!) && (
          <p>
            Объект с указанной canonical-ссылкой отсутствует в этой проекции.
          </p>
        )}
      {!legacy && maps?.length === 0 && (
        <section>
          <h2>Создайте первую карту</h2>
          <button onClick={() => setCreating(true)}>Создать карту</button>
        </section>
      )}
      {!legacy && activeMap && ids.length === 0 && (
        <section>
          <h2>Карта «{activeMap.name}» пока пуста</h2>
          <button onClick={startToolbarInsertion}>Добавить на карту</button>
        </section>
      )}
      {(legacy || activeMap) && (
        <>
          <TraceCommandBar
            catalogInventoryDataSource={catalogInventoryDataSource}
            physicalObjectDetailsDataSource={physicalObjectDetailsDataSource}
            traceDataSource={traceDataSource}
            traceArtifact={traceArtifact}
            selectedBranchId={selectedTraceBranchId}
            onSelectedBranchId={setSelectedTraceBranchId}
            onTraceArtifact={(artifact) => {
              setTraceArtifact(artifact);
              setSelectedTraceBranchId(artifact?.verdict === "REACHABLE" ? artifact.branches[0]?.branch_id ?? null : null);
              if (artifact?.verdict === "REACHABLE" && viewMode === "logical") {
                setTraceViewNotice("L1 trace показан на физической карте.");
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("view", "physical");
                  return next;
                });
              }
            }}
          />
          {traceViewNotice && viewMode === "physical" && <p className="map-page__trace-notice" role="status">{traceViewNotice}</p>}
          <section className="map-page__canvas">
            {!document && <ViewState kind="loading" />}
            {document && (
              <ReactFlowProvider>
                <TopologyCanvas
                  document={document}
                  selection={selection}
                  onSelectionChange={(nextSelection) => {
                    setContextAnchor(null);
                    if (nextSelection?.type !== "continuation")
                      setContinuationAnchor(null);
                    setSelection(nextSelection);
                  }}
                  sceneKey={presentationSceneKey}
                  positionOverrides={!legacy ? positions : undefined}
                  draggableNodeIds={!legacy ? draggableNodeIds : undefined}
                  lockedNodeIds={!legacy ? lockedNodeIds : undefined}
                  authoritativePositionRevision={authoritativePositionRevision}
                  onPhysicalNodeDragStop={!legacy ? move : undefined}
                  onNodeCollisionRejected={() =>
                    setError("Объекты нельзя размещать друг на друге.")
                  }
                  disableAutoLayout={!legacy}
                  traceOverlay={physicalTraceOverlayFor(
                    traceArtifact,
                    document,
                    selectedTraceBranchId,
                  )}
                  onViewportCenterReady={
                    viewMode === "physical" ? receiveViewportCenter : undefined
                  }
                  onPhysicalPaneContextMenu={
                    viewMode === "physical"
                      ? (anchor, screen) => setContextAnchor({ anchor, screen })
                      : undefined
                  }
                  onPaneClick={() => {
                    setContextAnchor(null);
                    setSelection(null);
                  }}
                  onContinuationClickAnchor={(continuationId, anchor) =>
                    mapId &&
                    setContinuationAnchor({ continuationId, mapId, anchor })
                  }
                />
              </ReactFlowProvider>
            )}
          </section>
        </>
      )}
      <QuickInspector
        document={document}
        selection={selection}
        onSelectNode={(node) => setSelection({ type: "node", item: node })}
        onClose={() => setSelection(null)}
        onAddContinuationToMap={
          !legacy && viewMode === "physical"
            ? addContinuationAtViewportCenter
            : undefined
        }
        physicalObjectDetailsDataSource={physicalObjectDetailsDataSource}
        catalogInventoryDataSource={catalogInventoryDataSource}
        onRemoveFromMap={
          !legacy &&
          viewMode === "physical" &&
          ids.includes(physicalObjectIdForSelection(selection) ?? "")
            ? remove
            : undefined
        }
        placementLocked={selectedPlacementPosition?.locked}
        onSetPlacementLock={
          !legacy && selectedPlacementPosition && physicalObjectIdForSelection(selection)
            ? (locked) => setPlacementLock(physicalObjectIdForSelection(selection)!, locked)
            : undefined
        }
        onDeletePhysicalObject={
          physicalObjectDeleteDataSource
            ? async (id) => {
                if (!mapId) return;
                const targetMapId = mapId;
                setMapOperation({
                  kind: "delete",
                  id,
                  mapId: targetMapId,
                  status: "pending",
                });
                try {
                  await physicalObjectDeleteDataSource.deletePhysicalObject(id);
                } catch (reason) {
                  if (selectedMapId.current === targetMapId)
                    setMapOperation(null);
                  throw reason;
                }
                try {
                  await reloadMap(targetMapId);
                  if (selectedMapId.current === targetMapId) {
                    setMapOperation(null);
                    setSelection(null);
                  }
                } catch {
                  if (selectedMapId.current === targetMapId)
                    setMapOperation({
                      kind: "delete",
                      id,
                      mapId: targetMapId,
                      status: "refresh-failed",
                      message: "Объект удалён, но карту не удалось обновить.",
                    });
                }
              }
            : undefined
        }
        mapOperation={mapOperation?.mapId === mapId ? mapOperation : null}
        onRetryMapRefresh={retryMapRefresh}
      />
    </main>
  );
}
