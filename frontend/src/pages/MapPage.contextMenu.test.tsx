import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MapPage } from "./MapPage";
import { createMapPageHarness, objectTraceFixture } from "./MapPage.testHarness";
import type { CableReconnectDataSource } from "../topology/apiCableReconnectDataSource";

vi.mock("../components/TopologyCanvas", () => ({ TopologyCanvas: (props: any) => <div data-testid="canvas">
  <button onClick={() => props.onPhysicalNodeContextMenu?.(object, { x: 20, y: 20 })}>object menu</button>
  <button onClick={() => props.onPhysicalCableContextMenu?.(cable, { x: 20, y: 20 })}>cable menu</button>
  <button onClick={() => props.onPhysicalPortContextMenu?.({ physicalObjectId: "object", connectionPointId: "port", label: "P1" }, { x: 20, y: 20 })}>port menu</button>
  <button onClick={() => props.onPhysicalPaneContextMenu?.({ x: 41, y: 52 }, { x: 20, y: 20 })}>empty menu</button>
  <output data-testid="trace-faces">{String(props.traceOwnsFaces)}</output>
  <output data-testid="selected-node">{props.selection?.item?.id}</output>
  <output data-testid="projected-member">{props.document.edges[0]?.attributes.endpoint_pairs?.[0]?.from_member_index}</output>
</div> }));
const renderMapPage = createMapPageHarness(MapPage);

const ref = (entity_type: string, entity_id: string) => ({ ref_type: "CANONICAL_FACT", entity_type, entity_id });
const object: any = { id: "object-node", kind: "PHYSICAL_OBJECT", label: "Object", source_refs: [ref("PhysicalObject", "object")], attributes: { class: "switch", blueprint_presentation: { blueprint_ref: ref("BaseTemplate", "blueprint"), version_ref: ref("BaseTemplateRevision", "version"), body: { kind: "RECTANGLE", width: 2, height: 1 }, slots: [] }, connection_points: [{ connection_point_id: "port", display_name: "P1", cardinality: 1, external_connection_count: 0 }] } };
const cable: any = { id: "cable-node", kind: "CABLE", label: "Cable", source_refs: [ref("Cable", "cable")], attributes: {} };
const document: any = { schema_version: "1.0", layer: "L1", detail_level: "PHYSICAL_OBJECT", nodes: [object, cable], edges: [], gaps: [], warnings: [] };
const map: any = { map_ref: { entity_type: "SavedMap", entity_id: "map" }, name: "Map", active_variant_ref: ref("SavedMapVariant", "variant"), variants: [], placements: [{ physical_object_ref: ref("PhysicalObject", "object"), positions: { "L1/PHYSICAL_OBJECT": { x: 1, y: 2, locked: false, display_width: 240 } } }] };
const renderPage = (details: any, disconnect = vi.fn(), projection = vi.fn().mockResolvedValue(document), cableReconnectDataSource?: CableReconnectDataSource, tracing?: ReturnType<typeof objectTraceFixture>) => {
  const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createMap: vi.fn(), addPlacement: vi.fn(), removePlacement: vi.fn(), movePosition: vi.fn().mockResolvedValue(undefined), setPositionLock: vi.fn() };
  const catalog = vi.fn().mockResolvedValue({ schema_version: "1.0", equipment: tracing?.inventory.equipment ?? [], cables: [{ cable_ref: ref('Cable', 'cable'), connection_ref: ref('Connection', 'connection'), label: 'Cable deadbeef', label_source: 'TECHNICAL_FALLBACK', resolution: 'RESOLVED', endpoint_a: { remote_physical_object_ref: ref('PhysicalObject', 'object'), remote_physical_object_label: 'Object', remote_connection_point_ref: ref('ConnectionPoint', 'port-a'), remote_connection_point_label: 'P1', evidence_refs: [] }, endpoint_b: { remote_physical_object_ref: ref('PhysicalObject', 'other-object'), remote_physical_object_label: 'Other object', remote_connection_point_ref: ref('ConnectionPoint', 'port-b'), remote_connection_point_label: 'P2', evidence_refs: [] }, gaps: [], warnings: [] }], gaps: [], warnings: [] });
  const cableLabels = { setCableLabel: vi.fn().mockResolvedValue(undefined), generateCableLabel: vi.fn().mockResolvedValue(undefined), loadCableLabelTemplates: vi.fn().mockResolvedValue({ schema_version: '1.0', templates: [{ id: 'template', name: 'FC', description: 'Fiber', pattern: 'FC####', start_at: 1 }] }), loadCableLabelSettings: vi.fn(), setCableLabelSettings: vi.fn(), createCableLabelTemplate: vi.fn(), updateCableLabelTemplate: vi.fn(), deleteCableLabelTemplate: vi.fn() };
  renderMapPage({ traceDataSource: tracing?.traceDataSource, dataSource: { loadProjection: projection }, savedMapDataSource: maps, catalogInventoryDataSource: { loadCatalogInventory: catalog }, cableLabelDataSource: cableLabels, cableReconnectDataSource, physicalObjectDetailsDataSource: { loadPhysicalObjectDetails: vi.fn().mockImplementation(async id => typeof details === "function" ? details(id) : details) }, physicalEndpointConnectionWriteDataSource: { createPhysicalEndpointConnection: vi.fn(), deleteExternalPhysicalConnection: disconnect } }, "/map?map=map&view=physical");
  return { maps, disconnect, catalog, cableLabels, projection };
};
const detail = (attachments: any[] | undefined) => ({ schema_version: "1.0", physical_object: { source_ref: ref("PhysicalObject", "object"), label: "Object" }, connection_points: [{ connection_point_ref: ref("ConnectionPoint", "port"), label: "P1", cardinality: 1, external_physical_attachments: attachments }], owned_interface_count: 0, gaps: [], warnings: [] });

