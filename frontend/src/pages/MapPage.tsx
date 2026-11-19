import { GridObjectSequenceControls } from '../components/GridObjectSequenceControls';
import { LocationSettingsDialog } from '../components/LocationSettingsDialog';
import { LocationGridSorting } from '../components/LocationGridSorting';
import { gridTables } from '../topology/uniformGridPresentation';
import { useLocationGridArrangement } from '../components/useLocationGridArrangement';
import { AutomaticLocationControls } from '../components/AutomaticLocationControls';
import { RuntimePortTypes } from '../components/RuntimePortTypes';
import { ReactFlowProvider, type XYPosition } from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  MapInsertionPicker,
  mapCandidateChoices,
} from "../components/MapInsertionPicker";
import { PhysicalFaceSelect } from '../components/PhysicalFaceControls';
import { blueprintFace, cableEndpointIds, resolveFaces, selectedCableIdFor } from '../topology/physicalFaces';
import type { FaceOverride, FaceTarget } from '../topology/savedMapTypes';
import { QuickInspector } from "../components/QuickInspector";
import { MapContextMenu, type MapContextTarget } from "../components/MapContextMenu";
import type { CableReconnectDataSource } from "../topology/apiCableReconnectDataSource";
import { CableReconnectDialog } from "../components/CableReconnectDialog";
import { CableRenameDialog } from "../components/CableRenameDialog";
import { BulkCableCreateDialog } from "../components/BulkCableCreateDialog";
import { BulkCableDeleteDialog } from "../components/BulkCableDeleteDialog";
import { TraceCommandBar } from "../components/TraceCommandBar";
import { TopologyCanvas } from "../components/TopologyCanvas";
import { MapObjectSearchPanel } from "../components/MapObjectSearchPanel";
import { SavedMapApiError } from "../topology/apiSavedMapDataSource";
import {
  PresentationAuthoringPanel,
  type TextAnnotationDeleteOperation,
  type TextAnnotationOperation,
} from "../components/PresentationAuthoringPanel";
import { perfMark } from "../perfMarks";
import { ViewState } from "../components/ViewState";
import { physicalTraceOverlayFor } from "../topology/interfacePhysicalTraceOverlay";
import {
  footprintDimensionsForProjectionNode,
  centeredPositionForFootprint,
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
  MapTextAnnotation,
  MapLocationDirectElementRef,
  MapLocationDirectElementChoice,
} from "../topology/savedMapTypes";
import { DEFAULT_BLUEPRINT_DISPLAY_WIDTH, clampBlueprintDisplayWidth, minimumBlueprintDisplayWidth } from "../topology/blueprintDisplaySize";
import { directlyAttachedCableIds } from "../topology/presentationScene";
import type {
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologySelection,
} from "../topology/types";
import type { PhysicalEndpointConnectionWriteDataSource } from "../topology/physicalEndpointConnectionWriteTypes";
import type { CableLabelDataSource, CableNamingInput } from "../topology/cableLabelTypes";
import { isHistoricalCableLabelReuseConfirmationStale, isHistoricalCableLabelReuseRequired } from "../topology/historicalCableLabelReuse";
import { CableNamingFields } from "../components/CableNamingFields";
import { isAvailablePhysicalPort } from "../topology/physicalPortAvailability";
import { displayNodeLabel } from "../topology/presentation";
import { locationDescendantIds } from "../topology/locationFocus";
import type { LocationDataSource, LocationDocument } from "../topology/locationTypes";
import { useI18n } from "../i18n";

export { mapCandidateChoices } from "../components/MapInsertionPicker";

interface MapPageProps {
  dataSource: TopologyDataSource;
  /** Retained for callers that share App wiring; L1 object trace does not use it. */
  deviceDetailsDataSource?: DeviceDetailsDataSource;
  savedMapDataSource?: SavedMapDataSource;
  locationDataSource?: LocationDataSource;
  catalogInventoryDataSource?: CatalogInventoryDataSource;
  physicalObjectDeleteDataSource?: PhysicalObjectDeleteDataSource;
  cableReconnectDataSource?: CableReconnectDataSource;
  cableDeleteDataSource?: CableDeleteDataSource;
  physicalObjectDetailsDataSource?: PhysicalObjectDetailsDataSource;
  physicalEndpointConnectionWriteDataSource?: PhysicalEndpointConnectionWriteDataSource;
  cableLabelDataSource?: CableLabelDataSource;
  traceDataSource?: PhysicalObjectL1TraceDataSource;
  topologyLayoutStore?: TopologyLayoutStore;
}

interface LoadedSceneDocument {
  sceneKey: string;
  document: TopologyProjectionDocument;
}
interface InsertionState {
  mapId: string;
  variantId: string;
  anchor: XYPosition;
  inventory: CatalogInventoryDocument | null;
  status: "loading" | "ready" | "resolving" | "saving" | "saved-refresh-failed";
  error: string | null;
  requestedObjectId?: string;
  anchorIsObjectCenter?: boolean;
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
interface CableRenameState { cableId: string; fallback: string; userLabel: string | null; }
interface PresentationVariantCreateOperation {
  mapId: string;
  sourceVariantId: string;
  sourceVariantName: string;
  name: string;
  status: "editing" | "creating";
  error: string | null;
}
interface PresentationVariantDeletionOperation {
  mapId: string;
  variantId: string;
  variantName: string;
  primaryVariantId: string;
  status: "confirming" | "deleting";
  error: string | null;
}
interface CreationRefreshOperation { mapId: string; variantId: string; status: "refresh-failed"; }
interface WiringEndpoint { physicalObjectId: string; connectionPointId: string; objectLabel: string; portLabel: string; }
interface WiringDraft { mapId: string; source: WiringEndpoint; }
interface WiringOperation extends WiringDraft { target: WiringEndpoint; naming: CableNamingInput; error: string | null; }
type WiringState = { status: "idle" } | { status: "selecting-source"; mapId: string } | ({ status: "selecting-target" } & WiringDraft) | ({ status: "confirming" | "creating" | "refresh-failed" } & WiringOperation);
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

function MapToolbarDropdown({ label, value, options, onChange }: { label: string; value: string; options: readonly { value: string; label: string }[]; onChange(value: string): void }) {
  const [open, setOpen] = useState(false);
  const [menuBounds, setMenuBounds] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.value === value);
  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const updateMenuBounds = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 5;
      const margin = 8;
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const placeAbove = below < 120 && above > below;
      const maxHeight = Math.max(0, Math.min(240, placeAbove ? above : below));
      const width = Math.min(rect.width, window.innerWidth - 2 * margin);
      setMenuBounds({
        top: placeAbove ? rect.top - gap - maxHeight : rect.bottom + gap,
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        width,
        maxHeight,
      });
    };
    updateMenuBounds();
    window.addEventListener("resize", updateMenuBounds);
    window.addEventListener("scroll", updateMenuBounds, true);
    return () => {
      window.removeEventListener("resize", updateMenuBounds);
      window.removeEventListener("scroll", updateMenuBounds, true);
    };
  }, [open]);
  useEffect(() => {
    const selectProgrammatically = () => {
      const nextValue = trigger.current?.value;
      if (nextValue && options.some((item) => item.value === nextValue)) onChange(nextValue);
    };
    const element = trigger.current;
    element?.addEventListener("change", selectProgrammatically);
    return () => element?.removeEventListener("change", selectProgrammatically);
  }, [onChange, options]);
  return <div className="map-toolbar-dropdown" ref={root} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }}>
    <button type="button" ref={trigger} value={value} className="map-toolbar-dropdown__trigger map-page__select" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>{selected?.label ?? "—"}</span><span aria-hidden="true">⌄</span></button>
    {open && menuBounds && createPortal(<div ref={menu} className="map-toolbar-dropdown__menu" role="listbox" aria-label={label} style={menuBounds}>{options.map((item) => <button key={item.value} type="button" role="option" aria-selected={item.value === value} onClick={() => { onChange(item.value); setOpen(false); }}>{item.label}</button>)}</div>, document.body)}
  </div>;
}

