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
import { perfMark } from "../perfMarks";
import { ViewState } from "../components/ViewState";
import { physicalTraceOverlayFor } from "../topology/interfacePhysicalTraceOverlay";
import {
  footprintDimensionsForProjectionNode,
  nearestFreePosition,
  projectionNodeFootprint,
  type FlowRectangle,
} from "../topology/nodeFootprint";
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
  MapCableRouteWaypoint,
} from "../topology/savedMapTypes";
import { DEFAULT_BLUEPRINT_DISPLAY_WIDTH, clampBlueprintDisplayWidth } from "../topology/blueprintDisplaySize";
import { physicalCablePresentation } from "../topology/physicalCablePresentation";
import type {
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologySelection,
} from "../topology/types";
import type { PhysicalEndpointConnectionCreationDocument, PhysicalEndpointConnectionWriteDataSource } from "../topology/physicalEndpointConnectionWriteTypes";
import { isAvailablePhysicalPort } from "../topology/physicalPortAvailability";
import { useI18n } from "../i18n";

export { mapCandidateChoices } from "../components/MapInsertionPicker";

interface MapPageProps {
  dataSource: TopologyDataSource;
  /** Retained for callers that share App wiring; L1 object trace does not use it. */
  deviceDetailsDataSource?: DeviceDetailsDataSource;
  savedMapDataSource?: SavedMapDataSource;
  catalogInventoryDataSource?: CatalogInventoryDataSource;
  physicalObjectDeleteDataSource?: PhysicalObjectDeleteDataSource;
  physicalObjectDetailsDataSource?: PhysicalObjectDetailsDataSource;
  physicalEndpointConnectionWriteDataSource?: PhysicalEndpointConnectionWriteDataSource;
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
  status: "loading" | "ready" | "resolving" | "saving" | "saved-refresh-failed";
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
interface MapDeletionOperation {
  mapId: string;
  mapName: string;
  status: "confirming" | "deleting" | "refreshing" | "refresh-failed";
  error: string | null;
}
interface CableRouteEditState {
  mapId: string;
  cablePhysicalObjectId: string;
  originalRoutePresent: boolean;
  originalWaypoints: MapCableRouteWaypoint[];
  draftWaypoints: MapCableRouteWaypoint[];
  selectedWaypointIndex: number | null;
  status: "editing" | "saving" | "refresh-failed";
  error: string | null;
}
interface CableRouteResetOperation { mapId: string; cablePhysicalObjectId: string; status: "pending" | "refresh-failed"; message?: string; }
interface WiringEndpoint { physicalObjectId: string; connectionPointId: string; objectLabel: string; portLabel: string; }
interface WiringDraft { mapId: string; source: WiringEndpoint; draftWaypoints: MapCableRouteWaypoint[]; selectedWaypointIndex: number | null; }
interface WiringOperation extends WiringDraft { target: WiringEndpoint; cableName: string; canonicalResult?: PhysicalEndpointConnectionCreationDocument; error: string | null; }
type WiringState = { status: "idle" } | { status: "selecting-source"; mapId: string } | ({ status: "selecting-target" } & WiringDraft) | ({ status: "confirming" | "creating" | "route-saving" | "route-failed" | "refresh-failed" } & WiringOperation);

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
  physicalEndpointConnectionWriteDataSource,
  traceDataSource,
}: MapPageProps) {
  const { t } = useI18n();
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
  const [mapDeletion, setMapDeletion] = useState<MapDeletionOperation | null>(null);
  const [cableRouteEdit, setCableRouteEdit] = useState<CableRouteEditState | null>(null);
  const [cableRouteReset, setCableRouteReset] = useState<CableRouteResetOperation | null>(null);
  const [wiring, setWiring] = useState<WiringState>({ status: "idle" });
  const [authoritativePositionRevision, setAuthoritativePositionRevision] =
    useState(0);
  const [canonicalDeleteRevision, setCanonicalDeleteRevision] = useState(0);
  const [coordinateBridgeRevision, setCoordinateBridgeRevision] = useState(0);
  const selectedMapId = useRef<string | null>(mapId);
  const deletedMapIds = useRef(new Set<string>());
  const mapListRequest = useRef(0);
  const insertionSequence = useRef(0);
  const latestActiveMap = useRef<SavedMap | null>(null);
  const latestPhysicalDocument = useRef<TopologyProjectionDocument | null>(null);
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
  latestActiveMap.current = activeMap;
  latestPhysicalDocument.current = viewMode === "physical" ? document : null;
  const ids =
    activeMap?.placements.map((item) => item.physical_object_ref.entity_id) ??
    [];
  const placementMembershipKey = ids.join(",");
  const hasLoadedMap = legacy || Boolean(activeMap);

  const selectedCableId = selection?.type === "node" && selection.item.attributes.class === "cable"
    ? physicalObjectIdForNode(selection.item)
    : null;
  const drawableSelectedCable = Boolean(
    selectedCableId && document && viewMode === "physical" && physicalCablePresentation(document).cables.some((item) => physicalObjectIdForNode(item.cable) === selectedCableId),
  );
  const selectedCableRoute = selectedCableId
    ? (activeMap?.cable_routes ?? []).find((route) => route.cable_ref.entity_id === selectedCableId)
    : undefined;

  useEffect(() => {
    if (!cableRouteEdit) return;
    if (viewMode !== "physical" || mapId !== cableRouteEdit.mapId || selectedCableId !== cableRouteEdit.cablePhysicalObjectId)
      setCableRouteEdit(null);
  }, [cableRouteEdit, mapId, selectedCableId, viewMode]);

  const selectMap = useCallback(
    (id: string) => {
      insertionSequence.current += 1;
      selectedMapId.current = id;
      setSelection(null);
      setSceneDocument(null);
      setInsertion(null);
      setContextAnchor(null);
      setPendingPhysicalToolbarInsertion(null);
      setContinuationAnchor(null);
      setMapOperation(null);
      setCableRouteEdit(null);
      setCableRouteReset(null);
      setWiring({ status: "idle" });
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

  const clearMapSelection = useCallback(() => {
    insertionSequence.current += 1;
    selectedMapId.current = null;
    setSelection(null);
    setMap(null);
    setSceneDocument(null);
    setInsertion(null);
    setContextAnchor(null);
    setPendingPhysicalToolbarInsertion(null);
    setContinuationAnchor(null);
    setMapOperation(null);
    setCableRouteEdit(null);
    setCableRouteReset(null);
    setWiring({ status: "idle" });
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("map");
      next.delete("focus");
      next.delete("add");
      return next;
    });
  }, [setParams]);

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
    const request = ++mapListRequest.current;
    void savedMapDataSource.listMaps().then(
      (items) => {
        if (!active || request !== mapListRequest.current) return;
        const sorted = items.filter((item) => !deletedMapIds.current.has(item.map_ref.entity_id)).sort((left, right) =>
          natural(left.name, right.name),
        );
        setMaps(sorted);
        if (!mapId && sorted[0]) selectMap(sorted[0].map_ref.entity_id);
      },
      (reason) => active && request === mapListRequest.current && setError(errorMessage(reason, t("view.error.title"))),
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
      setError(t("map.choose"));
      return undefined;
    }
    let active = true;
    setError(null);
    void savedMapDataSource.loadMap(mapId).then(
      (detail) => active && selectedMapId.current === mapId && !deletedMapIds.current.has(mapId) && setMap(detail),
      (reason) =>
        active && setError(errorMessage(reason, t("view.error.title"))),
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
        (next) => {
          if (!active) return;
          perfMark("document-received");
          setSceneDocument({ sceneKey: presentationSceneKey, document: next });
        },
        (reason) =>
          active &&
          setError(errorMessage(reason, t("view.error.title"))),
      );
    return () => {
      active = false;
    };
  }, [
    dataSource,
    hasLoadedMap,
    placementMembershipKey,
    presentationSceneKey,
    canonicalDeleteRevision,
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
      setError(errorMessage(reason, t("map.create")));
    }
  };

  const refreshAfterMapDeletion = async (operation: MapDeletionOperation) => {
    if (!savedMapDataSource) return;
    setMapDeletion({ ...operation, status: "refreshing", error: null });
    try {
      const refreshed = (await savedMapDataSource.listMaps())
        .filter((item) => !deletedMapIds.current.has(item.map_ref.entity_id))
        .sort((left, right) => natural(left.name, right.name));
      setMaps(refreshed);
      if (!refreshed.some((item) => item.map_ref.entity_id === selectedMapId.current)) {
        if (refreshed[0]) selectMap(refreshed[0].map_ref.entity_id);
        else clearMapSelection();
      }
      setMapDeletion(null);
    } catch (reason) {
      setMapDeletion({ ...operation, status: "refresh-failed", error: errorMessage(reason, t("map.wiringRefreshFailed")) });
    }
  };

  const deleteMap = async () => {
    if (!savedMapDataSource || !mapDeletion || mapDeletion.status !== "confirming") return;
    const operation = { ...mapDeletion, status: "deleting" as const, error: null };
    setMapDeletion(operation);
    try {
      await savedMapDataSource.deleteMap(operation.mapId);
    } catch (reason) {
      setMapDeletion({ ...operation, status: "confirming", error: errorMessage(reason, t("map.delete")) });
      return;
    }
    deletedMapIds.current.add(operation.mapId);
    mapListRequest.current += 1;
    const remaining = (maps ?? []).filter((item) => item.map_ref.entity_id !== operation.mapId);
    setMaps(remaining);
    if (remaining[0]) selectMap(remaining[0].map_ref.entity_id);
    else clearMapSelection();
    await refreshAfterMapDeletion(operation);
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
                    t("insert.loading"),
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
    if (nextView !== "physical") setWiring({ status: "idle" });
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", nextView);
      return next;
    });
  };

  const endpointFor = (candidate: { physicalObjectId: string; connectionPointId: string; label: string }, sourceId?: string): WiringEndpoint | null => {
    const node = (latestPhysicalDocument.current?.nodes ?? []).find((item) => physicalObjectIdForNode(item) === candidate.physicalObjectId);
    if (!node || node.kind !== "PHYSICAL_OBJECT" || node.attributes.class === "cable") return null;
    const point = (node.attributes.connection_points ?? []).find((item) => item.connection_point_id === candidate.connectionPointId);
    if (!point || !isAvailablePhysicalPort(point) || point.connection_point_id === sourceId) return null;
    return { physicalObjectId: candidate.physicalObjectId, connectionPointId: point.connection_point_id, objectLabel: node.label, portLabel: point.display_name || candidate.label };
  };
  const physicalPortStates = useMemo(() => {
    if (wiring.status === "idle") return undefined;
    const states: Record<string, 'eligible' | 'source' | 'destination' | 'unavailable'> = {};
    for (const node of document?.nodes ?? []) {
      if (node.kind !== "PHYSICAL_OBJECT" || node.attributes.class === "cable") continue;
      for (const point of node.attributes.connection_points ?? []) states[point.connection_point_id] = isAvailablePhysicalPort(point) ? "eligible" : "unavailable";
      for (const slot of node.attributes.blueprint_presentation?.slots ?? []) if (!states[slot.connection_point_id]) states[slot.connection_point_id] = "unavailable";
    }
    const source = wiring.status !== "selecting-source" ? wiring.source : null;
    const target = wiring.status !== "selecting-source" && wiring.status !== "selecting-target" ? wiring.target : null;
    if (source) states[source.connectionPointId] = "source";
    if (target) states[target.connectionPointId] = "destination";
    return states;
  }, [document, wiring]);
  const wiringInternalContinuity = useMemo(() => {
    if (wiring.status === "idle" || wiring.status === "selecting-source") return { members: new Set<string>(), points: new Set<string>() };
    const node = (document?.nodes ?? []).find((item) => physicalObjectIdForNode(item) === wiring.source.physicalObjectId);
    const members = new Set<string>(); const points = new Set<string>();
    for (const link of node?.attributes.internal_l1_links ?? []) {
      if (link.from_connection_point_id === wiring.source.connectionPointId) { members.add(link.connection_member_id); points.add(link.to_connection_point_id); }
      if (link.to_connection_point_id === wiring.source.connectionPointId) { members.add(link.connection_member_id); points.add(link.from_connection_point_id); }
    }
    return { members, points };
  }, [document, wiring]);
  const onPhysicalPortClick = (candidate: { physicalObjectId: string; connectionPointId: string; label: string }) => {
    if (wiring.status === "selecting-source") { const source = endpointFor(candidate); if (source) setWiring({ status: "selecting-target", mapId: wiring.mapId, source, draftWaypoints: [], selectedWaypointIndex: null }); }
    else if (wiring.status === "selecting-target") { const target = endpointFor(candidate, wiring.source.connectionPointId); if (target) setWiring({ ...wiring, status: "confirming", target, cableName: "", error: null }); }
  };
  const refreshWiringProjection = async (operation: WiringOperation): Promise<boolean> => {
    const currentMap = latestActiveMap.current;
    if (!currentMap || currentMap.map_ref.entity_id !== operation.mapId) return false;
    const next = await dataSource.loadProjection(projectionRequestFor("physical", currentMap.placements.map((item) => item.physical_object_ref.entity_id), true));
    if (selectedMapId.current !== operation.mapId || viewMode !== "physical") return false;
    setSceneDocument({ sceneKey: `${operation.mapId}/physical`, document: next }); return true;
  };
  const refreshWiringAfterRouteWrite = async (operation: WiringOperation): Promise<boolean> => {
    if (!await reloadMap(operation.mapId)) return false;
    return refreshWiringProjection(operation);
  };
  const saveWiringRoute = async (operation: WiringOperation) => {
    if (!operation.canonicalResult) return;
    if (!savedMapDataSource || typeof savedMapDataSource.setCableRoute !== "function") {
      try { if (await refreshWiringProjection(operation)) setWiring({ status: "idle" }); }
      catch { if (selectedMapId.current === operation.mapId && viewMode === "physical") setWiring({ ...operation, status: "refresh-failed", error: null }); }
      return;
    }
    setWiring({ ...operation, status: "route-saving", error: null });
    try { await savedMapDataSource.setCableRoute(operation.mapId, operation.canonicalResult.cable_ref.entity_id, operation.draftWaypoints); }
    catch { if (selectedMapId.current === operation.mapId && viewMode === "physical") setWiring({ ...operation, status: "route-failed", error: null }); return; }
    if (selectedMapId.current !== operation.mapId || viewMode !== "physical") return;
    try { if (await refreshWiringAfterRouteWrite(operation)) setWiring({ status: "idle" }); }
    catch { if (selectedMapId.current === operation.mapId && viewMode === "physical") setWiring({ ...operation, status: "refresh-failed", error: null }); }
  };
  const createWiring = async () => {
    if (!physicalEndpointConnectionWriteDataSource || wiring.status !== "confirming") return;
    const operation = wiring;
    if (!endpointFor({ physicalObjectId: operation.source.physicalObjectId, connectionPointId: operation.source.connectionPointId, label: operation.source.portLabel }) || !endpointFor({ physicalObjectId: operation.target.physicalObjectId, connectionPointId: operation.target.connectionPointId, label: operation.target.portLabel }, operation.source.connectionPointId)) { setWiring({ ...operation, error: t("map.wiring.source") }); return; }
    setWiring({ ...operation, status: "creating", error: null });
    let canonicalResult: PhysicalEndpointConnectionCreationDocument;
    try { canonicalResult = await physicalEndpointConnectionWriteDataSource.createPhysicalEndpointConnection({ source: { kind: "CONNECTION_POINT", connection_point_id: operation.source.connectionPointId, member_index: 1 }, target: { kind: "CONNECTION_POINT", connection_point_id: operation.target.connectionPointId, member_index: 1 }, ...(operation.cableName.trim() ? { cable_display_name: operation.cableName.trim() } : {}) }); }
    catch (reason) { if (selectedMapId.current === operation.mapId && viewMode === "physical") setWiring({ ...operation, error: errorMessage(reason, t("map.createCable")) }); return; }
    if (selectedMapId.current !== operation.mapId || viewMode !== "physical") return;
    await saveWiringRoute({ ...operation, canonicalResult });
  };
  const retryWiringRoute = async () => { if (wiring.status !== "route-failed") return; await saveWiringRoute(wiring); };
  const retryWiringRefresh = async () => { if (wiring.status !== "refresh-failed") return; const operation = wiring; try { if (await refreshWiringAfterRouteWrite(operation)) setWiring({ status: "idle" }); } catch { if (selectedMapId.current === operation.mapId && viewMode === "physical") setWiring(operation); } };

  const resolveInsertionPosition = async (
    id: string,
    anchor: XYPosition,
  ): Promise<XYPosition | null> => {
    const candidateDocument = await dataSource.loadProjection(
      projectionRequestFor("physical", [id]),
    );
    const candidates = candidateDocument.nodes.filter(
      (node) =>
        node.kind === "PHYSICAL_OBJECT" &&
        node.attributes.class !== "cable" &&
        physicalObjectIdForNode(node) === id,
    );
    if (candidates.length !== 1)
      throw new Error(t("map.geometryUnavailable"));

    const occupied: FlowRectangle[] = (latestActiveMap.current?.placements ?? []).flatMap(
      (placement) => {
        const node = nodeForPhysicalObject(
          latestPhysicalDocument.current?.nodes ?? [],
          placement.physical_object_ref.entity_id,
        );
        const position = placement.positions["L1/PHYSICAL_OBJECT"];
        return node && position && node.kind === "PHYSICAL_OBJECT" && node.attributes.class !== "cable"
          ? [projectionNodeFootprint(node, position, position.display_width)]
          : [];
      },
    );
    return nearestFreePosition(
      anchor,
      footprintDimensionsForProjectionNode(candidates[0]),
      occupied,
    );
  };

  const submitInsertion = async (id: string, operation = insertion) => {
    if (!savedMapDataSource || !operation || operation.status !== "ready")
      return;
    const request = ++insertionSequence.current;
    const targetMapId = operation.mapId;
    setInsertion((current) =>
      current?.mapId === targetMapId
        ? { ...current, status: "resolving", error: null }
        : current,
    );
    let position: XYPosition | null;
    let preflightComplete = false;
    try {
      position = await resolveInsertionPosition(id, operation.anchor);
      preflightComplete = true;
      if (
        request !== insertionSequence.current ||
        selectedMapId.current !== targetMapId
      )
        return;
      if (!position) {
        setInsertion((current) =>
          current?.mapId === targetMapId
            ? {
                ...current,
                status: "ready",
                error: t("view.empty.body"),
              }
            : current,
        );
        return;
      }
      setInsertion((current) =>
        current?.mapId === targetMapId
          ? { ...current, status: "saving" }
          : current,
      );
      await savedMapDataSource.addPlacement(
        targetMapId,
        id,
        position.x,
        position.y,
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
              error: preflightComplete
                ? errorMessage(reason, t("map.add"))
                : t("map.geometryUnavailable"),
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
                error: t("map.wiringRefreshFailed"),
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
                t("map.wiringRefreshFailed"),
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
                error: errorMessage(reason, t("view.error.title")),
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
      setError(errorMessage(reason, t("view.error.title")));
      try {
        await reloadMap(targetMapId);
      } catch {
        // The original persistence error remains the bounded user-facing failure.
      }
      if (selectedMapId.current === targetMapId)
        setAuthoritativePositionRevision((revision) => revision + 1);
    }
  };

  const resizeBlueprint = async (id: string, displayWidth: number) => {
    if (!savedMapDataSource || !mapId || viewMode !== "physical") return;
    const targetMapId = mapId;
    const positionKey = savedMapViewKey(viewMode);
    const current = activeMap?.placements.find((placement) => placement.physical_object_ref.entity_id === id)?.positions[positionKey];
    if (!current) return;
    const blueprint = (latestPhysicalDocument.current?.nodes ?? [])
      .find((node) => physicalObjectIdForNode(node) === id)
      ?.attributes.blueprint_presentation;
    const width = clampBlueprintDisplayWidth(displayWidth, blueprint);
    try {
      await savedMapDataSource.movePosition(targetMapId, id, viewMode, current.x, current.y, width);
      if (selectedMapId.current === targetMapId) setMap((existing) => existing?.map_ref.entity_id === targetMapId ? {
        ...existing,
        placements: existing.placements.map((placement) => placement.physical_object_ref.entity_id === id ? {
          ...placement, positions: { ...placement.positions, [positionKey]: { ...placement.positions[positionKey]!, display_width: width } },
        } : placement),
      } : existing);
    } catch (reason) {
      if (selectedMapId.current !== targetMapId) return;
      setError(errorMessage(reason, t("view.error.title")));
      try { await reloadMap(targetMapId); } catch { /* preserve persistence error */ }
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
          message: t("map.removeRefreshFailed"),
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
    let preflightComplete = false;
    try {
      const position = await resolveInsertionPosition(id, anchor);
      preflightComplete = true;
      if (selectedMapId.current !== targetMapId) return;
      if (!position)
        throw new Error(t("view.empty.body"));
      await savedMapDataSource.addPlacement(
        targetMapId,
        id,
        position.x,
        position.y,
      );
    } catch (reason) {
      if (selectedMapId.current === targetMapId) setMapOperation(null);
      throw preflightComplete
        ? reason
        : new Error(t("map.geometryUnavailable"));
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
          message: t("map.addRefreshFailed"),
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

  const beginCableRouteEdit = () => {
    if (!activeMap || !selectedCableId || !drawableSelectedCable || viewMode !== "physical") return;
    const existing = (activeMap.cable_routes ?? []).find((route) => route.cable_ref.entity_id === selectedCableId);
    const copied = existing?.waypoints.map((point) => ({ ...point })) ?? [];
    setCableRouteEdit({ mapId: activeMap.map_ref.entity_id, cablePhysicalObjectId: selectedCableId, originalRoutePresent: Boolean(existing), originalWaypoints: copied, draftWaypoints: copied, selectedWaypointIndex: null, status: "editing", error: null });
  };
  const saveCableRoute = async () => {
    if (!savedMapDataSource || !cableRouteEdit || cableRouteEdit.status === "saving") return;
    const operation = cableRouteEdit;
    setCableRouteEdit({ ...operation, status: "saving", error: null });
    try { await savedMapDataSource.setCableRoute(operation.mapId, operation.cablePhysicalObjectId, operation.draftWaypoints); }
    catch {
      if (selectedMapId.current === operation.mapId) setCableRouteEdit((current) => current?.mapId === operation.mapId && current.cablePhysicalObjectId === operation.cablePhysicalObjectId ? { ...current, status: "editing", error: t("map.routeFailed") } : current);
      return;
    }
    try {
      if (await reloadMap(operation.mapId) && selectedMapId.current === operation.mapId) setCableRouteEdit(null);
    } catch {
      if (selectedMapId.current === operation.mapId) setCableRouteEdit((current) => current?.mapId === operation.mapId && current.cablePhysicalObjectId === operation.cablePhysicalObjectId ? { ...current, status: "refresh-failed", error: t("map.routeSavedRefreshFailed") } : current);
    }
  };
  const retryCableRouteRefresh = async () => {
    if (!cableRouteEdit || cableRouteEdit.status !== "refresh-failed") return;
    const operation = cableRouteEdit;
    setCableRouteEdit({ ...operation, status: "saving", error: null });
    try {
      if (await reloadMap(operation.mapId) && selectedMapId.current === operation.mapId) setCableRouteEdit(null);
    } catch {
      if (selectedMapId.current === operation.mapId) setCableRouteEdit({ ...operation, status: "refresh-failed", error: t("map.routeSavedRefreshFailed") });
    }
  };
  const resetCableRoute = async () => {
    if (!savedMapDataSource || !activeMap || !selectedCableId || !selectedCableRoute) return;
    const operation = { mapId: activeMap.map_ref.entity_id, cablePhysicalObjectId: selectedCableId, status: "pending" as const };
    setCableRouteReset(operation);
    try { await savedMapDataSource.deleteCableRoute(operation.mapId, operation.cablePhysicalObjectId); }
    catch (reason) { if (selectedMapId.current === operation.mapId) setCableRouteReset(null); setError(errorMessage(reason, t("inspector.resetRoute"))); return; }
    try {
      const refreshed = await reloadMap(operation.mapId);
      if (selectedMapId.current === operation.mapId && refreshed) setCableRouteReset(null);
    } catch {
      if (selectedMapId.current === operation.mapId) setCableRouteReset({ ...operation, status: "refresh-failed", message: t("inspector.routeResetFailed") });
    }
  };
  const retryCableRouteResetRefresh = async () => {
    if (!cableRouteReset || cableRouteReset.status !== "refresh-failed") return;
    const operation = cableRouteReset;
    setCableRouteReset({ ...operation, status: "pending" });
    try { if (await reloadMap(operation.mapId)) setCableRouteReset(null); }
    catch { if (selectedMapId.current === operation.mapId) setCableRouteReset(operation); }
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
  const displayWidthOverrides = useMemo(() => Object.fromEntries(
    (activeMap?.placements ?? []).flatMap((item) => {
      const node = nodeForPhysicalObject(document?.nodes ?? [], item.physical_object_ref.entity_id);
      const position = item.positions['L1/PHYSICAL_OBJECT'];
      return node?.attributes.blueprint_presentation && position ? [[node.id, position.display_width ?? DEFAULT_BLUEPRINT_DISPLAY_WIDTH]] : [];
    }),
  ), [activeMap, document]);
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
          {t("map.maps")}:{" "}
          {legacy ? (
            "—"
          ) : (
            <select
              aria-label={t("map.maps")}
              value={mapId ?? ""}
              onChange={(event) => selectMap(event.target.value)}
            >
              <option value="" disabled>
                {t("map.choose")}
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
              + {t("map.new")}
            </button>
            <button
              type="button"
              onClick={() => activeMap && setMapDeletion({ mapId: activeMap.map_ref.entity_id, mapName: activeMap.name, status: "confirming", error: null })}
              disabled={!activeMap}
            >
              {t("map.delete")}
            </button>
            <button
              type="button"
              onClick={startToolbarInsertion}
              disabled={!activeMap || !catalogInventoryDataSource}
            >
              + {t("map.add")}
            </button>
            <button type="button" onClick={() => activeMap && setWiring({ status: "selecting-source", mapId: activeMap.map_ref.entity_id })} disabled={!activeMap || viewMode !== "physical" || !document || !physicalEndpointConnectionWriteDataSource}>{t("map.connectPorts")}</button>
          </>
        )}
        <button
          type="button"
          aria-pressed={viewMode === "logical"}
          onClick={() => setViewMode("logical")}
        >
          {t("map.logical")}
        </button>
        <button
          type="button"
          aria-pressed={viewMode === "physical"}
          onClick={() => setViewMode("physical")}
        >
          {t("map.physical")}
        </button>
      </div>

      {creating && (
        <section
          className="map-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("map.createTitle")}
        >
          <div className="map-dialog__surface">
            <label>
              {t("map.name")}
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button type="button" onClick={() => setCreating(false)}>
              {t("map.cancel")}
            </button>
            <button type="button" onClick={() => void create()}>
              {t("map.create")}
            </button>
          </div>
        </section>
      )}
      {mapDeletion && (
        <section className="map-dialog" role="dialog" aria-modal="true" aria-label={t("map.delete")}>
          <div className="map-dialog__surface">
            {mapDeletion.status === "confirming" && <>
              <p>{t("map.delete.confirm", { name: mapDeletion.mapName })}</p>
              <p>{t("map.delete.description")}</p>
              {mapDeletion.error && <p role="alert">{mapDeletion.error}</p>}
              <button type="button" onClick={() => setMapDeletion(null)}>{t("map.cancel")}</button>
              <button type="button" onClick={() => void deleteMap()}>{t("map.delete")}</button>
            </>}
            {mapDeletion.status === "deleting" && <p role="status">{t("map.deleting")}</p>}
            {mapDeletion.status === "refreshing" && <p role="status">{t("map.refreshing")}</p>}
            {mapDeletion.status === "refresh-failed" && <>
              <p role="alert">{mapDeletion.error ?? t("map.wiringRefreshFailed")}</p>
              <button type="button" onClick={() => void refreshAfterMapDeletion(mapDeletion)}>{t("map.retryRefresh")}</button>
            </>}
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
          onClose={() => {
            insertionSequence.current += 1;
            setInsertion(null);
          }}
          onRetryRefresh={() => void retryInsertionRefresh()}
          requestedObjectId={insertion.requestedObjectId}
        />
      )}
      {(wiring.status === "selecting-source" || wiring.status === "selecting-target") && wiring.mapId === mapId && <aside className="map-wiring-panel" aria-label={t("map.connectPorts")}>
        {wiring.status === "selecting-source" && <p role="status">{t("map.wiring.source")}</p>}
        {wiring.status === "selecting-target" && <><p role="status">{t("map.wiring.target")}</p><p>{t("map.wiring.clickRoute")}</p><p>{t("map.wiring.sourceLabel", { object: wiring.source.objectLabel, port: wiring.source.portLabel })}</p><p>{t("map.wiring.points", { count: wiring.draftWaypoints.length })}</p>{wiring.selectedWaypointIndex !== null && <button type="button" onClick={() => setWiring((current) => current.status === "selecting-target" ? { ...current, draftWaypoints: current.draftWaypoints.filter((_, index) => index !== current.selectedWaypointIndex), selectedWaypointIndex: null } : current)}>{t("map.wiring.deletePoint")}</button>}</>}
        <button type="button" onClick={() => setWiring({ status: "idle" })}>{t("map.cancel")}</button>
      </aside>}
      {(wiring.status === "confirming" || wiring.status === "creating" || wiring.status === "route-saving" || wiring.status === "route-failed" || wiring.status === "refresh-failed") && wiring.mapId === mapId && <section className="map-dialog" role="dialog" aria-modal="true" aria-label={t("map.connectPorts")}><div className="map-dialog__surface">
        {(wiring.status === "confirming" || wiring.status === "creating") && <><p>{t("map.wiring.sourceLabel", { object: wiring.source.objectLabel, port: wiring.source.portLabel })}</p><p>{t("map.wiring.destinationLabel", { object: wiring.target.objectLabel, port: wiring.target.portLabel })}</p><p>{t("map.wiring.points", { count: wiring.draftWaypoints.length })}</p><label>{t("map.wiring.cableName")}<input aria-label={t("map.wiring.cableName")} disabled={wiring.status === "creating"} value={wiring.cableName} onChange={(event) => setWiring((current) => current.status === "confirming" ? { ...current, cableName: event.target.value } : current)} /></label>{wiring.error && <p role="alert">{wiring.error}</p>}<button type="button" disabled={wiring.status === "creating"} onClick={() => setWiring({ status: "selecting-target", mapId: wiring.mapId, source: wiring.source, draftWaypoints: wiring.draftWaypoints, selectedWaypointIndex: wiring.selectedWaypointIndex })}>{t("map.back")}</button><button type="button" disabled={wiring.status === "creating"} onClick={() => setWiring({ status: "idle" })}>{t("map.cancel")}</button><button type="button" disabled={wiring.status === "creating"} onClick={() => void createWiring()}>{wiring.status === "creating" ? t("map.creating") : wiring.error ? t("action.retry") : t("map.createCable")}</button></>}
        {wiring.status === "route-saving" && <p role="status">{t("map.savingRoute")}</p>}
        {wiring.status === "route-failed" && <><p role="alert">{t("map.routeFailed")}</p><button type="button" onClick={() => void retryWiringRoute()}>{t("map.retrySaveRoute")}</button><button type="button" onClick={() => setWiring({ status: "idle" })}>{t("action.close")}</button></>}
        {wiring.status === "refresh-failed" && <><p role="alert">{t("map.wiringRefreshFailed")}</p><button type="button" onClick={() => void retryWiringRefresh()}>{t("map.retryRefresh")}</button></>}
      </div></section>}
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
          <h2>{t("map.empty.title")}</h2>
          <button onClick={() => setCreating(true)}>{t("map.create")}</button>
        </section>
      )}
      {!legacy && activeMap && ids.length === 0 && (
        <section>
          <h2>{t("map.empty.active", { name: activeMap.name })}</h2>
          <button onClick={startToolbarInsertion}>{t("map.add")}</button>
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
                  displayWidthOverrides={!legacy && viewMode === "physical" ? displayWidthOverrides : undefined}
                  draggableNodeIds={!legacy ? draggableNodeIds : undefined}
                  lockedNodeIds={!legacy ? lockedNodeIds : undefined}
                  authoritativePositionRevision={authoritativePositionRevision}
                  onPhysicalNodeDragStop={!legacy ? move : undefined}
                  onBlueprintDisplayResize={!legacy && viewMode === "physical" ? resizeBlueprint : undefined}
                  onNodeCollisionRejected={() =>
                    setError(t("map.collision"))
                  }
                  disableAutoLayout={!legacy}
                  traceOverlay={physicalTraceOverlayFor(
                    traceArtifact,
                    document,
                    selectedTraceBranchId,
                  )}
                  cableRoutes={
                    viewMode === "physical" ? activeMap?.cable_routes : undefined
                  }
                  cableRouteDraft={cableRouteEdit ? { cablePhysicalObjectId: cableRouteEdit.cablePhysicalObjectId, waypoints: cableRouteEdit.draftWaypoints, selectedWaypointIndex: cableRouteEdit.selectedWaypointIndex, onWaypointSelect: (index) => setCableRouteEdit((current) => current ? { ...current, selectedWaypointIndex: index } : current), onWaypointMove: (index, waypoint) => setCableRouteEdit((current) => current ? { ...current, draftWaypoints: current.draftWaypoints.map((point, pointIndex) => pointIndex === index ? waypoint : point) } : current), onWaypointInsert: (index, waypoint) => setCableRouteEdit((current) => current ? { ...current, draftWaypoints: [...current.draftWaypoints.slice(0, index), waypoint, ...current.draftWaypoints.slice(index)], selectedWaypointIndex: index } : current) } : undefined}
                  wiringRoute={wiring.status !== "idle" && wiring.status !== "selecting-source" ? { source: wiring.source, target: wiring.status === "selecting-target" ? undefined : wiring.target, waypoints: wiring.draftWaypoints, selectedWaypointIndex: wiring.selectedWaypointIndex, onWaypointSelect: (index) => setWiring((current) => current.status !== "idle" && current.status !== "selecting-source" ? { ...current, selectedWaypointIndex: index } : current), onWaypointMove: (index, waypoint) => setWiring((current) => current.status !== "idle" && current.status !== "selecting-source" ? { ...current, draftWaypoints: current.draftWaypoints.map((point, pointIndex) => pointIndex === index ? waypoint : point) } : current) } : undefined}
                  physicalPortStates={physicalPortStates}
                  wiringHighlightedConnectionMemberIds={wiringInternalContinuity.members}
                  wiringContinuationConnectionPointIds={wiringInternalContinuity.points}
                  onPhysicalPortClick={wiring.status === "selecting-source" || wiring.status === "selecting-target" ? onPhysicalPortClick : undefined}
                  onViewportCenterReady={
                    viewMode === "physical" ? receiveViewportCenter : undefined
                  }
                  onPhysicalPaneContextMenu={
                    viewMode === "physical"
                      ? (anchor, screen) => setContextAnchor({ anchor, screen })
                      : undefined
                  }
                  onPaneClick={(anchor) => {
                    setContextAnchor(null);
                    setSelection(null);
                    setWiring((current) => current.status === "selecting-target" ? { ...current, draftWaypoints: [...current.draftWaypoints, anchor], selectedWaypointIndex: current.draftWaypoints.length } : current);
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
        cableRoutePresentation={(!legacy && viewMode === "physical" && selectedCableId && drawableSelectedCable) ? { present: Boolean(selectedCableRoute), waypointCount: selectedCableRoute?.waypoints.length ?? 0, editing: Boolean(cableRouteEdit), selectedWaypointIndex: cableRouteEdit?.selectedWaypointIndex ?? null, savePending: cableRouteEdit?.status === "saving", refreshFailed: cableRouteEdit?.status === "refresh-failed", error: cableRouteEdit?.error ?? null, resetPending: cableRouteReset?.status === "pending", resetRefreshFailed: cableRouteReset?.status === "refresh-failed" } : undefined}
        onEditCableRoute={beginCableRouteEdit}
        onCancelCableRouteEdit={() => setCableRouteEdit(null)}
        onDeleteCableRouteWaypoint={() => setCableRouteEdit((current) => current && current.selectedWaypointIndex !== null ? { ...current, draftWaypoints: current.draftWaypoints.filter((_, index) => index !== current.selectedWaypointIndex), selectedWaypointIndex: null } : current)}
        onSaveCableRoute={() => void saveCableRoute()}
        onRetryCableRouteRefresh={() => void retryCableRouteRefresh()}
        onResetCableRoute={() => void resetCableRoute()}
        onRetryCableRouteReset={() => void retryCableRouteResetRefresh()}
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
                    setCanonicalDeleteRevision((revision) => revision + 1);
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
                      message: t("map.deleteRefreshFailed"),
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
