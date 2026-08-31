import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MapPage } from "./MapPage";
import { createMapPageHarness } from "./MapPage.testHarness";

vi.mock("../components/TopologyCanvas", () => ({ TopologyCanvas: (props: any) => <div data-testid="canvas">
  <button onClick={() => props.onPhysicalNodeContextMenu?.(object, { x: 20, y: 20 })}>object menu</button>
  <button onClick={() => props.onPhysicalCableContextMenu?.(cable, { x: 20, y: 20 })}>cable menu</button>
  <button onClick={() => props.onPhysicalPortContextMenu?.({ physicalObjectId: "object", connectionPointId: "port", label: "P1" }, { x: 20, y: 20 })}>port menu</button>
  <button onClick={() => props.onPhysicalPaneContextMenu?.({ x: 41, y: 52 }, { x: 20, y: 20 })}>empty menu</button>
</div> }));
const renderMapPage = createMapPageHarness(MapPage);

const ref = (entity_type: string, entity_id: string) => ({ ref_type: "CANONICAL_FACT", entity_type, entity_id });
const object: any = { id: "object-node", kind: "PHYSICAL_OBJECT", label: "Object", source_refs: [ref("PhysicalObject", "object")], attributes: { class: "switch", connection_points: [{ connection_point_id: "port", display_name: "P1", cardinality: 1, external_connection_count: 0 }] } };
const cable: any = { id: "cable-node", kind: "CABLE", label: "Cable", source_refs: [ref("Cable", "cable")], attributes: {} };
const document: any = { schema_version: "1.0", layer: "L1", detail_level: "PHYSICAL_OBJECT", nodes: [object, cable], edges: [], gaps: [], warnings: [] };
const map: any = { map_ref: { entity_type: "SavedMap", entity_id: "map" }, name: "Map", placements: [{ physical_object_ref: ref("PhysicalObject", "object"), positions: { "L1/PHYSICAL_OBJECT": { x: 1, y: 2, locked: false } } }], cable_routes: [{ cable_ref: ref("Cable", "cable"), view: "L1/PHYSICAL_OBJECT", waypoints: [] }] };
const renderPage = (details: any, disconnect = vi.fn()) => {
  const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createMap: vi.fn(), addPlacement: vi.fn(), removePlacement: vi.fn(), setPositionLock: vi.fn(), setCableRoute: vi.fn(), deleteCableRoute: vi.fn() };
  renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps, catalogInventoryDataSource: { loadCatalogInventory: vi.fn().mockResolvedValue({ schema_version: "1.0", equipment: [], cables: [], gaps: [], warnings: [] }) }, physicalObjectDetailsDataSource: { loadPhysicalObjectDetails: vi.fn().mockResolvedValue(details) }, physicalEndpointConnectionWriteDataSource: { createPhysicalEndpointConnection: vi.fn(), deleteExternalPhysicalConnection: disconnect } }, "/map?map=map&view=physical");
  return { maps, disconnect };
};
const detail = (attachments: any[] | undefined) => ({ schema_version: "1.0", physical_object: { source_ref: ref("PhysicalObject", "object"), label: "Object" }, connection_points: [{ connection_point_ref: ref("ConnectionPoint", "port"), label: "P1", cardinality: 1, external_physical_attachments: attachments }], owned_interface_count: 0, gaps: [], warnings: [] });

describe("MapPage UX.7 context menu", () => {
  it("selects object and exposes object actions", async () => { renderPage(detail([])); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("object menu")); expect(screen.getByRole("menuitem", { name: "Открыть объект" })).toBeInTheDocument(); expect(screen.getByRole("menuitem", { name: "Убрать с карты" })).toBeInTheDocument(); expect(screen.getByRole("menuitem", { name: /Удалить объект/ })).toBeInTheDocument(); });
  it("exposes cable route and delete actions", async () => { renderPage(detail([])); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("cable menu")); expect(screen.getByRole("menuitem", { name: "Редактировать трассу" })).toBeInTheDocument(); expect(screen.getByRole("menuitem", { name: "Сбросить трассу" })).toBeInTheDocument(); expect(screen.getByRole("menuitem", { name: /Удалить кабель/ })).toBeInTheDocument(); });
  it("starts selecting-target from an authoritative free exact port", async () => { renderPage(detail([])); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("port menu")); await screen.findByRole("menuitem", { name: /Соединить от этого порта/ }); fireEvent.click(screen.getByRole("menuitem", { name: /Соединить от этого порта/ })); expect(screen.getByText("Выберите конечный свободный порт")).toBeInTheDocument(); expect(screen.getByText("Источник: Object / P1")).toBeInTheDocument(); });
  it("disconnects an occupied port through its exact authoritative Connection", async () => { const disconnect = vi.fn().mockResolvedValue(undefined); vi.spyOn(window, "confirm").mockReturnValue(true); renderPage(detail([{ connection_ref: ref("Connection", "exact-connection"), kind: "CABLE", evidence_refs: [] }]), disconnect); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("port menu")); await screen.findByRole("menuitem", { name: /Разъединить/ }); fireEvent.click(screen.getByRole("menuitem", { name: /Разъединить/ })); await waitFor(() => expect(disconnect).toHaveBeenCalledWith("exact-connection")); });
  it("does not guess an ambiguous port and preserves empty-pane flow coordinates", async () => { renderPage(detail(undefined)); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("port menu")); expect(await screen.findByText("Для этого порта нет однозначного действия.")).toBeInTheDocument(); expect(screen.queryByRole("menuitem", { name: /Соединить от/ })).not.toBeInTheDocument(); fireEvent.click(screen.getByText("empty menu")); fireEvent.click(screen.getByRole("menuitem", { name: /Добавить на карту/ })); expect(await screen.findByText("Оборудование пока не создано.")).toBeInTheDocument(); });
});
