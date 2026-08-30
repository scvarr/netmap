import { ReactFlowProvider, type XYPosition } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  MapInsertionPicker,
  mapCandidateChoices,
} from "../components/MapInsertionPicker";
import { QuickInspector } from "../components/QuickInspector";
import { MapContextMenu, type MapContextTarget } from "../components/MapContextMenu";
import { TraceCommandBar } from "../components/TraceCommandBar";
import { TopologyCanvas } from "../components/TopologyCanvas";
import type { MapRegionDraft } from "../components/MapRegionLayer";
import { MapRegionTree } from "../components/MapRegionTree";
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
import type { CableDeleteDataSource } from "../topology/cableDeleteTypes";
import type { DeviceDetailsDataSource } from "../topology/deviceDetailsTypes";
import type {
  PhysicalObjectL1TraceArtifact,
  PhysicalObjectL1TraceDataSource,
} from "../topology/physicalObjectL1TraceTypes";
import type { TopologyLayoutStore } from "../topology/layoutStore";
import type { PhysicalObjectDeleteDataSource } from "../topology/physicalObjectDeleteTypes";
import type { PhysicalObjectDetailsDataSource } from "../topology/physicalObjectDetailsTypes";
import {
  cableIdForNode,
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
import { defaultMapRegionStyle, nextMapRegionZOrder } from "../topology/regionPresentation";
import type {
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologySelection,
} from "../topology/types";
import type { PhysicalEndpointConnectionCreationDocument, PhysicalEndpointConnectionWriteDataSource } from "../topology/physicalEndpointConnectionWriteTypes";
import { isAvailablePhysicalPort } from "../topology/physicalPortAvailability";
import { displayNodeLabel } from "../topology/presentation";
import { useI18n } from "../i18n";

export { mapCandidateChoices } from "../components/MapInsertionPicker";

interface MapPageProps {
  dataSource: TopologyDataSource;
  /** Retained for callers that share App wiring; L1 object trace does not use it. */
  deviceDetailsDataSource?: DeviceDetailsDataSource;
  savedMapDataSource?: SavedMapDataSource;
  catalogInventoryDataSource?: CatalogInventoryDataSource;
  physicalObjectDeleteDataSource?: PhysicalObjectDeleteDataSource;
  cableDeleteDataSource?: CableDeleteDataSource;
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
  cableId: string;
  originalRoutePresent: boolean;
  originalWaypoints: MapCableRouteWaypoint[];
  draftWaypoints: MapCableRouteWaypoint[];
  selectedWaypointIndex: number | null;
  status: "editing" | "saving" | "refresh-failed";
  error: string | null;
}
interface CableRouteResetOperation { mapId: string; cableId: string; status: "pending" | "refresh-failed"; message?: string; }
interface RegionCreateOperation { mapId: string; label: string; status: "editing" | "saving" | "refresh-failed"; error: string | null; }
interface WiringEndpoint { physicalObjectId: string; connectionPointId: string; objectLabel: string; portLabel: string; }
interface WiringDraft { mapId: string; source: WiringEndpoint; draftWaypoints: MapCableRouteWaypoint[]; selectedWaypointIndex: number | null; }
interface WiringOperation extends WiringDraft { target: WiringEndpoint; canonicalResult?: PhysicalEndpointConnectionCreationDocument; error: string | null; }
type WiringState = { status: "idle" } | { status: "selecting-source"; mapId: string } | ({ status: "selecting-target" } & WiringDraft) | ({ status: "confirming" | "creating" | "route-saving" | "route-failed" | "refresh-failed" } & WiringOperation);

const view = (value: string | null): TopologyViewMode =>
  value === "physical" ? "physical" : "logical";
const savedMapViewKey = (value: SavedMapView): SavedMapViewKey =>
  value === "physical" ? "L1/PHYSICAL_OBJECT" : "L2/DEVICE";
const natural = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
const errorMessage = (_reason: unknown, fallback: string) => fallback;
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
  cableDeleteDataSource,
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
  const [objectSearch, setObjectSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [insertion, setInsertion] = useState<InsertionState | null>(null);
  const [contextAnchor, setContextAnchor] = useState<MapContextTarget | null>(null);
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
  const [regionMode, setRegionMode] = useState(false);
  const [showRegionReferenceOutlines, setShowRegionReferenceOutlines] = useState(true);
  const [regionDraft, setRegionDraft] = useState<MapRegionDraft | null>(null);
  const [regionCreate, setRegionCreate] = useState<RegionCreateOperation | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [authoritativePositionRevision, setAuthoritativePositionRevision] =
    useState(0);
  const [canonicalDeleteRevision, setCanonicalDeleteRevision] = useState(0);
  const [coordinateBridgeRevision, setCoordinateBridgeRevision] = useState(0);
  const [copiedBlueprintDisplayWidth, setCopiedBlueprintDisplayWidth] = useState<number>();
  const selectedMapId = useRef<string | null>(mapId);
  const deletedMapIds = useRef(new Set<string>());
  const mapListRequest = useRef(0);
  const insertionSequence = useRef(0);
  const latestActiveMap = useRef<SavedMap | null>(null);
  const latestPhysicalDocument = useRef<TopologyProjectionDocument | null>(null);
  const viewportCenter = useRef<(() => XYPosition) | null>(null);
  const consumedAddIntent = useRef<string | null>(null);
  const regionOperationSequence = useRef(0);

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
  const physicalRegionMode = regionMode && !legacy && Boolean(activeMap) && viewMode === "physical";
  const completeRegionDraft = useCallback(() => {
    setRegionDraft((current) => current?.status === 'drawing' && current.points.length >= 3 ? { ...current, status: 'completed' } : current);
    if (activeMap) setRegionCreate({ mapId: activeMap.map_ref.entity_id, label: '', status: 'editing', error: null });
  }, [activeMap]);
  const objectSearchResults = useMemo(() => {
    const query = objectSearch.trim().toLocaleLowerCase();
    if (viewMode !== "physical" || !query) return [];
    return document?.nodes
      .filter((node) => node.source_refs.some((ref) => ref.ref_type === "CANONICAL_FACT" && ref.entity_type === "PhysicalObject"))
      .map((node) => ({ node, label: displayNodeLabel(node) }))
      .filter((item) => item.label.toLocaleLowerCase().includes(query))
      .sort((left, right) => natural(left.label, right.label)) ?? [];
  }, [document, objectSearch, viewMode]);

  const selectedCableId = selection?.type === "node" ? cableIdForNode(selection.item) : null;
  const drawableSelectedCable = Boolean(
    selectedCableId && document && viewMode === "physical" && physicalCablePresentation(document).cables.some((item) => cableIdForNode(item.cable) === selectedCableId),
  );
  const selectedCableRoute = selectedCableId
    ? (activeMap?.cable_routes ?? []).find((route) => route.cable_ref.entity_id === selectedCableId)
    : undefined;

  useEffect(() => {
    if (!cableRouteEdit) return;
    if (viewMode !== "physical" || mapId !== cableRouteEdit.mapId || selectedCableId !== cableRouteEdit.cableId)
      setCableRouteEdit(null);
  }, [cableRouteEdit, mapId, selectedCableId, viewMode]);

  useEffect(() => {
    regionOperationSequence.current += 1;
    setRegionMode(false);
    setRegionDraft(null);
    setRegionCreate(null);
    setSelectedRegionId(null);
  }, [mapId, viewMode]);

  useEffect(() => {
    if (!physicalRegionMode) {
      regionOperationSequence.current += 1;
      setRegionDraft(null);
      setRegionCreate(null);
      setSelectedRegionId(null);
      return;
    }
    setSelection(null);
    setContextAnchor(null);
    setContinuationAnchor(null);
    setInsertion(null);
    setCableRouteEdit(null);
    setCableRouteReset(null);
    setWiring({ status: "idle" });
  }, [physicalRegionMode]);

  useEffect(() => {
    if (selectedRegionId && !activeMap?.regions.some((region) => region.region_ref.entity_id === selectedRegionId)) setSelectedRegionId(null);
  }, [activeMap, selectedRegionId]);

  useEffect(() => {
    if (!physicalRegionMode || regionDraft?.status !== 'drawing') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        regionOperationSequence.current += 1;
        setRegionDraft(null);
        setRegionCreate(null);
      } else if (event.key === 'Enter' && regionDraft.points.length >= 3) {
        event.preventDefault();
        completeRegionDraft();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [completeRegionDraft, physicalRegionMode, regionDraft]);

  const selectMap = useCallback(
    (id: string) => {
      insertionSequence.current += 1;
      selectedMapId.current = id;
      setSelection(null);
      setObjectSearch("");
      setSceneDocument(null);
      setInsertion(null);
      setContextAnchor(null);
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
    setObjectSearch("");
    setMap(null);
    setSceneDocument(null);
    setInsertion(null);
    setContextAnchor(null);
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
      (reason) => active && request === mapListRequest.current && setError(errorMessage(reason, t("map.loadFailed"))),
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
        active && setError(errorMessage(reason, t("map.loadFailed"))),
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
          setError(errorMessage(reason, t("map.loadFailed"))),
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
      setError(errorMessage(reason, t("map.createFailed")));
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
      setMapDeletion({ ...operation, status: "confirming", error: errorMessage(reason, t("map.deleteFailed")) });
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

  const setViewMode = (nextView: TopologyViewMode) => {
    setContextAnchor(null);
    setRegionMode(false);
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
    else if (wiring.status === "selecting-target") { const target = endpointFor(candidate, wiring.source.connectionPointId); if (target) setWiring({ ...wiring, status: "confirming", target, error: null }); }
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
    try { canonicalResult = await physicalEndpointConnectionWriteDataSource.createPhysicalEndpointConnection({ source: { kind: "CONNECTION_POINT", connection_point_id: operation.source.connectionPointId, member_index: 1 }, target: { kind: "CONNECTION_POINT", connection_point_id: operation.target.connectionPointId, member_index: 1 } }); }
    catch (reason) { if (selectedMapId.current === operation.mapId && viewMode === "physical") setWiring({ ...operation, error: errorMessage(reason, t("map.connectFailed")) }); return; }
    if (selectedMapId.current !== operation.mapId || viewMode !== "physical") return;
    await saveWiringRoute({ ...operation, canonicalResult });
  };
  const retryWiringRoute = async () => { if (wiring.status !== "route-failed") return; await saveWiringRoute(wiring); };
  const retryWiringRefresh = async () => { if (wiring.status !== "refresh-failed") return; const operation = wiring; try { if (await refreshWiringAfterRouteWrite(operation)) setWiring({ status: "idle" }); } catch { if (selectedMapId.current === operation.mapId && viewMode === "physical") setWiring(operation); } };

  const resolveInsertionPosition = async (
    id: string,
    anchor: XYPosition,
  ): Promise<{ position: XYPosition; displayWidth?: number } | null> => {
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
    const blueprint = candidates[0].attributes.blueprint_presentation;
    const displayWidth = blueprint
      ? clampBlueprintDisplayWidth(96, blueprint)
      : undefined;
    const position = nearestFreePosition(
      anchor,
      footprintDimensionsForProjectionNode(candidates[0], displayWidth),
      occupied,
    );
    return position && {
      position,
      ...(displayWidth === undefined ? {} : { displayWidth }),
    };
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
    let placement: { position: XYPosition; displayWidth?: number } | null;
    let preflightComplete = false;
    try {
      placement = await resolveInsertionPosition(id, operation.anchor);
      preflightComplete = true;
      if (
        request !== insertionSequence.current ||
        selectedMapId.current !== targetMapId
      )
        return;
      if (!placement) {
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
        placement.position.x,
        placement.position.y,
        ...(placement.displayWidth === undefined ? [] : [placement.displayWidth]),
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
                ? errorMessage(reason, t("map.addFailed"))
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
                error: errorMessage(reason, t("map.addRefreshFailed")),
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
      setError(errorMessage(reason, t("map.moveFailed")));
      try {
        await reloadMap(targetMapId);
      } catch {
        // The original persistence error remains the bounded user-facing failure.
      }
      if (selectedMapId.current === targetMapId)
        setAuthoritativePositionRevision((revision) => revision + 1);
    }
  };

  const persistBlueprintDisplayWidths = async (requests: Array<{ id: string; displayWidth: number }>) => {
    if (!savedMapDataSource || !mapId || viewMode !== "physical") return;
    const targetMapId = mapId;
    const positionKey = savedMapViewKey(viewMode);
    const writes = requests.flatMap(({ id, displayWidth }) => {
      const current = activeMap?.placements.find((placement) => placement.physical_object_ref.entity_id === id)?.positions[positionKey];
      const blueprint = (latestPhysicalDocument.current?.nodes ?? []).find((node) => physicalObjectIdForNode(node) === id)?.attributes.blueprint_presentation;
      return current && blueprint ? [{ id, current, width: clampBlueprintDisplayWidth(displayWidth, blueprint) }] : [];
    });
    if (!writes.length) return;
    try {
      for (const write of writes)
        await savedMapDataSource.movePosition(targetMapId, write.id, viewMode, write.current.x, write.current.y, write.width);
      if (selectedMapId.current === targetMapId) setMap((existing) => existing?.map_ref.entity_id === targetMapId ? {
        ...existing,
        placements: existing.placements.map((placement) => {
          const write = writes.find((item) => item.id === placement.physical_object_ref.entity_id);
          return write ? { ...placement, positions: { ...placement.positions, [positionKey]: { ...placement.positions[positionKey]!, display_width: write.width } } } : placement;
        }),
      } : existing);
    } catch (reason) {
      if (selectedMapId.current !== targetMapId) return;
      try { await reloadMap(targetMapId); } catch { /* preserve persistence error */ }
      throw reason;
    }
  };

  const resizeBlueprint = async (id: string, displayWidth: number) => {
    await persistBlueprintDisplayWidths([{ id, displayWidth }]);
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
      const placement = await resolveInsertionPosition(id, anchor);
      preflightComplete = true;
      if (selectedMapId.current !== targetMapId) return;
      if (!placement)
        throw new Error(t("view.empty.body"));
      await savedMapDataSource.addPlacement(
        targetMapId,
        id,
        placement.position.x,
        placement.position.y,
        ...(placement.displayWidth === undefined ? [] : [placement.displayWidth]),
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

  const beginCableRouteEdit = (requestedCableId = selectedCableId) => {
    if (!activeMap || !requestedCableId || viewMode !== "physical") return;
    const existing = (activeMap.cable_routes ?? []).find((route) => route.cable_ref.entity_id === requestedCableId);
    const copied = existing?.waypoints.map((point) => ({ ...point })) ?? [];
    setCableRouteEdit({ mapId: activeMap.map_ref.entity_id, cableId: requestedCableId, originalRoutePresent: Boolean(existing), originalWaypoints: copied, draftWaypoints: copied, selectedWaypointIndex: null, status: "editing", error: null });
  };
  const saveCableRoute = async () => {
    if (!savedMapDataSource || !cableRouteEdit || cableRouteEdit.status === "saving") return;
    const operation = cableRouteEdit;
    setCableRouteEdit({ ...operation, status: "saving", error: null });
    try { await savedMapDataSource.setCableRoute(operation.mapId, operation.cableId, operation.draftWaypoints); }
    catch {
      if (selectedMapId.current === operation.mapId) setCableRouteEdit((current) => current?.mapId === operation.mapId && current.cableId === operation.cableId ? { ...current, status: "editing", error: t("map.routeEditorFailed") } : current);
      return;
    }
    try {
      if (await reloadMap(operation.mapId) && selectedMapId.current === operation.mapId) setCableRouteEdit(null);
    } catch {
      if (selectedMapId.current === operation.mapId) setCableRouteEdit((current) => current?.mapId === operation.mapId && current.cableId === operation.cableId ? { ...current, status: "refresh-failed", error: t("map.routeSavedRefreshFailed") } : current);
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
  const resetCableRoute = async (requestedCableId = selectedCableId) => {
    if (!savedMapDataSource || !activeMap || !requestedCableId || !(activeMap.cable_routes ?? []).some((route) => route.cable_ref.entity_id === requestedCableId)) return;
    const operation = { mapId: activeMap.map_ref.entity_id, cableId: requestedCableId, status: "pending" as const };
    setCableRouteReset(operation);
    try { await savedMapDataSource.deleteCableRoute(operation.mapId, operation.cableId); }
    catch (reason) { if (selectedMapId.current === operation.mapId) setCableRouteReset(null); setError(errorMessage(reason, t("map.routeEditorFailed"))); return; }
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

  const saveRegion = async () => {
    if (!savedMapDataSource || !activeMap || !regionCreate || regionCreate.status !== 'editing' || regionDraft?.status !== 'completed') return;
    const label = regionCreate.label.trim();
    if (!label) {
      setRegionCreate((current) => current?.mapId === regionCreate.mapId ? { ...current, error: t('map.regionLabelRequired') } : current);
      return;
    }
    const operation = regionCreate;
    const request = ++regionOperationSequence.current;
    const region = {
      label,
      points: regionDraft.points.map(({ x, y }) => ({ x, y })),
      label_position: null,
      style: defaultMapRegionStyle(),
      z_order: nextMapRegionZOrder(activeMap.regions),
    };
    setRegionCreate((current) => current?.mapId === operation.mapId ? { ...current, status: 'saving', error: null } : current);
    try {
      await savedMapDataSource.createRegion(operation.mapId, region);
    } catch {
      if (request === regionOperationSequence.current && selectedMapId.current === operation.mapId)
        setRegionCreate((current) => current?.mapId === operation.mapId ? { ...current, status: 'editing', error: t('map.regionSaveFailed') } : current);
      return;
    }
    try {
      const refreshed = await reloadMap(operation.mapId);
      if (request !== regionOperationSequence.current || selectedMapId.current !== operation.mapId) return;
      if (refreshed) {
        setRegionDraft(null);
        setRegionCreate(null);
      } else {
        setRegionCreate((current) => current?.mapId === operation.mapId ? { ...current, status: 'refresh-failed', error: t('map.regionSavedRefreshFailed') } : current);
      }
    } catch {
      if (request === regionOperationSequence.current && selectedMapId.current === operation.mapId)
        setRegionCreate((current) => current?.mapId === operation.mapId ? { ...current, status: 'refresh-failed', error: t('map.regionSavedRefreshFailed') } : current);
    }
  };

  const retryRegionRefresh = async () => {
    if (!regionCreate || regionCreate.status !== 'refresh-failed') return;
    const operation = regionCreate;
    const request = ++regionOperationSequence.current;
    setRegionCreate({ ...operation, status: 'saving', error: null });
    try {
      const refreshed = await reloadMap(operation.mapId);
      if (request !== regionOperationSequence.current || selectedMapId.current !== operation.mapId) return;
      if (refreshed) {
        setRegionDraft(null);
        setRegionCreate(null);
      } else {
        setRegionCreate({ ...operation, status: 'refresh-failed', error: t('map.regionSavedRefreshFailed') });
      }
    } catch {
      if (request === regionOperationSequence.current && selectedMapId.current === operation.mapId)
        setRegionCreate({ ...operation, status: 'refresh-failed', error: t('map.regionSavedRefreshFailed') });
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
  const selectedBlueprint = useMemo(() => {
    const id = physicalObjectIdForSelection(selection);
    return id ? nodeForPhysicalObject(document?.nodes ?? [], id)?.attributes.blueprint_presentation : undefined;
  }, [document, selection]);
  const selectedBlueprintSize = !legacy && viewMode === "physical" && selectedPlacementPosition && selectedBlueprint
    ? { displayWidth: selectedPlacementPosition.display_width ?? DEFAULT_BLUEPRINT_DISPLAY_WIDTH, copiedDisplayWidth: copiedBlueprintDisplayWidth }
    : undefined;
  const applySizeToSameBlueprint = async () => {
    if (!selectedBlueprint || !activeMap || !document) return;
    const blueprintId = selectedBlueprint.blueprint_ref.entity_id;
    const selectedWidth = selectedPlacementPosition?.display_width ?? DEFAULT_BLUEPRINT_DISPLAY_WIDTH;
    const ids = activeMap.placements.flatMap((placement) => {
      const id = placement.physical_object_ref.entity_id;
      const presentation = nodeForPhysicalObject(document.nodes, id)?.attributes.blueprint_presentation;
      return presentation?.blueprint_ref.entity_id === blueprintId && placement.positions["L1/PHYSICAL_OBJECT"] ? [id] : [];
    });
    await persistBlueprintDisplayWidths(ids.map((id) => ({ id, displayWidth: selectedWidth })));
  };
  const receiveViewportCenter = useCallback(
    (getter: (() => XYPosition) | null) => {
      viewportCenter.current = getter;
      setCoordinateBridgeRevision((revision) => revision + 1);
    },
    [],
  );
  const contextBusy = wiring.status !== "idle" || Boolean(cableRouteEdit) || Boolean(insertion) || Boolean(mapDeletion) || Boolean(mapOperation);
  const openPortContext = (port: { physicalObjectId: string; connectionPointId: string; label: string }, screen: XYPosition) => {
    if (contextBusy || !physicalObjectDetailsDataSource) return;
    setSelection((current) => document?.nodes.find((node) => physicalObjectIdForNode(node) === port.physicalObjectId) ? { type: "node", item: document.nodes.find((node) => physicalObjectIdForNode(node) === port.physicalObjectId)! } : current);
    setContextAnchor({ kind: "port", objectId: port.physicalObjectId, connectionPointId: port.connectionPointId, label: port.label, screen, action: "loading" });
    void physicalObjectDetailsDataSource.loadPhysicalObjectDetails(port.physicalObjectId).then((details) => {
      const point = details.connection_points.find((item) => item.connection_point_ref.entity_id === port.connectionPointId);
      const attachments = point?.external_physical_attachments;
      const action: MapContextTarget extends infer _ ? "connect" | "unavailable" | { disconnectConnectionId: string } : never = point?.cardinality === 1 && Array.isArray(attachments) && attachments.length === 0 ? "connect" : point?.cardinality === 1 && attachments?.length === 1 ? { disconnectConnectionId: attachments[0].connection_ref.entity_id } : "unavailable";
      setContextAnchor((current) => current?.kind === "port" && current.connectionPointId === port.connectionPointId ? { ...current, action } : current);
    }, () => setContextAnchor((current) => current?.kind === "port" && current.connectionPointId === port.connectionPointId ? { ...current, action: "unavailable" } : current));
  };
  const connectFromPort = (physicalObjectId: string, connectionPointId: string) => {
    const source = endpointFor({ physicalObjectId, connectionPointId, label: "" });
    if (source && activeMap && wiring.status === "idle" && !cableRouteEdit) setWiring({ status: "selecting-target", mapId: activeMap.map_ref.entity_id, source, draftWaypoints: [], selectedWaypointIndex: null });
  };
  const disconnectPort = async (connectionId: string, label: string) => {
    if (!physicalEndpointConnectionWriteDataSource?.deleteExternalPhysicalConnection || contextBusy || !window.confirm(t("map.context.disconnectConfirm", { name: label }))) return;
    await physicalEndpointConnectionWriteDataSource.deleteExternalPhysicalConnection(connectionId);
    if (mapId) { await reloadMap(mapId); setCanonicalDeleteRevision((revision) => revision + 1); }
  };
  const deletePhysicalObject = async (id: string) => {
    if (!physicalObjectDeleteDataSource || !mapId) return;
    const targetMapId = mapId;
    setMapOperation({ kind: "delete", id, mapId: targetMapId, status: "pending" });
    try { await physicalObjectDeleteDataSource.deletePhysicalObject(id); }
    catch (reason) { if (selectedMapId.current === targetMapId) setMapOperation(null); throw reason; }
    try {
      await reloadMap(targetMapId);
      if (selectedMapId.current === targetMapId) { setCanonicalDeleteRevision((revision) => revision + 1); setMapOperation(null); setSelection(null); }
    } catch {
      if (selectedMapId.current === targetMapId) setMapOperation({ kind: "delete", id, mapId: targetMapId, status: "refresh-failed", message: t("map.deleteRefreshFailed") });
    }
  };
  const deleteCable = async (id: string) => {
    if (!cableDeleteDataSource || !mapId) return;
    const targetMapId = mapId;
    setMapOperation({ kind: "delete", id, mapId: targetMapId, status: "pending" });
    try { await cableDeleteDataSource.deleteCable(id); }
    catch (reason) { if (selectedMapId.current === targetMapId) setMapOperation(null); throw reason; }
    try {
      await reloadMap(targetMapId);
      if (selectedMapId.current === targetMapId) { setCanonicalDeleteRevision((revision) => revision + 1); setMapOperation(null); setSelection(null); }
    } catch {
      if (selectedMapId.current === targetMapId) setMapOperation({ kind: "delete", id, mapId: targetMapId, status: "refresh-failed", message: t("map.deleteRefreshFailed") });
    }
  };

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
            <button type="button" onClick={() => activeMap && setWiring({ status: "selecting-source", mapId: activeMap.map_ref.entity_id })} disabled={!activeMap || viewMode !== "physical" || physicalRegionMode || !document || !physicalEndpointConnectionWriteDataSource}>{t("map.connectPorts")}</button>
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
        {!legacy && activeMap && viewMode === "physical" && (
          <button type="button" aria-pressed={physicalRegionMode} onClick={() => setRegionMode((active) => !active)}>
            {t("map.regions")}
          </button>
        )}
      </div>

      {!legacy && activeMap && viewMode === "physical" && !physicalRegionMode && (
        <section className="map-object-search" aria-label={t("map.objectSearch")}>
          <label>
            {t("map.objectSearch")}
            <input
              type="search"
              value={objectSearch}
              onChange={(event) => setObjectSearch(event.target.value)}
              placeholder={t("map.objectSearchPlaceholder")}
            />
          </label>
          {objectSearch.trim() && (
            <div className="map-object-search__results" role="listbox" aria-label={t("map.objectSearchResults")}>
              {objectSearchResults.length === 0 ? <p>{t("map.objectSearchEmpty")}</p> : objectSearchResults.map(({ node, label }) => (
                <button key={node.id} type="button" role="option" aria-selected={selection?.type === "node" && selection.item.id === node.id} title={label} onClick={() => setSelection({ type: "node", item: node })}>{label}</button>
              ))}
            </div>
          )}
        </section>
      )}

      {physicalRegionMode && (
        <section className="map-region-mode" aria-label={t("map.regions")}>
          <span>{t("map.regionReference")}</span>
          <button type="button" aria-pressed={showRegionReferenceOutlines} onClick={() => setShowRegionReferenceOutlines(true)}>{t("map.regionOutlines")}</button>
          <button type="button" aria-pressed={!showRegionReferenceOutlines} onClick={() => setShowRegionReferenceOutlines(false)}>{t("map.regionHideObjects")}</button>
          <button type="button" onClick={() => { regionOperationSequence.current += 1; setSelectedRegionId(null); setRegionDraft({ status: 'drawing', points: [] }); setRegionCreate(null); }}>{t("map.regionNew")}</button>
          <MapRegionTree regions={activeMap?.regions ?? []} selectedRegionId={selectedRegionId} onSelect={(regionId) => setSelectedRegionId((current) => current === regionId ? null : regionId)} />
          {regionDraft?.status === 'drawing' && <>
            <span>{t("map.regionPoints", { count: regionDraft.points.length })}</span>
            <button type="button" disabled={regionDraft.points.length < 3} onClick={completeRegionDraft}>{t("map.regionDone")}</button>
            <button type="button" onClick={() => { regionOperationSequence.current += 1; setRegionDraft(null); setRegionCreate(null); }}>{t("map.cancel")}</button>
          </>}
          {regionDraft?.status === 'completed' && <>
            {regionCreate && <>
              <label>
                {t('map.regionLabel')}
                <input value={regionCreate.label} disabled={regionCreate.status !== 'editing'} onChange={(event) => setRegionCreate((current) => current ? { ...current, label: event.target.value, error: null } : current)} />
              </label>
              {regionCreate.error && <span role="alert">{regionCreate.error}</span>}
              {regionCreate.status === 'saving' && <span role="status">{t('map.regionSaving')}</span>}
              {regionCreate.status === 'editing' && <button type="button" onClick={() => void saveRegion()}>{t('map.save')}</button>}
              {regionCreate.status === 'refresh-failed' && <button type="button" onClick={() => void retryRegionRefresh()}>{t('map.retryRefresh')}</button>}
            </>}
            <button type="button" disabled={regionCreate?.status === 'saving'} onClick={() => { regionOperationSequence.current += 1; setRegionDraft(null); setRegionCreate(null); }}>{t("map.cancel")}</button>
          </>}
        </section>
      )}

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
        {(wiring.status === "confirming" || wiring.status === "creating") && <><p>{t("map.wiring.sourceLabel", { object: wiring.source.objectLabel, port: wiring.source.portLabel })}</p><p>{t("map.wiring.destinationLabel", { object: wiring.target.objectLabel, port: wiring.target.portLabel })}</p><p>{t("map.wiring.points", { count: wiring.draftWaypoints.length })}</p>{wiring.error && <p role="alert">{wiring.error}</p>}<button type="button" disabled={wiring.status === "creating"} onClick={() => setWiring({ status: "selecting-target", mapId: wiring.mapId, source: wiring.source, draftWaypoints: wiring.draftWaypoints, selectedWaypointIndex: wiring.selectedWaypointIndex })}>{t("map.back")}</button><button type="button" disabled={wiring.status === "creating"} onClick={() => setWiring({ status: "idle" })}>{t("map.cancel")}</button><button type="button" disabled={wiring.status === "creating"} onClick={() => void createWiring()}>{wiring.status === "creating" ? t("map.creating") : wiring.error ? t("action.retry") : t("map.createCable")}</button></>}
        {wiring.status === "route-saving" && <p role="status">{t("map.savingRoute")}</p>}
        {wiring.status === "route-failed" && <><p role="alert">{t("map.routeFailed")}</p><button type="button" onClick={() => void retryWiringRoute()}>{t("map.retrySaveRoute")}</button><button type="button" onClick={() => setWiring({ status: "idle" })}>{t("action.close")}</button></>}
        {wiring.status === "refresh-failed" && <><p role="alert">{t("map.wiringRefreshFailed")}</p><button type="button" onClick={() => void retryWiringRefresh()}>{t("map.retryRefresh")}</button></>}
      </div></section>}
      {contextAnchor && viewMode === "physical" && !contextBusy && <MapContextMenu
        target={contextAnchor}
        onClose={() => setContextAnchor(null)}
        onAdd={(anchor) => openInsertion(anchor)}
        onSetLock={(id, locked) => void setPlacementLock(id, locked)}
        onRemove={(id) => void remove(id)}
        onEditRoute={(id) => beginCableRouteEdit(id)}
        onResetRoute={(id) => void resetCableRoute(id)}
        onConnectFromPort={connectFromPort}
        onDisconnect={(connectionId, label) => void disconnectPort(connectionId, label).catch((reason) => setError(errorMessage(reason, t("map.disconnectFailed"))))}
        onDeleteObject={(id, label) => { if (window.confirm(t("map.context.deleteObjectConfirm", { name: label }))) void deletePhysicalObject(id).catch((reason) => setError(errorMessage(reason, t("map.deleteObjectFailed")))); }}
        onDeleteCable={(id, label) => { if (window.confirm(t("map.context.deleteCableConfirm", { name: label }))) void deleteCable(id).catch((reason) => setError(errorMessage(reason, t("map.deleteCableFailed")))); }}
      />}
      {error && <p role="alert">{error}</p>}
      {document &&
        params.get("focus") &&
        !nodeForPhysicalObject(document.nodes, params.get("focus")!) && (
          <p>
            {t("map.objectMissing")}
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
        </section>
      )}
      {(legacy || activeMap) && (
        <>
          {!physicalRegionMode && <TraceCommandBar
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
                setTraceViewNotice(t("map.tracePhysical"));
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("view", "physical");
                  return next;
                });
              }
            }}
          />}
          {!physicalRegionMode && traceViewNotice && viewMode === "physical" && <p className="map-page__trace-notice" role="status">{traceViewNotice}</p>}
          <section className="map-page__canvas">
            {!document && <ViewState kind="loading" />}
            {document && (
              <ReactFlowProvider>
                <TopologyCanvas
                  document={document}
                  selection={physicalRegionMode ? null : selection}
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
                  onPhysicalNodeDragStop={!legacy && !physicalRegionMode ? move : undefined}
                  onBlueprintDisplayResize={!legacy && viewMode === "physical" && !physicalRegionMode ? (id, displayWidth) => {
                    void resizeBlueprint(id, displayWidth).catch((reason) => setError(errorMessage(reason, t("map.sizeFailed"))));
                  } : undefined}
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
                    !physicalRegionMode && viewMode === "physical" ? activeMap?.cable_routes : undefined
                  }
                  cableRouteDraft={!physicalRegionMode && cableRouteEdit ? { cableId: cableRouteEdit.cableId, waypoints: cableRouteEdit.draftWaypoints, selectedWaypointIndex: cableRouteEdit.selectedWaypointIndex, onWaypointSelect: (index) => setCableRouteEdit((current) => current ? { ...current, selectedWaypointIndex: index } : current), onWaypointMove: (index, waypoint) => setCableRouteEdit((current) => current ? { ...current, draftWaypoints: current.draftWaypoints.map((point, pointIndex) => pointIndex === index ? waypoint : point) } : current), onWaypointInsert: (index, waypoint) => setCableRouteEdit((current) => current ? { ...current, draftWaypoints: [...current.draftWaypoints.slice(0, index), waypoint, ...current.draftWaypoints.slice(index)], selectedWaypointIndex: index } : current) } : undefined}
                  wiringRoute={!physicalRegionMode && wiring.status !== "idle" && wiring.status !== "selecting-source" ? { source: wiring.source, target: wiring.status === "selecting-target" ? undefined : wiring.target, waypoints: wiring.draftWaypoints, selectedWaypointIndex: wiring.selectedWaypointIndex, onWaypointSelect: (index) => setWiring((current) => current.status !== "idle" && current.status !== "selecting-source" ? { ...current, selectedWaypointIndex: index } : current), onWaypointMove: (index, waypoint) => setWiring((current) => current.status !== "idle" && current.status !== "selecting-source" ? { ...current, draftWaypoints: current.draftWaypoints.map((point, pointIndex) => pointIndex === index ? waypoint : point) } : current) } : undefined}
                  physicalPortStates={physicalRegionMode ? undefined : physicalPortStates}
                  wiringHighlightedConnectionMemberIds={wiringInternalContinuity.members}
                  wiringContinuationConnectionPointIds={wiringInternalContinuity.points}
                  onPhysicalPortClick={!physicalRegionMode && (wiring.status === "selecting-source" || wiring.status === "selecting-target") ? onPhysicalPortClick : undefined}
                  onViewportCenterReady={
                    viewMode === "physical" ? receiveViewportCenter : undefined
                  }
                  onPhysicalPaneContextMenu={
                    viewMode === "physical" && !physicalRegionMode
                      ? (anchor, screen) => !contextBusy && setContextAnchor({ kind: "empty", anchor, screen })
                      : undefined
                  }
                  onPhysicalNodeContextMenu={viewMode === "physical" && !physicalRegionMode ? (node, screen) => {
                    if (contextBusy) return;
                    const id = physicalObjectIdForNode(node); if (!id) return;
                    setSelection({ type: "node", item: node });
                    setContextAnchor({ kind: "object", id, label: displayNodeLabel(node), locked: Boolean(activeMap?.placements.find((placement) => placement.physical_object_ref.entity_id === id)?.positions["L1/PHYSICAL_OBJECT"]?.locked), screen });
                  } : undefined}
                  onPhysicalCableContextMenu={viewMode === "physical" && !physicalRegionMode ? (node, screen) => {
                    if (contextBusy) return;
                    const id = cableIdForNode(node); if (!id) return;
                    setSelection({ type: "node", item: node });
                    setContextAnchor({ kind: "cable", id, label: displayNodeLabel(node), hasRoute: Boolean(activeMap?.cable_routes?.some((route) => route.cable_ref.entity_id === id)), screen });
                  } : undefined}
                  onPhysicalPortContextMenu={viewMode === "physical" && !physicalRegionMode ? openPortContext : undefined}
                  onPaneClick={(anchor) => {
                    if (physicalRegionMode) return;
                    setContextAnchor(null);
                    setSelection(null);
                    setWiring((current) => current.status === "selecting-target" ? { ...current, draftWaypoints: [...current.draftWaypoints, anchor], selectedWaypointIndex: current.draftWaypoints.length } : current);
                  }}
                  onContinuationClickAnchor={!physicalRegionMode ? (continuationId, anchor) =>
                    mapId &&
                    setContinuationAnchor({ continuationId, mapId, anchor })
                  : undefined}
                  regions={viewMode === "physical" ? activeMap?.regions : undefined}
                  selectedRegionId={physicalRegionMode ? selectedRegionId : undefined}
                  regionMode={physicalRegionMode ? {
                    showReferenceOutlines: showRegionReferenceOutlines,
                    draft: regionDraft ?? undefined,
                    onDraftPoint: (point) => setRegionDraft((current) => current?.status === 'drawing' ? { ...current, points: [...current.points, point] } : current),
                    onCompleteDraft: completeRegionDraft,
                  } : undefined}
                />
              </ReactFlowProvider>
            )}
          </section>
        </>
      )}
      <QuickInspector
        document={document}
        selection={physicalRegionMode ? null : selection}
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
        blueprintSize={selectedBlueprintSize}
        onApplyBlueprintSize={selectedBlueprintSize && physicalObjectIdForSelection(selection) ? (displayWidth) => resizeBlueprint(physicalObjectIdForSelection(selection)!, displayWidth) : undefined}
        onCopyBlueprintSize={selectedBlueprintSize ? () => setCopiedBlueprintDisplayWidth(selectedBlueprintSize.displayWidth) : undefined}
        onApplyCopiedBlueprintSize={selectedBlueprintSize && copiedBlueprintDisplayWidth !== undefined && physicalObjectIdForSelection(selection) ? () => resizeBlueprint(physicalObjectIdForSelection(selection)!, copiedBlueprintDisplayWidth) : undefined}
        onApplyBlueprintSizeToSameBlueprint={selectedBlueprintSize ? applySizeToSameBlueprint : undefined}
        mapOperation={mapOperation?.mapId === mapId ? mapOperation : null}
        onRetryMapRefresh={retryMapRefresh}
      />
    </main>
  );
}