describe("MapPage UX.7 context menu", () => {
  it.each([
    { canReconnect: false, failRefresh: false },
    { canReconnect: true, failRefresh: false },
    { canReconnect: true, failRefresh: true },
  ])("uses Cable lifecycle for reconnect (eligible: $canReconnect, refresh fails: $failRefresh)", async ({ canReconnect, failRefresh }) => {
    const members = [{ index: 1, designation: "Alpha", occupied: true }, { index: 2, designation: "Beta", occupied: false }];
    const nodes = [{ ...object, attributes: { ...object.attributes, connection_points: [{
      ...object.attributes.connection_points[0], cardinality: 2, external_connection_count: 1, members,
    }] } }];
    const projected = (index: number) => ({ ...document, nodes, edges: [{
      id: "edge", from_node_id: "object-node", to_node_id: "other-node", source_refs: [], attributes: { endpoint_pairs: [{
        cable_ref: ref("Cable", "cable"), cable_display_name: "Cable", cable_can_reconnect: canReconnect,
        connection_id: "link", connection_member_id: "wire", from_connection_point_id: "port",
        from_member_index: index, to_connection_point_id: "other-port", to_member_index: 1,
      }] },
    }] });
    const expected = { connection_id: "link", connection_member_id: "wire", point_a_id: "port", point_b_id: "other-port",
      point_a_member: 1, point_b_member: 1, label: "Cable" };
    const projection = vi.fn().mockResolvedValue(projected(1));
    const writer = {
      preview: vi.fn().mockResolvedValue({ expected, object_a_id: "object", object_b_id: "other", display_label: "Cable" }),
      previewCompatibility: vi.fn().mockResolvedValue({ verdict: "ALLOW", token: "token", pairs: [] }),
      reconnect: vi.fn().mockImplementation(async () => { projection.mockResolvedValue(projected(2)); }),
    };
    const tracing = failRefresh ? objectTraceFixture("object", "other") : undefined;
    const { catalog } = renderPage((id: string) => {
      const result = detail([]);
      return { ...result, connection_points: id === "object"
        ? [{ ...result.connection_points[0], cardinality: 2, members, external_connection_count: 1 }]
        : [{ ...result.connection_points[0], connection_point_ref: ref("ConnectionPoint", "other-port") }] };
    }, vi.fn(), projection, writer, tracing);
    await screen.findByTestId("canvas");
    if (tracing) { await tracing.submit(); await screen.findByText("Физический L1-путь доказан"); }
    fireEvent.click(screen.getByText("cable menu"));
    const action = screen.queryByRole("menuitem", { name: "Переподключить" });
    if (!canReconnect) {
      expect(action).toBeNull();
      return;
    }
    expect(action).toBeInTheDocument();
    fireEvent.click(action!);
    const dialog = within(await screen.findByRole("dialog", { name: "Переподключить" }));
    fireEvent.change(await dialog.findByLabelText("Целевой физический объект"), { target: { value: "object" } });
    fireEvent.change(await dialog.findByLabelText("Порт"), { target: { value: "port" } });
    fireEvent.change(dialog.getByLabelText("Канал назначения"), { target: { value: "2" } });
    fireEvent.click(dialog.getByRole("button", { name: "Предпросмотр" }));
    const submit = await dialog.findByRole("button", { name: "Подтвердить переподключение" });
    catalog.mockClear();
    if (failRefresh) projection.mockRejectedValueOnce(new Error("refresh failed"));
    fireEvent.click(submit);
    if (failRefresh) {
      const retry = await dialog.findByRole("button", { name: "Повторить обновление" });
      expect(screen.queryByText("Физический L1-путь доказан")).not.toBeInTheDocument();
      expect(screen.getByTestId("trace-faces")).toHaveTextContent("false");
      expect(screen.getByTestId("projected-member")).toHaveTextContent("1");
      fireEvent.click(retry);
    }
    await waitFor(() => expect(screen.getByTestId("projected-member")).toHaveTextContent("2"));
    expect(screen.getByTestId("selected-node")).toHaveTextContent(cable.id);
    await waitFor(() => expect(catalog).toHaveBeenCalled());
    expect(writer.reconnect).toHaveBeenCalledOnce();
  });
  it.each(['Back / PCIe2 / feth1', 'Renamed base port'])("uses the derived endpoint name %s in detached port menu and wiring source", async (contextualName) => {
    const moduleNode = { ...object, attributes: { ...object.attributes, connection_points: [{ connection_point_id: 'port', display_name: contextualName, cardinality: 1, external_connection_count: 0 }] } };
    const details = detail([]); details.connection_points[0].label = contextualName;
    renderPage(details, vi.fn(), vi.fn().mockResolvedValue({ ...document, nodes: [moduleNode] }));
    await screen.findByTestId('canvas'); fireEvent.click(screen.getByText('port menu'));
    expect(screen.getByText(contextualName)).toBeInTheDocument();
    await screen.findByRole('menuitem', { name: /Соединить от этого порта/ });
    fireEvent.click(screen.getByRole('menuitem', { name: /Соединить от этого порта/ }));
    expect(screen.getByText(`Источник: Object / ${contextualName}`)).toBeInTheDocument();
  });
  it("selects a Blueprint object and exposes its local size actions", async () => { renderPage(detail([])); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("object menu")); expect(screen.getByRole("menuitem", { name: "Открыть объект" })).toBeInTheDocument(); expect(screen.getByRole("menuitem", { name: "Изменить размер…" })).toBeInTheDocument(); expect(screen.getByRole("menuitem", { name: "Копировать размер" })).toBeInTheDocument(); expect(screen.getByRole("menuitem", { name: "Применить этот размер ко всем объектам шаблона…" })).toBeInTheDocument(); expect(screen.getByRole("menuitem", { name: "Убрать с карты" })).toBeInTheDocument(); });
  it("keeps copied Blueprint width session-local and applies it through the existing position write", async () => { const { maps } = renderPage(detail([])); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("object menu")); fireEvent.click(screen.getByRole("menuitem", { name: "Копировать размер" })); fireEvent.click(screen.getByText("object menu")); fireEvent.click(screen.getByRole("menuitem", { name: "Применить скопированный размер" })); await waitFor(() => expect(maps.movePosition).toHaveBeenCalledWith("map", "object", "physical", 1, 2, 240, "variant")); });
  it("opens a bounded size dialog that validates, cancels, and applies", async () => { const { maps } = renderPage(detail([])); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("object menu")); fireEvent.click(screen.getByRole("menuitem", { name: "Изменить размер…" })); expect(screen.getByRole("dialog", { name: "Размер на карте" })).toBeInTheDocument(); const input = screen.getByRole("spinbutton", { name: "Ширина" }); expect(input).toHaveValue(240); fireEvent.change(input, { target: { value: "0" } }); expect(screen.getByRole("button", { name: "Применить" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "Отмена" })); expect(screen.queryByRole("dialog", { name: "Размер на карте" })).not.toBeInTheDocument(); fireEvent.click(screen.getByText("object menu")); fireEvent.click(screen.getByRole("menuitem", { name: "Изменить размер…" })); fireEvent.change(screen.getByRole("spinbutton", { name: "Ширина" }), { target: { value: "300" } }); fireEvent.click(screen.getByRole("button", { name: "Применить" })); await waitFor(() => expect(maps.movePosition).toHaveBeenCalledWith("map", "object", "physical", 1, 2, 300, "variant")); });
  it("uses the existing same-Blueprint operation", async () => { const { maps } = renderPage(detail([])); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("object menu")); fireEvent.click(screen.getByRole("menuitem", { name: "Применить этот размер ко всем объектам шаблона…" })); await waitFor(() => expect(maps.movePosition).toHaveBeenCalledWith("map", "object", "physical", 1, 2, 240, "variant")); });
  it("offers rename and delete for the selected Cable", async () => { renderPage(detail([])); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("cable menu")); expect(screen.getByRole("menuitem", { name: "Переименовать кабель" })).toBeInTheDocument(); expect(screen.queryByRole("menuitem", { name: /трасс/i })).not.toBeInTheDocument(); expect(screen.getByRole("menuitem", { name: /Удалить кабель/ })).toBeInTheDocument(); });
  it("renames a fallback Cable from the shared dialog and refreshes the projection", async () => { const { cableLabels, projection } = renderPage(detail([])); await screen.findByTestId('canvas'); fireEvent.click(screen.getByText('cable menu')); fireEvent.click(screen.getByRole('menuitem', { name: 'Переименовать кабель' })); expect(await screen.findByRole('dialog')).toBeInTheDocument(); expect(screen.getByLabelText('Имя кабеля')).toHaveValue(''); fireEvent.change(screen.getByLabelText('Имя кабеля'), { target: { value: 'MAP-01' } }); fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); await waitFor(() => expect(cableLabels.setCableLabel).toHaveBeenCalledWith('cable', 'MAP-01')); expect(projection.mock.calls.length).toBeGreaterThan(1); });
  it("generates a Cable label and retries only projection refresh", async () => { const projection = vi.fn().mockResolvedValue(document); const { cableLabels } = renderPage(detail([]), vi.fn(), projection); await screen.findByTestId('canvas'); fireEvent.click(screen.getByText('cable menu')); fireEvent.click(screen.getByRole('menuitem', { name: 'Переименовать кабель' })); await screen.findByRole('dialog'); fireEvent.click(screen.getByRole('radio', { name: 'Сгенерировать по шаблону' })); await screen.findByRole('option', { name: 'FC' }); fireEvent.change(screen.getByLabelText('Шаблон'), { target: { value: 'template' } }); projection.mockRejectedValueOnce(new Error('refresh')).mockResolvedValue(document); fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать' })); await waitFor(() => expect(cableLabels.generateCableLabel).toHaveBeenCalledWith('cable', 'template')); expect(await screen.findByRole('button', { name: 'Повторить обновление' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' })); await waitFor(() => expect(cableLabels.generateCableLabel).toHaveBeenCalledTimes(1)); });
  it("starts selecting-target from an authoritative free exact port", async () => { renderPage(detail([])); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("port menu")); await screen.findByRole("menuitem", { name: /Соединить от этого порта/ }); fireEvent.click(screen.getByRole("menuitem", { name: /Соединить от этого порта/ })); expect(screen.getByText("Выберите конечный свободный порт")).toBeInTheDocument(); expect(screen.getByText("Источник: Object / P1")).toBeInTheDocument(); });
  it("disconnects an occupied port through its exact authoritative Connection", async () => { const disconnect = vi.fn().mockResolvedValue(undefined); vi.spyOn(window, "confirm").mockReturnValue(true); renderPage(detail([{ connection_ref: ref("Connection", "exact-connection"), kind: "CABLE", evidence_refs: [] }]), disconnect); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("port menu")); await screen.findByRole("menuitem", { name: /Разъединить/ }); fireEvent.click(screen.getByRole("menuitem", { name: /Разъединить/ })); await waitFor(() => expect(disconnect).toHaveBeenCalledWith("exact-connection")); });
  it("does not guess an ambiguous port and preserves empty-pane flow coordinates", async () => { renderPage(detail(undefined)); await screen.findByTestId("canvas"); fireEvent.click(screen.getByText("port menu")); expect(await screen.findByText("Для этого порта нет однозначного действия.")).toBeInTheDocument(); expect(screen.queryByRole("menuitem", { name: /Соединить от/ })).not.toBeInTheDocument(); fireEvent.click(screen.getByText("empty menu")); fireEvent.click(screen.getByRole("menuitem", { name: /Добавить на карту/ })); expect(await screen.findByText("Оборудование пока не создано.")).toBeInTheDocument(); });
});