function MapPageContent({
  dataSource,
  savedMapDataSource,
  locationDataSource,
  catalogInventoryDataSource,
  physicalObjectDeleteDataSource,
  cableReconnectDataSource,
  cableDeleteDataSource,
  physicalObjectDetailsDataSource,
  physicalEndpointConnectionWriteDataSource,
  cableLabelDataSource,
  traceDataSource,
}: MapPageProps) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const mapId = params.get("map");
  const variantId = params.get("variant");
  const addIntent = mapId ? params.get("add") : null;
  const viewMode = view(params.get("view"));
  const [maps, setMaps] = useState<SavedMapSummary[] | null>(null);
  const [catalogInventory, setCatalogInventory] =
    useState<CatalogInventoryDocument | null>(null);
  const [map, setMap] = useState<SavedMap | null>(null);
  const [faceBusy, setFaceBusy] = useState(false);
  const [locations, setLocations] = useState<LocationDocument[] | null>(null);
  const [locationConfigId, setLocationConfigId] = useState<string | null>(null);
  const [locationConfigVisible, setLocationConfigVisible] = useState<MapLocationDirectElementRef[]>([]);
  const [directLocationChoices, setDirectLocationChoices] = useState<MapLocationDirectElementChoice[] | null>(null);
  const [locationStateBusy, setLocationStateBusy] = useState(false);
  const [sceneDocument, setSceneDocument] = useState<LoadedSceneDocument | null>(
    null,
  );
  const [logicalDocument, setLogicalDocument] =
    useState<TopologyProjectionDocument | null>(null);
  const [traceArtifact, setTraceArtifact] =
    useState<PhysicalObjectL1TraceArtifact | null>(null);
  const [selectedTraceBranchId, setSelectedTraceBranchId] = useState<string | null>(null);
  const [traceViewNotice, setTraceViewNotice] = useState<string | null>(null);
  const [selection, setSelection] = useState<TopologySelection>(null);
  const traceScope = useMemo(() => ({}), [mapId, variantId, viewMode]);
  const currentTraceScope = useRef(traceScope);
  currentTraceScope.current = traceScope;
  const clearTrace = useCallback(() => {
    setTraceArtifact(null);
    setSelectedTraceBranchId(null);
    setTraceViewNotice(null);
  }, []);
  useLayoutEffect(clearTrace, [mapId, variantId, clearTrace]);
  useLayoutEffect(() => {
    if (viewMode === 'logical') clearTrace();
    setSelection(current => selectedCableIdFor(current) ? null : current);
  }, [traceScope, viewMode, clearTrace]);
  const [utilitySection, setUtilitySection] = useState<"layout" | "tools" | null>(null);
  const [viewportFitRevision, setViewportFitRevision] = useState(0);
  const [objectSearch, setObjectSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [presentationVariantCreate, setPresentationVariantCreate] = useState<PresentationVariantCreateOperation | null>(null);
  const [presentationVariantCreationRefresh, setPresentationVariantCreationRefresh] = useState<CreationRefreshOperation | null>(null);
  const [presentationVariantDeletion, setPresentationVariantDeletion] = useState<PresentationVariantDeletionOperation | null>(null);
  const [variantDeletion, setVariantDeletion] = useState<{ mapId: string; primaryVariantId: string; status: "refreshing" | "refresh-failed" } | null>(null);
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
  const [cableRename, setCableRename] = useState<CableRenameState | null>(null);
  const [wiringHistoricalCandidate, setWiringHistoricalCandidate] = useState<string | null>(null);
  const [wiring, setWiring] = useState<WiringState>({ status: "idle" });
  const [showAllVirtualChannels, setShowAllVirtualChannels] = useState(false);
  const [reconnectCableId, setReconnectCableId] = useState<string | null>(null);
  useLayoutEffect(() => setReconnectCableId(null), [traceScope]);
  const [bulkSourceId, setBulkSourceId] = useState<string | null>(null);
  useLayoutEffect(() => setBulkSourceId(null), [traceScope]);
  const [bulkDeleteSourceId, setBulkDeleteSourceId] = useState<string | null>(null);
  useLayoutEffect(() => setBulkDeleteSourceId(null), [traceScope]);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [selectedTextAnnotationId, setSelectedTextAnnotationId] = useState<string | null>(null);
  const [textAnnotationEdit, setTextAnnotationEdit] = useState<TextAnnotationOperation | null>(null);
  const [textAnnotationDeletion, setTextAnnotationDeletion] = useState<TextAnnotationDeleteOperation | null>(null);
  const [authoritativePositionRevision, setAuthoritativePositionRevision] =
    useState(0);
  const [canonicalDeleteRevision, setCanonicalDeleteRevision] = useState(0);
  const [coordinateBridgeRevision, setCoordinateBridgeRevision] = useState(0);
  const [copiedBlueprintDisplayWidth, setCopiedBlueprintDisplayWidth] = useState<number>();
  const [blueprintSizeDialog, setBlueprintSizeDialog] = useState<{ id: string; draft: string } | null>(null);
  const [blueprintSizePending, setBlueprintSizePending] = useState(false);
  const [blueprintSizeError, setBlueprintSizeError] = useState<string | null>(null);
  const selectedMapId = useRef<string | null>(mapId);
  const selectedVariantId = useRef<string | null>(variantId);
  const deletionSelection = useRef({ mapId, variantId });
  if (deletionSelection.current.mapId !== mapId || deletionSelection.current.variantId !== variantId) deletionSelection.current = { mapId, variantId };
  const mapDetailRequest = useRef(0);
  const deletedMapIds = useRef(new Set<string>());
  const mapListRequest = useRef(0);
  const insertionSequence = useRef(0);
  const latestActiveMap = useRef<SavedMap | null>(null);
  const latestPhysicalDocument = useRef<TopologyProjectionDocument | null>(null);
  const skipNextMapLoad = useRef<string | null>(null);
  const viewportCenter = useRef<(() => XYPosition) | null>(null);
  const consumedAddIntent = useRef<string | null>(null);
  const textAnnotationOperationSequence = useRef(0);
  const presentationVariantSubmitPending = useRef(false);
  const presentationVariantDeletionPending = useRef(false);

  selectedMapId.current = mapId;
  selectedVariantId.current = variantId;
  useEffect(() => { setPresentationVariantDeletion(null); }, [mapId, variantId]);
  useEffect(() => { setVariantDeletion(null); }, [mapId]);
  const acceptsMapDetail = (targetMapId: string, request: number) =>
    selectedMapId.current === targetMapId && mapDetailRequest.current === request && !deletedMapIds.current.has(targetMapId);
  const legacy = !savedMapDataSource;
  useEffect(() => {
    let active = true;
    setLocations(null);
    if (!locationDataSource || !savedMapDataSource || !mapId) return () => { active = false; };
    void locationDataSource.loadLocations().then(
      (catalog) => { if (active) setLocations(catalog); },
      () => { if (active) setLocations(null); },
    );
    return () => { active = false; };
  }, [locationDataSource, savedMapDataSource, mapId]);
  const presentationSceneKey =
    !legacy && mapId ? `${mapId}/${viewMode}` : `legacy/${viewMode}`;
  const activeMap = !legacy && map?.map_ref.entity_id === mapId ? map : null;
  const locationArrangement = useLocationGridArrangement(activeMap && locations && viewMode === 'physical' ? {
    automatic: activeMap.variants.find(v => v.variant_ref.entity_id === activeMap.active_variant_ref.entity_id)?.automatic_layout,
    variantId: activeMap.active_variant_ref.entity_id, locations, placements: activeMap.placements,
    onAutomaticLayout: savedMapDataSource?.setAutomaticLayout ? async settings => {
      const updated = await savedMapDataSource.setAutomaticLayout!(activeMap.map_ref.entity_id, activeMap.active_variant_ref.entity_id, settings);
      setMap(current => current?.map_ref.entity_id === updated.map_ref.entity_id && current.active_variant_ref.entity_id === updated.active_variant_ref.entity_id ? updated : current);
    } : undefined,
  } : undefined, presentationSceneKey);

  const document =
    sceneDocument?.sceneKey === presentationSceneKey
      ? sceneDocument.document
      : null;
  const layoutObjectLabels = useMemo(() => new Map((document?.nodes ?? []).flatMap(node => {
    const id = physicalObjectIdForNode(node);
    return id ? [[id, node.label] as const] : [];
  })), [document]);
  latestActiveMap.current = activeMap;
  latestPhysicalDocument.current = viewMode === "physical" ? document : null;
  const ids =
    activeMap?.placements.map((item) => item.physical_object_ref.entity_id) ??
    [];
  const placementMembershipKey = ids.join(",");
  const hasLoadedMap = legacy || Boolean(activeMap);
  const textAnnotationOperationActive = Boolean(textAnnotationEdit || textAnnotationDeletion);
  const physicalAnnotationMode = annotationMode && !legacy && Boolean(activeMap) && viewMode === "physical";
  useEffect(() => {
    let active = true;
    setCatalogInventory(null);
    if (!catalogInventoryDataSource || !maps?.length) return () => { active = false; };
    void catalogInventoryDataSource.loadCatalogInventory().then(
      (inventory) => { if (active) setCatalogInventory(inventory); },
      () => { /* Do not infer an empty inventory from a failed request. */ },
    );
    return () => { active = false; };
  }, [catalogInventoryDataSource, maps?.length]);
  const objectSearchResults = useMemo(() => {
    const query = objectSearch.trim().toLocaleLowerCase();
    if (viewMode !== "physical" || !query) return [];
    return document?.nodes
      .filter((node) => node.source_refs.some((ref) => ref.ref_type === "CANONICAL_FACT" && ref.entity_type === "PhysicalObject"))
      .map((node) => ({ node, label: displayNodeLabel(node) }))
      .filter((item) => item.label.toLocaleLowerCase().includes(query))
      .sort((left, right) => natural(left.label, right.label)) ?? [];
  }, [document, objectSearch, viewMode]);
  useEffect(() => {
    textAnnotationOperationSequence.current += 1;
    setSelectedTextAnnotationId(null);
    setTextAnnotationEdit(null);
    setTextAnnotationDeletion(null);
  }, [mapId, viewMode]);

  useEffect(() => {
    if (selectedTextAnnotationId && !activeMap?.text_annotations.some((annotation) => annotation.annotation_ref.entity_id === selectedTextAnnotationId)) setSelectedTextAnnotationId(null);
  }, [activeMap, selectedTextAnnotationId]);
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
      setWiring({ status: "idle" });
      setBulkSourceId(null);
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("map", id);
        next.delete("variant");
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
    setWiring({ status: "idle" });
    setBulkSourceId(null);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("map");
      next.delete("variant");
      next.delete("focus");
      next.delete("add");
      return next;
    });
  }, [setParams]);

  const reloadMap = useCallback(
    async (targetMapId = mapId): Promise<boolean> => {
      if (!savedMapDataSource || !targetMapId) return false;
      const requestedVariantId = variantId;
      const request = ++mapDetailRequest.current;
      const detail = await savedMapDataSource.loadMap(targetMapId, requestedVariantId ?? undefined);
      if (!acceptsMapDetail(targetMapId, request)) return false;
      setMap(detail);
      return true;
    },
    [mapId, savedMapDataSource, variantId],
  );

  const locationStateFor = (locationId: string) => activeMap?.location_states?.find((state) => state.location_ref.entity_id === locationId);
  const writeLocationState = async (locationId: string, collapsed: boolean, visible_direct_elements: MapLocationDirectElementRef[]) => {
    if (!activeMap || !savedMapDataSource?.setLocationState) return;
    setLocationStateBusy(true);
    try {
      await savedMapDataSource.setLocationState(activeMap.map_ref.entity_id, activeMap.active_variant_ref.entity_id, locationId, { collapsed, visible_direct_elements });
      await reloadMap(activeMap.map_ref.entity_id);
      setLocationConfigId(null);
    } catch (reason) { setError(errorMessage(reason, 'Не удалось сохранить состояние Location')); }
    finally { setLocationStateBusy(false); }
  };
  const openLocationConfig = (locationId: string) => {
    setLocationConfigVisible([...(locationStateFor(locationId)?.visible_direct_elements ?? [])]);
    setDirectLocationChoices(null);
    setLocationConfigId(locationId);
    if (activeMap && savedMapDataSource?.loadLocationDirectElements) void savedMapDataSource.loadLocationDirectElements(activeMap.map_ref.entity_id, activeMap.active_variant_ref.entity_id, locationId).then(setDirectLocationChoices, (reason) => setError(errorMessage(reason, 'Не удалось загрузить прямые элементы Location')));
  };

  const refreshDeletedPresentationVariant = async (deletion: { mapId: string; primaryVariantId: string }) => {
    if (!savedMapDataSource) return;
    const request = ++mapDetailRequest.current;
    let detail: SavedMap;
    try {
      detail = await savedMapDataSource.loadMap(deletion.mapId, deletion.primaryVariantId);
    } catch {
      if (acceptsMapDetail(deletion.mapId, request)) setVariantDeletion({ ...deletion, status: "refresh-failed" });
      return;
    }
    if (!acceptsMapDetail(deletion.mapId, request)) return;
    skipNextMapLoad.current = `${deletion.mapId}/${deletion.primaryVariantId}`;
    setMap(detail);
    setVariantDeletion(null);
  };

  const retryPresentationVariantDeletionRefresh = async () => {
    if (!variantDeletion || variantDeletion.status !== "refresh-failed") return;
    await refreshDeletedPresentationVariant(variantDeletion);
  };

  const confirmPresentationVariantDeletion = async () => {
    const operation = presentationVariantDeletion;
    if (!savedMapDataSource?.deletePresentationVariant || !operation || operation.status !== "confirming" || presentationVariantDeletionPending.current) return;
    presentationVariantDeletionPending.current = true;
    const selectionAtSubmit = deletionSelection.current;
    const stillSelected = () => deletionSelection.current === selectionAtSubmit && selectedMapId.current === operation.mapId && !deletedMapIds.current.has(operation.mapId);
    setPresentationVariantDeletion({ ...operation, status: "deleting", error: null });
    try {
      await savedMapDataSource.deletePresentationVariant(operation.mapId, operation.variantId);
    } catch (reason) {
      if (stillSelected()) setPresentationVariantDeletion({ ...operation, status: "confirming", error: reason instanceof SavedMapApiError ? `${reason.serverMessage} (${reason.code})` : "Не удалось удалить компоновку карты." });
      presentationVariantDeletionPending.current = false;
      return;
    }
    presentationVariantDeletionPending.current = false;
    if (!stillSelected()) return;
    setPresentationVariantDeletion(null);
    const deletion = { mapId: operation.mapId, primaryVariantId: operation.primaryVariantId };
    setMap(null);
    setVariantDeletion({ ...deletion, status: "refreshing" });
    mapDetailRequest.current += 1;
    setParams((currentParams) => {
      const next = new URLSearchParams(currentParams);
      next.set("variant", operation.primaryVariantId);
      return next;
    });
    // Acknowledged deletion is never retried; only the primary read is retryable.
    await refreshDeletedPresentationVariant(deletion);
  };

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
    const loadKey = `${mapId}/${variantId ?? ""}`;
    if (skipNextMapLoad.current === loadKey) {
      skipNextMapLoad.current = null;
      return undefined;
    }
    // The acknowledged DELETE owns its refresh, including the render before URL navigation.
    if (variantDeletion?.mapId === mapId) return undefined;
    let active = true;
    const request = ++mapDetailRequest.current;
    setError(null);
    void savedMapDataSource.loadMap(mapId, variantId ?? undefined).then(
      (detail) => active && acceptsMapDetail(mapId, request) && setMap(detail),
      (reason) =>
        active && setError(errorMessage(reason, t("map.loadFailed"))),
    );
    return () => {
      active = false;
    };
  }, [mapId, maps, savedMapDataSource, variantDeletion, variantId]);

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
    if (!document || !selection) return;
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
      const cableId = selectedCableIdFor(current);
      if (cableId) return cableEndpointIds(document, cableId).size ? current : null;
      const id = physicalObjectIdForSelection(current);
      if (id && activeMap && locations && viewMode === "physical") {
        let element: MapLocationDirectElementRef = { entity_type: "PhysicalObject", entity_id: id };
        let locationId = activeMap.placements.find((placement) => placement.physical_object_ref.entity_id === id)?.location_ref?.entity_id;
        const seen = new Set<string>();
        while (locationId && !seen.has(locationId)) {
          seen.add(locationId);
          const state = activeMap.location_states?.find((item) => item.location_ref.entity_id === locationId);
          if (state?.collapsed && !state.visible_direct_elements.some((ref) => ref.entity_type === element.entity_type && ref.entity_id === element.entity_id)) return null;
          element = { entity_type: "Location", entity_id: locationId };
          locationId = locations.find((location) => location.location_ref.entity_id === locationId)?.parent_location_ref?.entity_id;
        }
      }
      const node = id ? nodeForPhysicalObject(document.nodes, id) : null;
      return node ? { type: "node", item: node } : null;
    });
  }, [document, activeMap, locations, viewMode]);

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

  const createPresentationVariant = async () => {
    const operation = presentationVariantCreate;
    if (!operation || operation.status !== "editing" || !savedMapDataSource?.createPresentationVariant || !operation.name.trim() || presentationVariantSubmitPending.current) return;
    presentationVariantSubmitPending.current = true;
    setPresentationVariantCreate({ ...operation, status: "creating", error: null });
    try {
      const created = await savedMapDataSource.createPresentationVariant(operation.mapId, operation.name.trim(), operation.sourceVariantId);
      const refresh = { mapId: operation.mapId, variantId: created.variant_ref.entity_id, status: "refresh-failed" as const };
      setPresentationVariantCreate(null);
      const request = ++mapDetailRequest.current;
      skipNextMapLoad.current = `${refresh.mapId}/${refresh.variantId}`;
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("variant", refresh.variantId);
        return next;
      });
      try {
        const detail = await savedMapDataSource.loadMap(refresh.mapId, refresh.variantId);
        if (acceptsMapDetail(refresh.mapId, request)) setMap(detail);
      } catch {
        setPresentationVariantCreationRefresh(refresh);
      }
    } catch {
      setPresentationVariantCreate({ ...operation, status: "editing", error: "Не удалось создать компоновку карты." });
    } finally {
      presentationVariantSubmitPending.current = false;
    }
  };

  const retryPresentationVariantCreationRefresh = async () => {
    const refresh = presentationVariantCreationRefresh;
    if (!refresh || !savedMapDataSource) return;
    try {
      const request = ++mapDetailRequest.current;
      const detail = await savedMapDataSource.loadMap(refresh.mapId, refresh.variantId);
      if (acceptsMapDetail(refresh.mapId, request)) setMap(detail);
      setPresentationVariantCreationRefresh(null);
    } catch {
      // The acknowledged create is never retried; keep only the read retry visible.
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
      setMapDeletion({ ...operation, status: "refresh-failed", error: errorMessage(reason, t("map.deleteRefreshFailed")) });
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
    (anchor: XYPosition, requestedObjectId?: string, anchorIsObjectCenter = false) => {
      if (!catalogInventoryDataSource || !mapId || !activeMap) return;
      const request = ++insertionSequence.current;
      setContextAnchor(null);
      setInsertion({
        mapId,
        variantId: activeMap.active_variant_ref.entity_id,
        anchor,
        inventory: null,
        status: "loading",
        error: null,
        ...(requestedObjectId ? { requestedObjectId } : {}),
        ...(anchorIsObjectCenter ? { anchorIsObjectCenter } : {}),
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
    if (!ids.includes(addIntent)) openInsertion(viewportCenter.current(), addIntent, true);
  }, [activeMap, addIntent, coordinateBridgeRevision, document, ids, mapId, openInsertion, setParams, viewMode]);

  const setViewMode = (nextView: TopologyViewMode) => {
    setContextAnchor(null);
    if (nextView !== "physical") setWiring({ status: "idle" });
    if (nextView !== "physical") setBulkSourceId(null);
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
    if (wiring.status === "selecting-source") { const source = endpointFor(candidate); if (source) setWiring({ status: "selecting-target", mapId: wiring.mapId, source }); }
    else if (wiring.status === "selecting-target") { const target = endpointFor(candidate, wiring.source.connectionPointId); if (target) setWiring({ ...wiring, status: "confirming", target, naming: { cable_label: null, cable_label_template_id: null, generate_cable_label: false }, error: null }); }
  };
  const refreshWiringProjection = async (operation: WiringOperation): Promise<boolean> => {
    const currentMap = latestActiveMap.current;
    if (!currentMap || currentMap.map_ref.entity_id !== operation.mapId) return false;
    const next = await dataSource.loadProjection(projectionRequestFor("physical", currentMap.placements.map((item) => item.physical_object_ref.entity_id), true));
    if (selectedMapId.current !== operation.mapId || viewMode !== "physical") return false;
    setSceneDocument({ sceneKey: `${operation.mapId}/physical`, document: next }); return true;
  };
  const refreshCreatedWiring = async (operation: WiringOperation) => {
    try {
      if (await reloadMap(operation.mapId) && await refreshWiringProjection(operation)) setWiring({ status: "idle" });
    } catch {
      if (selectedMapId.current === operation.mapId && viewMode === "physical") setWiring({ ...operation, status: "refresh-failed", error: null });
    }
  };
  const createWiring = async (confirmedHistoricalLabel?: string) => {
    if (!physicalEndpointConnectionWriteDataSource || wiring.status !== "confirming" || (wiringHistoricalCandidate && !confirmedHistoricalLabel) || (wiring.naming.generate_cable_label && !wiring.naming.cable_label_template_id)) return;
    const operation = wiring;
    if (!endpointFor({ physicalObjectId: operation.source.physicalObjectId, connectionPointId: operation.source.connectionPointId, label: operation.source.portLabel }) || !endpointFor({ physicalObjectId: operation.target.physicalObjectId, connectionPointId: operation.target.connectionPointId, label: operation.target.portLabel }, operation.source.connectionPointId)) { setWiring({ ...operation, error: t("map.wiring.source") }); return; }
    setWiring({ ...operation, status: "creating", error: null });
    try { await physicalEndpointConnectionWriteDataSource.createPhysicalEndpointConnection({ source: { kind: "CONNECTION_POINT", connection_point_id: operation.source.connectionPointId, member_index: 1 }, target: { kind: "CONNECTION_POINT", connection_point_id: operation.target.connectionPointId, member_index: 1 }, cable_label: operation.naming.cable_label?.trim() || null, cable_label_template_id: operation.naming.cable_label_template_id ?? null, generate_cable_label: operation.naming.generate_cable_label === true, confirmed_historical_label: confirmedHistoricalLabel ?? null }); }
    catch (reason) { if (isHistoricalCableLabelReuseRequired(reason)) { setWiringHistoricalCandidate(reason.candidate); setWiring(operation); } else if (confirmedHistoricalLabel && isHistoricalCableLabelReuseConfirmationStale(reason)) { setWiringHistoricalCandidate(null); setWiring(operation); setTimeout(() => void createWiring(), 0); } else if (selectedMapId.current === operation.mapId && viewMode === "physical") setWiring({ ...operation, error: errorMessage(reason, t("map.connectFailed")) }); return; }
    if (selectedMapId.current !== operation.mapId || viewMode !== "physical") return;
    await refreshCreatedWiring(operation);
  };
  const retryWiringRefresh = async () => { if (wiring.status === "refresh-failed") await refreshCreatedWiring(wiring); };

  const resolveInsertionPosition = async (
    id: string,
    anchor: XYPosition,
    anchorIsObjectCenter = false,
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
          ? [projectionNodeFootprint(node, position, position.display_width, faceViews?.objectFaces.get(placement.physical_object_ref.entity_id)?.face)]
          : [];
      },
    );
    const blueprint = candidates[0].attributes.blueprint_presentation;
    const displayWidth = blueprint
      ? minimumBlueprintDisplayWidth(blueprint)
      : undefined;
    const footprint = footprintDimensionsForProjectionNode(candidates[0], displayWidth);
    const position = nearestFreePosition(
      anchorIsObjectCenter ? centeredPositionForFootprint(anchor, footprint) : anchor,
      footprint,
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
      placement = await resolveInsertionPosition(id, operation.anchor, operation.anchorIsObjectCenter);
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
        placement.displayWidth,
        operation.variantId,
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
      if (refreshed) {
        setInsertion(null);
        setParams((current) => {
          const next = new URLSearchParams(current);
          next.set("focus", id);
          return next;
        }, { replace: true });
      }
      else
        setInsertion((current) =>
          current?.mapId === targetMapId
            ? {
                ...current,
                status: "saved-refresh-failed",
                error: t("map.addRefreshFailed"),
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
                t("map.addRefreshFailed"),
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
      if (selectedMapId.current === targetMapId && refreshed) {
        setInsertion(null);
        setParams((current) => {
          const next = new URLSearchParams(current);
          if (insertion.requestedObjectId) next.set("focus", insertion.requestedObjectId);
          return next;
        }, { replace: true });
      }
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
    if (!savedMapDataSource || !mapId || !activeMap) return;
    setError(null);
    const targetMapId = mapId, targetVariantId = activeMap.active_variant_ref.entity_id;
    const requestedVariant = selectedVariantId.current;
    const stillSelected = () => selectedMapId.current === targetMapId && selectedVariantId.current === requestedVariant;
    try {
      const authoritative = await savedMapDataSource.movePosition(targetMapId, id, viewMode, position.x, position.y, undefined, targetVariantId);
      if (stillSelected()) setMap(current => current?.map_ref.entity_id === targetMapId && current.active_variant_ref.entity_id === targetVariantId ? authoritative : current);
    } catch (reason) {
      if (!stillSelected()) return;
      setError(errorMessage(reason, t("map.moveFailed")));
      // Restore the confirmed snapshot even if a read retry fails.
      setAuthoritativePositionRevision(revision => revision + 1);
      try {
        const confirmed = await savedMapDataSource.loadMap(targetMapId, targetVariantId);
        if (stillSelected()) setMap(current => current?.map_ref.entity_id === targetMapId && current.active_variant_ref.entity_id === targetVariantId ? confirmed : current);
      } catch { /* Keep the confirmed local snapshot and the bounded write error. */ }
    }
  };

  const persistBlueprintDisplayWidths = async (requests: Array<{ id: string; displayWidth: number }>) => {
    if (!savedMapDataSource || !mapId || viewMode !== "physical") return;
    const targetMapId = mapId;
    const positionKey = savedMapViewKey(viewMode);
    const variantId = activeMap?.active_variant_ref.entity_id;
    const writes = requests.flatMap(({ id, displayWidth }) => {
      const current = activeMap?.placements.find((placement) => placement.physical_object_ref.entity_id === id)?.positions[positionKey];
      const blueprint = (latestPhysicalDocument.current?.nodes ?? []).find((node) => physicalObjectIdForNode(node) === id)?.attributes.blueprint_presentation;
      const face = faceViews?.objectFaces.get(id)?.face;
      const visible = blueprint && face ? blueprintFace(blueprint, face)?.visibleBlueprint ?? blueprint : blueprint;
      return current && visible ? [{ id, current, width: clampBlueprintDisplayWidth(displayWidth, visible) }] : [];
    });
    if (!writes.length) return;
    const requestedVariant = selectedVariantId.current;
    try {
      let authoritative: SavedMap | undefined;
      for (const write of writes)
        authoritative = await savedMapDataSource.movePosition(targetMapId, write.id, viewMode, write.current.x, write.current.y, write.width, variantId);
      if (authoritative && selectedMapId.current === targetMapId && selectedVariantId.current === requestedVariant)
        setMap(current => current?.map_ref.entity_id === targetMapId && current.active_variant_ref.entity_id === variantId ? authoritative! : current);
    } catch (reason) {
      if (selectedMapId.current !== targetMapId || selectedVariantId.current !== requestedVariant) return;
      setAuthoritativePositionRevision(revision => revision + 1);
      try {
        const confirmed = await savedMapDataSource.loadMap(targetMapId, variantId);
        if (selectedMapId.current === targetMapId && selectedVariantId.current === requestedVariant)
          setMap(current => current?.map_ref.entity_id === targetMapId && current.active_variant_ref.entity_id === variantId ? confirmed : current);
      } catch { /* preserve persistence error */ }
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
    await savedMapDataSource.setPositionLock(targetMapId, id, viewMode, locked, activeMap?.active_variant_ref.entity_id);
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
        placement.displayWidth,
        activeMap?.active_variant_ref.entity_id,
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

  const textAnnotationPreview = textAnnotationEdit?.position ? {
    annotation_ref: { entity_type: 'MapTextAnnotation' as const, entity_id: textAnnotationEdit.annotationId ?? 'draft-text-annotation' },
    text: textAnnotationEdit.text,
    position: textAnnotationEdit.position,
    text_color: textAnnotationEdit.textColor,
    font_size: textAnnotationEdit.fontSize,
  } : undefined;
  const startTextAnnotation = () => {
    if (!activeMap || textAnnotationOperationActive) return;
    setSelectedTextAnnotationId(null);
    setTextAnnotationEdit({ mapId: activeMap.map_ref.entity_id, text: '', position: null, textColor: '#1f2937', fontSize: 18, status: 'placing', error: null });
  };
  const editTextAnnotation = () => {
    if (!activeMap || !selectedTextAnnotationId || textAnnotationOperationActive) return;
    const original = activeMap.text_annotations.find((annotation) => annotation.annotation_ref.entity_id === selectedTextAnnotationId);
    if (!original) return;
    setTextAnnotationEdit({ mapId: activeMap.map_ref.entity_id, annotationId: selectedTextAnnotationId, original, text: original.text, position: { ...original.position }, textColor: original.text_color, fontSize: original.font_size, status: 'editing', error: null });
  };
  const beginTextAnnotationDeletion = () => {
    if (!activeMap || !selectedTextAnnotationId || textAnnotationOperationActive) return;
    const annotation = activeMap.text_annotations.find((item) => item.annotation_ref.entity_id === selectedTextAnnotationId);
    if (annotation) setTextAnnotationDeletion({ mapId: activeMap.map_ref.entity_id, annotationId: selectedTextAnnotationId, text: annotation.text, status: 'confirming', error: null });
  };
  const saveTextAnnotation = async () => {
    if (!savedMapDataSource || !textAnnotationEdit || textAnnotationEdit.status !== 'editing' || !textAnnotationEdit.position) return;
    const text = textAnnotationEdit.text.trim();
    if (!text) { setTextAnnotationEdit((current) => current ? { ...current, error: t('map.textAnnotationRequired') } : current); return; }
    const operation = textAnnotationEdit;
    const position = operation.position;
    if (!position) return;
    const request = ++textAnnotationOperationSequence.current;
    const write = { text, position: { x: position.x!, y: position.y! }, text_color: operation.textColor, font_size: operation.fontSize };
    setTextAnnotationEdit({ ...operation, status: 'saving', error: null });
    try {
      if (operation.annotationId) await savedMapDataSource.replaceTextAnnotation(operation.mapId, operation.annotationId, write);
      else await savedMapDataSource.createTextAnnotation(operation.mapId, write);
    } catch {
      if (request === textAnnotationOperationSequence.current && selectedMapId.current === operation.mapId) setTextAnnotationEdit({ ...operation, status: 'editing', error: t('map.textAnnotationSaveFailed') });
      return;
    }
    try {
      const refreshed = await reloadMap(operation.mapId);
      if (request !== textAnnotationOperationSequence.current || selectedMapId.current !== operation.mapId) return;
      if (refreshed) setTextAnnotationEdit(null);
      else setTextAnnotationEdit({ ...operation, status: 'refresh-failed', error: t('map.textAnnotationSavedRefreshFailed') });
    } catch {
      if (request === textAnnotationOperationSequence.current && selectedMapId.current === operation.mapId) setTextAnnotationEdit({ ...operation, status: 'refresh-failed', error: t('map.textAnnotationSavedRefreshFailed') });
    }
  };
  const retryTextAnnotationRefresh = async () => {
    if (!textAnnotationEdit || textAnnotationEdit.status !== 'refresh-failed') return;
    const operation = textAnnotationEdit;
    setTextAnnotationEdit({ ...operation, status: 'saving', error: null });
    try { if (await reloadMap(operation.mapId)) setTextAnnotationEdit(null); }
    catch { if (selectedMapId.current === operation.mapId) setTextAnnotationEdit({ ...operation, status: 'refresh-failed', error: t('map.textAnnotationSavedRefreshFailed') }); }
  };
  const confirmTextAnnotationDeletion = async () => {
    if (!savedMapDataSource || !textAnnotationDeletion || textAnnotationDeletion.status !== 'confirming') return;
    const operation = textAnnotationDeletion;
    setTextAnnotationDeletion({ ...operation, status: 'deleting', error: null });
    try { await savedMapDataSource.deleteTextAnnotation(operation.mapId, operation.annotationId); }
    catch { if (selectedMapId.current === operation.mapId) setTextAnnotationDeletion({ ...operation, status: 'confirming', error: t('map.textAnnotationDeleteFailed') }); return; }
    try { if (await reloadMap(operation.mapId)) { setTextAnnotationDeletion(null); setSelectedTextAnnotationId(null); } else setTextAnnotationDeletion({ ...operation, status: 'refresh-failed', error: t('map.textAnnotationDeletedRefreshFailed') }); }
    catch { if (selectedMapId.current === operation.mapId) setTextAnnotationDeletion({ ...operation, status: 'refresh-failed', error: t('map.textAnnotationDeletedRefreshFailed') }); }
  };
  const retryTextAnnotationDeletionRefresh = async () => {
    if (!textAnnotationDeletion || textAnnotationDeletion.status !== 'refresh-failed') return;
    const operation = textAnnotationDeletion;
    setTextAnnotationDeletion({ ...operation, status: 'deleting', error: null });
    try { if (await reloadMap(operation.mapId)) { setTextAnnotationDeletion(null); setSelectedTextAnnotationId(null); } }
    catch { if (selectedMapId.current === operation.mapId) setTextAnnotationDeletion({ ...operation, status: 'refresh-failed', error: t('map.textAnnotationDeletedRefreshFailed') }); }
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
  const blueprintSizeForObject = (id: string) => {
    const position = activeMap?.placements.find((item) => item.physical_object_ref.entity_id === id)
      ?.positions["L1/PHYSICAL_OBJECT"];
    const blueprint = nodeForPhysicalObject(document?.nodes ?? [], id)?.attributes.blueprint_presentation;
    return !legacy && viewMode === "physical" && position && blueprint
      ? { displayWidth: position.display_width ?? DEFAULT_BLUEPRINT_DISPLAY_WIDTH, copiedDisplayWidth: copiedBlueprintDisplayWidth }
      : undefined;
  };
  const applySizeToSameBlueprint = async (id: string) => {
    const size = blueprintSizeForObject(id);
    const blueprint = nodeForPhysicalObject(document?.nodes ?? [], id)?.attributes.blueprint_presentation;
    if (!size || !blueprint || !activeMap || !document) return;
    const blueprintId = blueprint.blueprint_ref.entity_id;
    const ids = activeMap.placements.flatMap((placement) => {
      const placementId = placement.physical_object_ref.entity_id;
      const presentation = nodeForPhysicalObject(document.nodes, placementId)?.attributes.blueprint_presentation;
      return presentation?.blueprint_ref.entity_id === blueprintId && placement.positions["L1/PHYSICAL_OBJECT"] ? [placementId] : [];
    });
    await persistBlueprintDisplayWidths(ids.map((placementId) => ({ id: placementId, displayWidth: size.displayWidth })));
  };
  const directlyAttachedCables = useMemo(
    () => directlyAttachedCableIds(document, physicalObjectIdForSelection(selection)),
    [document, selection],
  );
  const receiveViewportCenter = useCallback(
    (getter: (() => XYPosition) | null) => {
      viewportCenter.current = getter;
      setCoordinateBridgeRevision((revision) => revision + 1);
    },
    [],
  );
  const contextBusy = wiring.status !== "idle" || Boolean(reconnectCableId) || Boolean(bulkSourceId) || Boolean(bulkDeleteSourceId) || Boolean(insertion) || Boolean(mapDeletion) || Boolean(mapOperation);
  const refreshBulkCableDelete = async () => {
    if (!activeMap || !savedMapDataSource || !mapId || currentTraceScope.current !== traceScope) return;
    const request = ++mapDetailRequest.current;
    const variant = activeMap.active_variant_ref.entity_id;
    const [detail, inventory] = await Promise.all([
      savedMapDataSource.loadMap(mapId, variant),
      catalogInventoryDataSource?.loadCatalogInventory(),
    ]);
    const next = await dataSource.loadProjection(projectionRequestFor(
      'physical', detail.placements.map(item => item.physical_object_ref.entity_id), true,
    ));
    if (currentTraceScope.current !== traceScope) return;
    if (!acceptsMapDetail(mapId, request) || detail.active_variant_ref.entity_id !== variant) {
      throw new Error('Map refresh was superseded');
    }
    setMap(detail);
    if (inventory) setCatalogInventory(inventory);
    setSceneDocument({ sceneKey: presentationSceneKey, document: next });
    setSelection(null);
    clearTrace();
  };
  const openPortContext = (port: { physicalObjectId: string; connectionPointId: string; label: string }, screen: XYPosition) => {
    if (contextBusy || !physicalObjectDetailsDataSource) return;
    const displayName = document?.nodes.find((node) => physicalObjectIdForNode(node) === port.physicalObjectId)?.attributes.connection_points?.find((point) => point.connection_point_id === port.connectionPointId)?.display_name ?? port.label;
    setSelection((current) => document?.nodes.find((node) => physicalObjectIdForNode(node) === port.physicalObjectId) ? { type: "node", item: document.nodes.find((node) => physicalObjectIdForNode(node) === port.physicalObjectId)! } : current);
    setContextAnchor({ kind: "port", objectId: port.physicalObjectId, connectionPointId: port.connectionPointId, label: displayName, screen, action: "loading" });
    void physicalObjectDetailsDataSource.loadPhysicalObjectDetails(port.physicalObjectId).then((details) => {
      const point = details.connection_points.find((item) => item.connection_point_ref.entity_id === port.connectionPointId);
      const attachments = point?.external_physical_attachments;
      const action: MapContextTarget extends infer _ ? "connect" | "unavailable" | { disconnectConnectionId: string } : never = point?.cardinality === 1 && Array.isArray(attachments) && attachments.length === 0 ? "connect" : point?.cardinality === 1 && attachments?.length === 1 ? { disconnectConnectionId: attachments[0].connection_ref.entity_id } : "unavailable";
      setContextAnchor((current) => current?.kind === "port" && current.connectionPointId === port.connectionPointId ? { ...current, label: point?.label ?? current.label, action } : current);
    }, () => setContextAnchor((current) => current?.kind === "port" && current.connectionPointId === port.connectionPointId ? { ...current, action: "unavailable" } : current));
  };
  const connectFromPort = (physicalObjectId: string, connectionPointId: string) => {
    const source = endpointFor({ physicalObjectId, connectionPointId, label: "" });
    if (source && activeMap && wiring.status === "idle") setWiring({ status: "selecting-target", mapId: activeMap.map_ref.entity_id, source });
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
  const beginCableRename = async (cableId: string, fallback: string) => {
    if (!catalogInventoryDataSource || !cableLabelDataSource) return;
    try {
      const cable = (await catalogInventoryDataSource.loadCatalogInventory()).cables.find((item) => item.cable_ref.entity_id === cableId);
      if (cable) setCableRename({ cableId, fallback, userLabel: cable.label_source === 'TECHNICAL_FALLBACK' ? null : cable.label });
    } catch (reason) { setError(errorMessage(reason, t('catalog.error.title'))); }
  };
  const refreshCableRename = async () => {
    const currentMap = latestActiveMap.current;
    if (!currentMap) throw new Error('Map is unavailable');
    const next = await dataSource.loadProjection(projectionRequestFor('physical', currentMap.placements.map((item) => item.physical_object_ref.entity_id), true));
    if (selectedMapId.current !== currentMap.map_ref.entity_id || viewMode !== 'physical') throw new Error('Map changed');
    setSceneDocument({ sceneKey: `${currentMap.map_ref.entity_id}/physical`, document: next });
  };
  const activeVariant = activeMap?.variants.find((item) => item.variant_ref.entity_id === activeMap.active_variant_ref.entity_id);
  const traceOverlay = useMemo(
    () => physicalTraceOverlayFor(traceArtifact, document, selectedTraceBranchId),
    [traceArtifact, document, selectedTraceBranchId],
  );
  const traceOwnsFaces = !physicalAnnotationMode &&
    traceArtifact?.verdict === "REACHABLE" &&
    selectedTraceBranchId !== null &&
    traceArtifact.branches.some(branch => branch.branch_id === selectedTraceBranchId);
  const defaultFace = activeVariant?.default_face;
  const faceViews = useMemo(() => defaultFace && activeMap && locations
    ? resolveFaces(defaultFace, locations, activeMap.location_states ?? [], activeMap.placements)
    : undefined, [defaultFace, locations, activeMap?.location_states, activeMap?.placements]);
  const writeFace = savedMapDataSource?.setFace ? async (face: FaceOverride, target?: FaceTarget) => {
    if (!activeMap || faceBusy) return;
    const id = activeMap.map_ref.entity_id, variant = activeMap.active_variant_ref.entity_id;
    setFaceBusy(true);
    try {
      const updated = await savedMapDataSource.setFace!(id, variant, face, target);
      setMap(current => {
        if (current?.map_ref.entity_id !== id || current.active_variant_ref.entity_id !== variant) return current;
        if (!target) return { ...current, variants: current.variants.map(item => item.variant_ref.entity_id === variant
          ? { ...item, default_face: updated.variants.find(value => value.variant_ref.entity_id === variant)?.default_face }
          : item) };
        const override = face === 'INHERIT' ? null : face;
        if (target.kind === 'locations') return { ...current, location_states: current.location_states?.map(state =>
          state.location_ref.entity_id === target.id ? { ...state, face_override: override } : state) };
        const key = 'L1/PHYSICAL_OBJECT';
        return { ...current, placements: current.placements.map(placement => {
          const position = placement.positions[key];
          return position && placement.physical_object_ref.entity_id === target.id
            ? { ...placement, positions: { ...placement.positions, [key]: { ...position, face_override: override } } }
            : placement;
        }) };
      });
    } catch (reason) {
      if (selectedMapId.current === id) setError(errorMessage(reason, t('face.saveFailed')));
    } finally {
      setFaceBusy(false);
    }
  } : undefined;
  const openPresentationVariantCreate = () => {
    if (!activeMap) return;
    setPresentationVariantCreate({ mapId: activeMap.map_ref.entity_id, sourceVariantId: activeMap.active_variant_ref.entity_id, sourceVariantName: activeVariant?.name ?? "", name: "", status: "editing", error: null });
  };
  const beginPresentationVariantDeletion = () => {
    if (!activeMap) return;
    const primary = activeMap.variants.find((item) => item.name === "Основной");
    if (!activeVariant || !primary || activeVariant.name === "Основной") return;
    setPresentationVariantDeletion({ mapId: activeMap.map_ref.entity_id, variantId: activeVariant.variant_ref.entity_id, variantName: activeVariant.name, primaryVariantId: primary.variant_ref.entity_id, status: "confirming", error: null });
  };

  return (
    <main className="map-page">
      <div className="map-page__toolbar topology-mode-switch" aria-label="Основные элементы карты">
        <label>
          <span>{t("map.maps")}:</span>
          {legacy ? (
            "—"
          ) : (
            <MapToolbarDropdown label={t("map.maps")} value={mapId ?? ""} options={(maps ?? []).map((item) => ({ value: item.map_ref.entity_id, label: item.name }))} onChange={selectMap} />
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

      {!legacy && activeMap && viewMode === "physical" && !selection && (
        <aside className="map-utility-panel" aria-label="Служебные инструменты карты">
          <section className="map-utility-panel__section">
            <button type="button" className="map-utility-panel__header" aria-expanded={utilitySection === "layout"} onClick={() => setUtilitySection((current) => current === "layout" ? null : "layout")}>
              <span>{utilitySection === "layout" ? "Компоновка" : `Компоновка · ${activeVariant?.name ?? "—"}`}</span><span aria-hidden="true">{utilitySection === "layout" ? "‹" : "›"}</span>
            </button>
            {utilitySection === "layout" && <div className="map-utility-panel__content">
              <MapToolbarDropdown label="Текущая компоновка" value={activeMap.active_variant_ref.entity_id} options={activeMap.variants.map((item) => ({ value: item.variant_ref.entity_id, label: item.name }))} onChange={(nextVariantId) => { mapDetailRequest.current += 1; setParams((current) => { const next = new URLSearchParams(current); next.set("variant", nextVariantId); next.delete("focus"); return next; }); }} />
              {defaultFace && writeFace && <PhysicalFaceSelect value={defaultFace} disabled={faceBusy}
                onChange={face => void writeFace(face)} />}
              {activeMap && locations && savedMapDataSource?.setAutomaticLayout && <AutomaticLocationControls arrangement={locationArrangement} key={activeMap.active_variant_ref.entity_id} map={activeMap} locations={locations} objectLabels={layoutObjectLabels} onSave={async settings => { const updated = await savedMapDataSource.setAutomaticLayout!(activeMap.map_ref.entity_id, activeMap.active_variant_ref.entity_id, settings); setMap(current => current?.map_ref.entity_id === updated.map_ref.entity_id && current.active_variant_ref.entity_id === updated.active_variant_ref.entity_id ? updated : current); }} />}
              <div className="map-utility-panel__actions"><button type="button" title="Создать независимую копию текущего расположения, размеров и трасс" disabled={!savedMapDataSource?.createPresentationVariant} onClick={openPresentationVariantCreate}>Создать копию</button><button type="button" disabled={activeVariant?.name === "Основной" || !savedMapDataSource?.deletePresentationVariant} onClick={beginPresentationVariantDeletion}>Удалить</button></div>
            </div>}
          </section>
          <section className="map-utility-panel__section">
            <button type="button" className="map-utility-panel__header" aria-expanded={utilitySection === "tools"} onClick={() => setUtilitySection((current) => current === "tools" ? null : "tools")}>
              <span>Инструменты</span><span aria-hidden="true">{utilitySection === "tools" ? "‹" : "›"}</span>
            </button>
            {utilitySection === "tools" && <div className="map-utility-panel__content">
              <button type="button" onClick={() => setWiring({ status: "selecting-source", mapId: activeMap.map_ref.entity_id })} disabled={!document || !physicalEndpointConnectionWriteDataSource}>{t("map.connectPorts")}</button>
              <button type="button" aria-pressed={physicalAnnotationMode} onClick={() => { setAnnotationMode((active) => !active); setUtilitySection(null); }}>{t("map.textAnnotation")}</button>
              <button type="button" aria-pressed={showAllVirtualChannels}
                disabled={!document || physicalAnnotationMode || wiring.status !== "idle" || Boolean(bulkSourceId)}
                onClick={() => setShowAllVirtualChannels(value => !value)}>{t("map.virtualChannels")}</button>
            </div>}
          </section>
        </aside>
      )}

      {!legacy && activeMap && viewMode === "physical" && !physicalAnnotationMode && (
        <MapObjectSearchPanel title={t("map.objectSearch")}>
          <label>
            <input
              aria-label={t("map.objectSearch")}
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
        </MapObjectSearchPanel>
      )}

      {physicalAnnotationMode && activeMap && <>
        <section className="map-presentation-toolbar" aria-label={t('map.textAnnotation')}>
          <button type="button" className="primary-action" aria-label={t('map.textAnnotationAdd')} disabled={textAnnotationOperationActive} onClick={startTextAnnotation}>{`+ ${t('map.textAnnotation')}`}</button>
        </section>
        <PresentationAuthoringPanel
          annotations={activeMap.text_annotations ?? []}
          selectedAnnotationId={selectedTextAnnotationId}
          selectionDisabled={textAnnotationOperationActive}
          textAnnotationEdit={textAnnotationEdit} textAnnotationDeletion={textAnnotationDeletion}
          setTextAnnotationEdit={setTextAnnotationEdit} setTextAnnotationDeletion={setTextAnnotationDeletion}
          onSelectAnnotation={(id) => { if (!textAnnotationOperationActive) setSelectedTextAnnotationId((current) => current === id ? null : id); }}
          onEditAnnotation={editTextAnnotation} onDeleteAnnotation={beginTextAnnotationDeletion} onSaveAnnotation={() => void saveTextAnnotation()} onRetryAnnotationRefresh={() => void retryTextAnnotationRefresh()} onConfirmAnnotationDeletion={() => void confirmTextAnnotationDeletion()} onRetryAnnotationDeletionRefresh={() => void retryTextAnnotationDeletionRefresh()}
        />
      </>}

      {presentationVariantDeletion && (
        <section className="map-dialog" role="dialog" aria-modal="true" aria-label="Удалить компоновку">
          <div className="map-dialog__surface">
            <h2>Удалить компоновку</h2>
            <p>Удалить компоновку «{presentationVariantDeletion.variantName}»?</p>
            <p>Будут удалены только сохранённые расположение, размеры и трассы этой компоновки. Объекты карты и связи не удаляются.</p>
            {presentationVariantDeletion.error && <p role="alert">{presentationVariantDeletion.error}</p>}
            <div className="map-dialog__actions">
              <button type="button" disabled={presentationVariantDeletion.status === "deleting"} onClick={() => setPresentationVariantDeletion(null)}>Отмена</button>
              <button type="button" disabled={presentationVariantDeletion.status === "deleting"} onClick={() => void confirmPresentationVariantDeletion()}>Удалить</button>
            </div>
          </div>
        </section>
      )}
      {presentationVariantCreate && (
        <section className="map-dialog" role="dialog" aria-modal="true" aria-label="Создать копию компоновки">
          <div className="map-dialog__surface">
            <h2>Создать копию компоновки</h2>
            <p>Будет создана независимая копия текущей компоновки «{presentationVariantCreate.sourceVariantName}». Положение и размеры объектов, а также трассы кабелей будут скопированы. Исходная компоновка не изменится.</p>
            <label>
              Название новой компоновки
              <input autoFocus value={presentationVariantCreate.name} disabled={presentationVariantCreate.status === "creating"} onChange={(event) => setPresentationVariantCreate((current) => current ? { ...current, name: event.target.value, error: null } : null)} />
            </label>
            {presentationVariantCreate.error && <p role="alert">{presentationVariantCreate.error}</p>}
            <div className="map-dialog__actions">
              <button type="button" disabled={presentationVariantCreate.status === "creating"} onClick={() => setPresentationVariantCreate(null)}>Отмена</button>
              <button type="button" disabled={presentationVariantCreate.status === "creating" || !presentationVariantCreate.name.trim()} onClick={() => void createPresentationVariant()}>Создать</button>
            </div>
          </div>
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
              <p role="alert">{mapDeletion.error ?? t("map.deleteRefreshFailed")}</p>
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
      {reconnectCableId && activeMap && document && physicalObjectDetailsDataSource && cableReconnectDataSource &&
        <CableReconnectDialog cableId={reconnectCableId} details={physicalObjectDetailsDataSource} writer={cableReconnectDataSource}
          objects={document.nodes.flatMap(node => {
            const id = physicalObjectIdForNode(node);
            return id ? [{ id, label: displayNodeLabel(node) }] : [];
          })}
          refresh={async () => {
            const currentMap = latestActiveMap.current;
            if (!currentMap || currentTraceScope.current !== traceScope) throw new Error('Map changed');
            const next = await dataSource.loadProjection(projectionRequestFor(
              'physical', currentMap.placements.map(item => item.physical_object_ref.entity_id), true,
            ));
            if (currentTraceScope.current !== traceScope) throw new Error('Map changed');
            setSceneDocument({ sceneKey: presentationSceneKey, document: next });
            setSelection(null);
            clearTrace();
          }}
          close={() => { if (currentTraceScope.current === traceScope) setReconnectCableId(null); }} />}
      {bulkSourceId && activeMap && document && physicalObjectDetailsDataSource &&
        physicalEndpointConnectionWriteDataSource?.createBulkPhysicalConnections &&
        <BulkCableCreateDialog sourceId={bulkSourceId} nodes={document.nodes}
          details={physicalObjectDetailsDataSource} writer={physicalEndpointConnectionWriteDataSource}
          labelCatalog={cableLabelDataSource}
          refresh={async () => {
            const next = await dataSource.loadProjection(projectionRequestFor(
              'physical', activeMap.placements.map(item => item.physical_object_ref.entity_id), true,
            ));
            if (currentTraceScope.current === traceScope) {
              setSceneDocument({ sceneKey: presentationSceneKey, document: next });
              clearTrace();
            }
          }}
          close={() => { if (currentTraceScope.current === traceScope) setBulkSourceId(null); }} />}
      {(wiring.status === "selecting-source" || wiring.status === "selecting-target") && wiring.mapId === mapId && <aside className="map-wiring-panel" aria-label={t("map.connectPorts")}>
        {wiring.status === "selecting-source" && <p role="status">{t("map.wiring.source")}</p>}
        {wiring.status === "selecting-target" && <><p role="status">{t("map.wiring.target")}</p><p>{t("map.wiring.sourceLabel", { object: wiring.source.objectLabel, port: wiring.source.portLabel })}</p></>}
        <button type="button" onClick={() => setWiring({ status: "idle" })}>{t("map.cancel")}</button>
      </aside>}
      {(wiring.status === "confirming" || wiring.status === "creating" || wiring.status === "refresh-failed") && wiring.mapId === mapId && <section className="map-dialog" role="dialog" aria-modal="true" aria-label={t("map.connectPorts")}><div className="map-dialog__surface">
        {(wiring.status === "confirming" || wiring.status === "creating") && <><p>{t("map.wiring.endpointSummary", { sourceObject: wiring.source.objectLabel, sourcePort: wiring.source.portLabel, targetObject: wiring.target.objectLabel, targetPort: wiring.target.portLabel })}</p><CableNamingFields dataSource={cableLabelDataSource} disabled={wiring.status === "creating"} value={wiring.naming} onChange={(naming) => { setWiringHistoricalCandidate(null); setWiring((current) => current.status === "confirming" ? { ...current, naming } : current); }} />{wiringHistoricalCandidate && wiring.status === "confirming" && <div className="map-wiring-historical-warning" role="alert"><strong>{t("map.wiring.historicalReuse", { name: wiringHistoricalCandidate })}</strong><small>{t("map.wiring.historicalReuseHint")}</small><div><button type="button" onClick={() => setWiringHistoricalCandidate(null)}>{t("map.wiring.historicalReuseNo")}</button><button type="button" onClick={() => { const candidate = wiringHistoricalCandidate; setWiringHistoricalCandidate(null); void createWiring(candidate); }}>{t("map.wiring.historicalReuseYes")}</button></div></div>}{wiring.error && <p role="alert">{wiring.error}</p>}<div className="map-dialog__actions map-dialog__actions--wiring"><button type="button" disabled={wiring.status === "creating"} onClick={() => { setWiringHistoricalCandidate(null); setWiring({ status: "selecting-target", mapId: wiring.mapId, source: wiring.source }); }}>{t("map.back")}</button><button type="button" disabled={wiring.status === "creating"} onClick={() => { setWiringHistoricalCandidate(null); setWiring({ status: "idle" }); }}>{t("map.cancel")}</button><button type="button" disabled={wiring.status === "creating" || Boolean(wiringHistoricalCandidate) || (wiring.naming.generate_cable_label === true && !wiring.naming.cable_label_template_id)} onClick={() => void createWiring()}>{wiring.status === "creating" ? t("map.creating") : wiring.error ? t("action.retry") : t("map.createCable")}</button></div></>}
        {wiring.status === "refresh-failed" && <><p role="alert">{t("map.cableCreatedRefreshFailed")}</p><button type="button" onClick={() => void retryWiringRefresh()}>{t("map.retryRefresh")}</button></>}
      </div></section>}
      {bulkDeleteSourceId && document && cableDeleteDataSource?.previewBulkDelete && cableDeleteDataSource.bulkDelete &&
        <BulkCableDeleteDialog sourceId={bulkDeleteSourceId} nodes={document.nodes}
          preview={pair => cableDeleteDataSource.previewBulkDelete!(pair)}
          remove={(pair, cables) => cableDeleteDataSource.bulkDelete!(pair, cables)}
          refresh={refreshBulkCableDelete}
          close={() => { if (currentTraceScope.current === traceScope) setBulkDeleteSourceId(null); }} />}
      {contextAnchor && viewMode === "physical" && !contextBusy && <MapContextMenu
        target={contextAnchor}
        onClose={() => setContextAnchor(null)}
        onAdd={(anchor) => openInsertion(anchor)}
        onSetLock={(id, locked) => void setPlacementLock(id, locked).catch((reason) => setError(errorMessage(reason, t("map.lockFailed"))))}
        onRemove={(id) => void remove(id).catch((reason) => setError(errorMessage(reason, t("map.removeFailed"))))}
        blueprintSize={contextAnchor.kind === "object" ? blueprintSizeForObject(contextAnchor.id) : undefined}
        onEditBlueprintSize={(id) => {
          const size = blueprintSizeForObject(id);
          if (!size) return;
          setBlueprintSizeError(null);
          setBlueprintSizeDialog({ id, draft: String(size.displayWidth) });
        }}
        onCopyBlueprintSize={(width) => setCopiedBlueprintDisplayWidth(width)}
        onApplyCopiedBlueprintSize={(id, width) => void resizeBlueprint(id, width).catch((reason) => setError(errorMessage(reason, t("map.sizeFailed"))))}
        onApplyBlueprintSizeToSameBlueprint={(id) => void applySizeToSameBlueprint(id).catch((reason) => setError(errorMessage(reason, t("map.sizeFailed"))))}
        onReconnectCable={activeMap && physicalObjectDetailsDataSource && cableReconnectDataSource ? setReconnectCableId : undefined}
        onRenameCable={catalogInventoryDataSource && cableLabelDataSource ? (id, label) => void beginCableRename(id, label) : undefined}
        onConnectFromPort={connectFromPort}
        onBulkConnect={activeMap && physicalObjectDetailsDataSource && physicalEndpointConnectionWriteDataSource?.createBulkPhysicalConnections ? setBulkSourceId : undefined}
        onBulkDeleteCables={activeMap && cableDeleteDataSource?.previewBulkDelete && cableDeleteDataSource.bulkDelete ? setBulkDeleteSourceId : undefined}
        onDisconnect={(connectionId, label) => void disconnectPort(connectionId, label).catch((reason) => setError(errorMessage(reason, t("map.disconnectFailed"))))}
        onDeleteObject={(id, label) => { if (window.confirm(t("map.context.deleteObjectConfirm", { name: label }))) void deletePhysicalObject(id).catch((reason) => setError(errorMessage(reason, t("map.deleteObjectFailed")))); }}
        onDeleteCable={(id, label) => { if (window.confirm(t("map.context.deleteCableConfirm", { name: label }))) void deleteCable(id).catch((reason) => setError(errorMessage(reason, t("map.deleteCableFailed")))); }}
      />}
      {blueprintSizeDialog && <section className="map-dialog" role="dialog" aria-modal="true" aria-label={t("map.size.title")}><div className="map-dialog__surface">
        <h2>{t("map.size.title")}</h2>
        <label>{t("map.size.width")}<input autoFocus type="number" min="1" step="1" value={blueprintSizeDialog.draft} onChange={(event) => { setBlueprintSizeError(null); setBlueprintSizeDialog((current) => current ? { ...current, draft: event.target.value } : null); }} /></label>
        {blueprintSizeError && <p role="alert">{blueprintSizeError}</p>}
        <div className="map-dialog__actions"><button type="button" disabled={blueprintSizePending} onClick={() => setBlueprintSizeDialog(null)}>{t("map.size.cancel")}</button><button type="button" disabled={blueprintSizePending || !Number.isFinite(Number(blueprintSizeDialog.draft)) || Number(blueprintSizeDialog.draft) <= 0} onClick={() => void (async () => {
          setBlueprintSizePending(true); setBlueprintSizeError(null);
          try { await resizeBlueprint(blueprintSizeDialog.id, Number(blueprintSizeDialog.draft)); setBlueprintSizeDialog(null); }
          catch { setBlueprintSizeError(t("map.size.failed")); }
          finally { setBlueprintSizePending(false); }
        })()}>{t("map.size.apply")}</button></div>
      </div></section>}
      {cableRename && cableLabelDataSource && <CableRenameDialog cableId={cableRename.cableId} userLabel={cableRename.userLabel} fallback={cableRename.fallback} dataSource={cableLabelDataSource} refresh={refreshCableRename} onClose={() => setCableRename(null)} />}
      <div className="map-page__errors">
      {presentationVariantCreationRefresh?.status === "refresh-failed" && <section role="alert"><p>Компоновка создана, но карту не удалось обновить.</p><button type="button" onClick={() => void retryPresentationVariantCreationRefresh()}>Повторить обновление</button></section>}
      {variantDeletion?.status === "refresh-failed" && <section role="alert"><p>Компоновка удалена, но карту не удалось обновить.</p><button type="button" onClick={() => void retryPresentationVariantDeletionRefresh()}>Повторить обновление</button></section>}
      {error && <p role="alert">{error}</p>}
      </div>
      {document &&
        params.get("focus") &&
        !nodeForPhysicalObject(document.nodes, params.get("focus")!) && (
          <p>
            {t("map.objectMissing")}
          </p>
        )}
      {!legacy && maps?.length === 0 && (
        <section className="map-page__empty-state">
          <h2>{t("map.empty.title")}</h2>
          <button type="button" className="primary-action" onClick={() => setCreating(true)}>{t("map.create")}</button>
        </section>
      )}
      {!legacy && maps?.length && catalogInventory?.equipment.length === 0 && (
        <section className="map-page__first-run-assistance">
          <h2>{t("map.firstRun.title")}</h2>
          <p>{t("map.firstRun.body")}</p>
          <Link className="primary-action" to="/infrastructure/objects/new">{t("map.firstRun.cta")}</Link>
        </section>
      )}
      {(legacy || activeMap) && (
        <>
          {!physicalAnnotationMode && <TraceCommandBar
            catalogInventoryDataSource={catalogInventoryDataSource}
            physicalObjectDetailsDataSource={physicalObjectDetailsDataSource}
            traceDataSource={traceDataSource}
            traceArtifact={traceArtifact}
            selectedBranchId={selectedTraceBranchId}
            onSelectedBranchId={(id) => {
              if (currentTraceScope.current === traceScope) setSelectedTraceBranchId(id);
            }}
            onTraceArtifact={(artifact) => {
              if (currentTraceScope.current !== traceScope) return;
              if (!artifact) {
                clearTrace();
                return;
              }
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
          {!physicalAnnotationMode && traceViewNotice && viewMode === "physical" && <p className="map-page__trace-notice" role="status">{traceViewNotice}</p>}
          <section className="map-page__canvas">
            {!document && <ViewState kind="loading" />}
            {document && (
              <ReactFlowProvider>
                <TopologyCanvas
                  document={document}
                  focusPhysicalObjectId={params.get("focus")}
                  selection={physicalAnnotationMode ? null : selection}
                  onSelectionChange={(nextSelection) => {
                    setContextAnchor(null);
                    if (nextSelection?.type !== "continuation")
                      setContinuationAnchor(null);
                    setSelection(nextSelection);
                  }}
                  arrangement={locationArrangement}
                  sceneKey={presentationSceneKey}
                  showAllVirtualChannels={showAllVirtualChannels}
                  positionOverrides={!legacy ? positions : undefined}
                  positionSnapshot={activeMap?.placements}
                  displayWidthOverrides={!legacy && viewMode === "physical" ? displayWidthOverrides : undefined}
                  requireLocationChannels={Boolean(activeMap && locationDataSource)}
                  faceViews={faceViews}
                  onFaceChange={writeFace}
                  faceBusy={faceBusy}
                  locationFrameInput={!legacy && viewMode === "physical" && activeMap && locations
                    ? { automatic: activeVariant?.automatic_layout, variantId: activeMap.active_variant_ref.entity_id, onBoundaryPlacement: async (locationId, placement) => { const updated = await savedMapDataSource!.setLocationBoundaryPlacement!(activeMap.map_ref.entity_id, activeMap.active_variant_ref.entity_id, locationId, placement); setMap(current => current?.map_ref.entity_id === updated.map_ref.entity_id && current.active_variant_ref.entity_id === updated.active_variant_ref.entity_id ? updated : current); }, onGeometry: async (locationId, geometry) => { const updated = await savedMapDataSource!.setLocationGeometry!(activeMap.map_ref.entity_id, activeMap.active_variant_ref.entity_id, locationId, geometry); setMap(current => current?.map_ref.entity_id === updated.map_ref.entity_id && current.active_variant_ref.entity_id === updated.active_variant_ref.entity_id ? updated : current); }, locations, placements: activeMap.placements, states: activeMap.location_states ?? [], onCollapse: (locationId, collapsed) => { const state = locationStateFor(locationId); void writeLocationState(locationId, collapsed, state?.visible_direct_elements ?? []); }, onConfigure: openLocationConfig }
                    : undefined}
                  directlyAttachedCableIds={directlyAttachedCables}
                  draggableNodeIds={!legacy ? draggableNodeIds : undefined}
                  lockedNodeIds={!legacy ? lockedNodeIds : undefined}
                  authoritativePositionRevision={authoritativePositionRevision}
                  onPhysicalNodeDragStop={!legacy && !physicalAnnotationMode ? move : undefined}
                  onBlueprintDisplayResize={!legacy && viewMode === "physical" && !physicalAnnotationMode ? (id, displayWidth) => {
                    void resizeBlueprint(id, displayWidth).catch((reason) => setError(errorMessage(reason, t("map.sizeFailed"))));
                  } : undefined}
                  annotationMode={physicalAnnotationMode ? {
                    annotationPlacement: textAnnotationEdit?.status === 'placing',
                    previewAnnotation: textAnnotationPreview,
                    selectedAnnotationId: selectedTextAnnotationId,
                    editableAnnotationId: textAnnotationEdit?.status === 'editing' && textAnnotationEdit.annotationId ? textAnnotationEdit.annotationId : null,
                    onAnnotationPlace: (position) => setTextAnnotationEdit((current) => current?.status === 'placing' ? { ...current, position, status: 'editing' } : current),
                    onAnnotationSelect: (annotationId) => { if (!textAnnotationOperationActive) setSelectedTextAnnotationId((current) => current === annotationId ? null : annotationId); },
                    onMoveAnnotation: (annotationId, position) => setTextAnnotationEdit((current) => current?.status === 'editing' && current.annotationId === annotationId ? { ...current, position, error: null } : current),
                  } : undefined}
                  onNodeCollisionRejected={() =>
                    setError(t("map.collision"))
                  }
                  disableAutoLayout={!legacy}
                  traceOverlay={traceOverlay}
                  traceOwnsFaces={traceOwnsFaces}
                  viewportFitRevision={viewportFitRevision}
                  wiringRoute={!physicalAnnotationMode && (wiring.status === "selecting-target" || wiring.status === "confirming" || wiring.status === "creating") ? { source: wiring.source, target: wiring.status === "selecting-target" ? undefined : wiring.target } : undefined}
                  physicalPortStates={physicalAnnotationMode ? undefined : physicalPortStates}
                  wiringHighlightedConnectionMemberIds={wiringInternalContinuity.members}
                  wiringContinuationConnectionPointIds={wiringInternalContinuity.points}
                  onPhysicalPortClick={!physicalAnnotationMode && (wiring.status === "selecting-source" || wiring.status === "selecting-target") ? onPhysicalPortClick : undefined}
                  onViewportCenterReady={
                    viewMode === "physical" ? receiveViewportCenter : undefined
                  }
                  onPhysicalPaneContextMenu={
                    viewMode === "physical" && !physicalAnnotationMode
                      ? (anchor, screen) => !contextBusy && setContextAnchor({ kind: "empty", anchor, screen })
                      : undefined
                  }
                  onPhysicalNodeContextMenu={viewMode === "physical" && !physicalAnnotationMode ? (node, screen) => {
                    if (contextBusy) return;
                    const id = physicalObjectIdForNode(node); if (!id) return;
                    setSelection({ type: "node", item: node });
                    setContextAnchor({ kind: "object", id, label: displayNodeLabel(node), locked: Boolean(activeMap?.placements.find((placement) => placement.physical_object_ref.entity_id === id)?.positions["L1/PHYSICAL_OBJECT"]?.locked), screen });
                  } : undefined}
                  onPhysicalCableContextMenu={viewMode === "physical" && !physicalAnnotationMode ? (node, screen) => {
                    if (contextBusy) return;
                    const id = cableIdForNode(node); if (!id) return;
                    setSelection({ type: "node", item: node });
                    setContextAnchor({ kind: "cable", id, label: displayNodeLabel(node), screen });
                  } : undefined}
                  onPhysicalPortContextMenu={viewMode === "physical" && !physicalAnnotationMode ? openPortContext : undefined}
                  onPaneClick={() => {
                    if (physicalAnnotationMode) return;
                    setContextAnchor(null);
                    setSelection(null);
                  }}
                  onContinuationClickAnchor={!physicalAnnotationMode ? (continuationId, anchor) =>
                    mapId &&
                    setContinuationAnchor({ continuationId, mapId, anchor })
                  : undefined}
                  textAnnotations={viewMode === "physical" ? activeMap?.text_annotations : undefined}
                />
              </ReactFlowProvider>
            )}
          </section>
        </>
      )}
      <QuickInspector
        document={document}
        selection={physicalAnnotationMode ? null : selection}
        onSelectNode={(node) => setSelection({ type: "node", item: node })}
        onSelectContinuation={(item) => {
          setContinuationAnchor(null);
          setSelection({ type: "continuation", item });
        }}
        onClose={() => setSelection(null)}
        onAddContinuationToMap={
          !legacy && viewMode === "physical"
            ? addContinuationAtViewportCenter
            : undefined
        }
        physicalObjectDetailsDataSource={physicalObjectDetailsDataSource}
        catalogInventoryDataSource={catalogInventoryDataSource}
        mapOperation={mapOperation?.mapId === mapId ? mapOperation : null}
        onRetryMapRefresh={retryMapRefresh}
      />
      {locationConfigId && viewMode === 'physical' && <LocationSettingsDialog
        arrangement={locationArrangement}
        collapseBusy={locationStateBusy}
        key={locationConfigId}
        name={locations?.find(location => location.location_ref.entity_id === locationConfigId)?.name ?? locationConfigId}
        onClose={() => setLocationConfigId(null)}
        layout={activeVariant?.automatic_layout?.mode === 'uniform_grid' ? <>
          <LocationGridSorting parent={locationConfigId}
            table={gridTables(locations ?? [], (locationArrangement.preview ?? activeVariant.automatic_layout).tables)[locationConfigId] ?? []}
            locations={locations ?? []} arrangement={locationArrangement} />
          <GridObjectSequenceControls parent={locationConfigId} labels={layoutObjectLabels} arrangement={locationArrangement} />
        </> : undefined}
      >
        {faceViews && writeFace && <PhysicalFaceSelect allowInherit disabled={faceBusy}
          value={locationStateFor(locationConfigId)?.face_override ?? 'INHERIT'}
          onChange={face => void writeFace(face, { kind: 'locations', id: locationConfigId })} />}
        <p>Оставить видимыми при сворачивании:</p>
        <div className="map-location-dialog__choices">
          {directLocationChoices === null ? <p>Загрузка…</p> : directLocationChoices.map(({ ref, label }) => {
            const checked = locationConfigVisible.some((item) => item.entity_type === ref.entity_type && item.entity_id === ref.entity_id);
            return <label key={`${ref.entity_type}:${ref.entity_id}`} className={`map-location-choice${checked ? ' map-location-choice--selected' : ''}`}><input type="checkbox" checked={checked} onChange={(event) => setLocationConfigVisible((current) => event.target.checked ? [...current, ref] : current.filter((item) => item.entity_type !== ref.entity_type || item.entity_id !== ref.entity_id))} /><span>{label}</span>{ref.entity_type === 'Location' && <small>местоположение</small>}</label>;
          })}
        </div>
        <div className="map-dialog__actions"><button type="button" disabled={locationStateBusy} onClick={() => setLocationConfigId(null)}>Отмена</button><button type="button" disabled={locationStateBusy || directLocationChoices === null} onClick={() => void writeLocationState(locationConfigId, locationStateFor(locationConfigId)?.collapsed ?? false, locationConfigVisible)}>Сохранить</button></div>
      </LocationSettingsDialog>}
    </main>
  );
}

export function MapPage(props: MapPageProps) {
  return <RuntimePortTypes><MapPageContent {...props} /></RuntimePortTypes>;
}
