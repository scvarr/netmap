import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MapPage } from './MapPage';
import { createMapPageHarness } from './MapPage.testHarness';
import type { SavedMap, SavedMapDataSource } from '../topology/savedMapTypes';
import type { BlueprintPresentation, TopologyProjectionRequest } from '../topology/types';


vi.mock('../components/TopologyCanvas', () => ({
  TopologyCanvas: (p: any) => (
    <>
      <output data-testid="projection-nodes">{p.document.nodes.map((item: any) => item.id).join(' ')}</output>
      <output data-testid="projection-edges">{p.document.edges.map((item: any) => item.id).join(' ')}</output>
      <output data-testid="projection-widths">
        {Object.entries(p.displayWidthOverrides ?? {}).map(([id, width]) => `${id}:${width}`).join(' ')}
      </output>
      <button onClick={() => {
        const item = p.document.cableNode ?? p.document.nodes[0];
        p.onViewportCenterReady?.(() => ({ x: 12, y: 34 }));
        if (!p.onPhysicalCableContextMenu && !p.onPhysicalNodeContextMenu) p.onSelectionChange({ type: 'node', item });
        if (p.document.cableNode) p.onPhysicalCableContextMenu?.(item, { x: 12, y: 34 });
        else p.onPhysicalNodeContextMenu?.(item, { x: 12, y: 34 });
      }}>select</button>
      <button onClick={() => {
        p.onViewportCenterReady?.(() => ({ x: 12, y: 34 }));
        p.onSelectionChange({ type: 'continuation', item: p.document.l1_off_map_continuations?.[0] });
      }}>continuation</button>
      <button onClick={() => p.onNodeCollisionRejected?.()}>collision</button>
    </>
  ),
}));
const renderMapPage = createMapPageHarness(MapPage);
const A = 'map-a'; const O = 'object';
const node = { id: 'node', kind: 'PHYSICAL_OBJECT', label: 'SW1', attributes: { class: 'switch' }, source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: O }] };
const remoteBlueprintPresentation: { blueprint_presentation: BlueprintPresentation } = {
  blueprint_presentation: {
    blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'remote-template' },
    version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'remote-revision' },
    body: { kind: 'RECTANGLE', width: 100, height: 100 },
    panels: [{ panel_key: 'panel-1', panel_number: 1, display_name: 'Панель 1', x: 0, y: 0, width: 100, height: 100 }],
    slots: [{
      slot_key: 'remote-slot', display_name: 'B01', kind: 'CONNECTION_POINT', panel_key: 'panel-1',
      panel_local_position: { x: .5, y: .5 }, rendered_position: { x: .5, y: .5 },
      external_attachment: { x: .5, y: 0, side: 'TOP' }, connection_point_id: 'rp',
    }],
  },
};
const cableNode = { id: 'cable-node', kind: 'CABLE', label: 'C1', attributes: {}, source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: 'cable' }] };
const continuation = { id: 'c', local_node_id: 'node', local_physical_object_ref: node.source_refs[0], local_connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'p' }, local_connection_point_display_name: 'A01', cable_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: 'cable' }, cable_display_name: 'C1', remote_physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'remote' }, remote_display_name: 'PP1', remote_connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'rp' }, remote_connection_point_display_name: 'B01', source_refs: [] };
const doc: any = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [node], edges: [], gaps: [], warnings: [], l1_off_map_continuations: [continuation] };
const VARIANT = 'variant-a';
const map: SavedMap = { map_ref: { entity_type: 'SavedMap', entity_id: A }, active_variant_ref: { entity_type: 'MapPresentationVariant', entity_id: VARIANT }, variants: [{ variant_ref: { entity_type: 'MapPresentationVariant', entity_id: VARIANT }, name: 'Основной' }], name: 'A', created_at: 'x', updated_at: 'x', placements: [{ physical_object_ref: node.source_refs[0], positions: { 'L1/PHYSICAL_OBJECT': { x: 1, y: 2, locked: false } } }], text_annotations: [] };
const collapsedCableDocument: any = { ...doc, cableNode, nodes: [node, { ...node, id: 'right', source_refs: [{ ...node.source_refs[0], entity_id: 'right' }] }], edges: [{ id: 'cable-link', from_node_id: 'node', to_node_id: 'right', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: { endpoint_pairs: [{ from_connection_point_id: 'left-cp', from_member_index: 1, to_connection_point_id: 'right-cp', to_member_index: 1, connection_id: 'connection', connection_member_id: 'member', cable_ref: cableNode.source_refs[0] }] } }] };
const cableMap: SavedMap = {
  ...map,
  placements: [
    ...map.placements,
    { physical_object_ref: collapsedCableDocument.nodes[1].source_refs[0], positions: { 'L1/PHYSICAL_OBJECT': { x: 200, y: 2, locked: false } } },
  ],
};
const remoteNode = {
  ...node, id: 'remote-node', label: 'PP1',
  attributes: { ...node.attributes, ...remoteBlueprintPresentation },
  source_refs: [{ ...node.source_refs[0], entity_id: 'remote' }],
};
const remotePlacement = {
  physical_object_ref: remoteNode.source_refs[0],
  positions: { 'L1/PHYSICAL_OBJECT': { x: 100, y: 200, display_width: 32, locked: false } },
};
const cableDeletionMaps = (listMaps: SavedMapDataSource['listMaps'], loadMap: SavedMapDataSource['loadMap']): SavedMapDataSource => ({
  listMaps, loadMap,
  createMap: vi.fn(), deleteMap: vi.fn(), addPlacement: vi.fn(), removePlacement: vi.fn(),
  movePosition: vi.fn(), setPositionLock: vi.fn(),
  createTextAnnotation: vi.fn(), replaceTextAnnotation: vi.fn(), deleteTextAnnotation: vi.fn(),
});
const renderPage = (maps: any, remove = vi.fn(), document = doc) => renderMapPage({
  dataSource: {
    loadProjection: vi.fn(async (request) => {
      const ids = request.scope.include_entities.map((ref: { entity_id: string }) => ref.entity_id);
      if (!ids.includes('remote')) return document;
      return {
        ...document,
        nodes: ids.length === 1 ? [remoteNode] : [...document.nodes, remoteNode],
        l1_off_map_continuations: [],
      };
    }),
  },
  deviceDetailsDataSource: { loadDeviceDetails: vi.fn() },
  savedMapDataSource: maps,
  physicalObjectDeleteDataSource: { deletePhysicalObject: remove },
  cableDeleteDataSource: { deleteCable: remove },
}, `/map?map=${A}&view=physical`);


describe('MapPage mutation lifecycles', () => {
  it('shows local collision feedback without starting a position write', async () => { const movePosition = vi.fn(); const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), removePlacement: vi.fn(), addPlacement: vi.fn(), movePosition, setPositionLock: vi.fn(), createMap: vi.fn() }; renderPage(maps); await screen.findByText('collision'); fireEvent.click(screen.getByText('select')); fireEvent.click(screen.getByText('collision')); expect(await screen.findByRole('alert')).toHaveTextContent('Объекты нельзя размещать друг на друге.'); expect(movePosition).not.toHaveBeenCalled(); expect(screen.getByRole('heading', { name: 'SW1' })).toBeInTheDocument(); });
  it('keeps selection and reports remove write failure', async () => { const removePlacement = vi.fn().mockRejectedValue(new Error('remove failed')); const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), removePlacement, addPlacement: vi.fn(), movePosition: vi.fn(), createMap: vi.fn() }; renderPage(maps); await screen.findByText('select'); fireEvent.click(screen.getByText('select')); fireEvent.click(screen.getByRole('menuitem', { name: 'Убрать с карты' })); expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось убрать объект с карты.'); expect(screen.getByRole('heading', { name: 'SW1' })).toBeInTheDocument(); });
  it('allows a continuation write retry after an add failure', async () => {
    const addPlacement = vi.fn().mockRejectedValueOnce(new Error('add failed')).mockResolvedValueOnce(undefined);
    const addedMap = { ...map, placements: [...map.placements, remotePlacement] };
    const loadMap = vi.fn().mockResolvedValueOnce(map).mockResolvedValueOnce(map).mockResolvedValueOnce(addedMap);
    const maps = { listMaps: vi.fn().mockResolvedValue([map]), loadMap, removePlacement: vi.fn(), addPlacement, movePosition: vi.fn(), createMap: vi.fn() };
    renderPage(maps);
    fireEvent.click(await screen.findByText('continuation'));
    const add = screen.getByRole('button', { name: 'Добавить на карту' });

    fireEvent.click(add);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось добавить объект на карту.');
    expect(addPlacement).toHaveBeenCalledExactlyOnceWith(A, 'remote', expect.any(Number), expect.any(Number), 32, VARIANT);
    expect(loadMap).toHaveBeenCalledTimes(2);
    expect(add).toBeEnabled();

    fireEvent.click(add);
    await waitFor(() => expect(screen.getByTestId('projection-nodes')).toHaveTextContent('node remote-node'));
    expect(addPlacement).toHaveBeenCalledTimes(2);
    expect(addPlacement).toHaveBeenNthCalledWith(2, A, 'remote', expect.any(Number), expect.any(Number), 32, VARIANT);
  });
  it('keeps inspector on delete write failure', async () => { const remove = vi.fn().mockRejectedValue(new Error('delete failed')); const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), removePlacement: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), createMap: vi.fn() }; vi.spyOn(window, 'confirm').mockReturnValue(true); renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(doc) }, deviceDetailsDataSource: { loadDeviceDetails: vi.fn() }, savedMapDataSource: maps, physicalObjectDeleteDataSource: { deletePhysicalObject: remove } }, `/map?map=${A}&view=physical`); await screen.findByText('select'); fireEvent.click(screen.getByText('select')); fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить объект из NetMap…' })); expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось удалить объект из NetMap.'); expect(screen.queryByText('delete failed')).not.toBeInTheDocument(); expect(remove).toHaveBeenCalledTimes(1); expect(screen.getByRole('heading', { name: 'SW1' })).toBeInTheDocument(); });
  it('refreshes the authoritative projection after deleting a cable even when map membership is unchanged', async () => {
    const loadProjection = vi.fn().mockResolvedValueOnce(collapsedCableDocument).mockResolvedValue({ ...collapsedCableDocument, nodes: [node], edges: [] });
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValueOnce(map).mockResolvedValueOnce(map).mockResolvedValueOnce(map), removePlacement: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), createMap: vi.fn() };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderMapPage({ dataSource: { loadProjection }, deviceDetailsDataSource: { loadDeviceDetails: vi.fn() }, savedMapDataSource: maps, physicalObjectDeleteDataSource: { deletePhysicalObject: vi.fn().mockResolvedValue(undefined) }, cableDeleteDataSource: { deleteCable: vi.fn().mockResolvedValue(undefined) } }, `/map?map=${A}&view=physical`);
    await screen.findByText('select');
    fireEvent.click(screen.getByText('select'));
    const initialProjectionLoads = loadProjection.mock.calls.length;

    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить кабель и разорвать физическое соединение…' }));
    await waitFor(() => expect(loadProjection.mock.calls.length).toBeGreaterThan(initialProjectionLoads));
    expect(maps.loadMap).toHaveBeenCalledTimes(3);
  });
  it('does not repeat a successful remove when its authoritative refresh fails', async () => {
    const removePlacement = vi.fn().mockResolvedValue(undefined);
    const maps = {
      listMaps: vi.fn().mockResolvedValue([map]),
      loadMap: vi.fn().mockResolvedValueOnce(map).mockResolvedValueOnce(map)
        .mockRejectedValueOnce(new Error('refresh failed')).mockResolvedValueOnce({ ...map, placements: [] }),
      removePlacement, addPlacement: vi.fn(), movePosition: vi.fn(), createMap: vi.fn(),
    };
    renderPage(maps);
    fireEvent.click(await screen.findByText('select'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Убрать с карты' }));
    await screen.findByText('Объект убран с карты, но карту не удалось обновить.');
    expect(removePlacement).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'SW1' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(screen.getByTestId('projection-nodes')).toBeEmptyDOMElement());
    expect(screen.queryByRole('heading', { name: 'SW1' })).not.toBeInTheDocument();
    expect(maps.loadMap).toHaveBeenCalledTimes(4);
    expect(removePlacement).toHaveBeenCalledTimes(1);
  });
  it('does not repeat a successful continuation add when its authoritative refresh fails', async () => {
    const addPlacement = vi.fn().mockResolvedValue(undefined);
    const addedMap = { ...map, placements: [...map.placements, remotePlacement] };
    const maps = {
      listMaps: vi.fn().mockResolvedValue([map]),
      loadMap: vi.fn().mockResolvedValueOnce(map).mockResolvedValueOnce(map)
        .mockRejectedValueOnce(new Error('refresh failed')).mockResolvedValueOnce(addedMap),
      removePlacement: vi.fn(), addPlacement, movePosition: vi.fn(), createMap: vi.fn(),
    };
    renderPage(maps);
    fireEvent.click(await screen.findByText('continuation'));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить на карту' }));
    await screen.findByText('Объект добавлен, но карту не удалось обновить.');
    expect(addPlacement).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Добавить на карту' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(screen.getByTestId('projection-nodes')).toHaveTextContent('node remote-node'));
    expect(screen.queryByLabelText('Быстрый инспектор')).not.toBeInTheDocument();
    expect(maps.loadMap).toHaveBeenCalledTimes(4);
    expect(addPlacement).toHaveBeenCalledTimes(1);
  });
  it('does not repeat a successful equipment delete when its authoritative refresh fails', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const maps = {
      listMaps: vi.fn().mockResolvedValue([map]),
      loadMap: vi.fn().mockResolvedValueOnce(map).mockResolvedValueOnce(map)
        .mockRejectedValueOnce(new Error('refresh failed')).mockResolvedValueOnce({ ...map, placements: [] }),
      removePlacement: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), createMap: vi.fn(),
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage(maps, destroy);
    fireEvent.click(await screen.findByText('select'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить объект из NetMap…' }));
    await screen.findByText('Объект удалён, но карту не удалось обновить.');
    expect(destroy).toHaveBeenCalledExactlyOnceWith(O);

    fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(screen.getByTestId('projection-nodes')).toBeEmptyDOMElement());
    expect(maps.loadMap).toHaveBeenCalledTimes(4);
    expect(destroy).toHaveBeenCalledExactlyOnceWith(O);
  });
  it.each([false, true])('does not repeat a successful cable delete when its authoritative refresh fails (retry also fails: %s)', async (failedRetry) => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const loadMap = vi.fn()
      .mockResolvedValueOnce(cableMap)
      .mockResolvedValueOnce(cableMap)
      .mockRejectedValueOnce(new Error('refresh failed'));
    if (failedRetry) loadMap.mockRejectedValueOnce(new Error('retry failed'));
    loadMap.mockResolvedValueOnce(cableMap);
    const successfulRead = failedRetry ? 5 : 4;
    const loadProjection = vi.fn(async (_request: TopologyProjectionRequest) => loadMap.mock.calls.length < successfulRead
      ? collapsedCableDocument
      : { ...collapsedCableDocument, cableNode: undefined, edges: [] });
    const maps = cableDeletionMaps(vi.fn().mockResolvedValue([cableMap]), loadMap);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderMapPage({
      dataSource: { loadProjection },
      deviceDetailsDataSource: { loadDeviceDetails: vi.fn() },
      savedMapDataSource: maps,
      cableDeleteDataSource: { deleteCable: destroy },
    }, `/map?map=${A}&view=physical`);

    expect(await screen.findByTestId('projection-edges')).toHaveTextContent('cable-link');
    const physicalRequests = () => loadProjection.mock.calls.map(([request]) => request).filter(({ layer }) => layer === 'L1');
    const initialRequests = physicalRequests();
    expect(initialRequests).toHaveLength(1);
    fireEvent.click(screen.getByText('select'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить кабель и разорвать физическое соединение…' }));
    await screen.findByText('Объект удалён, но карту не удалось обновить.');
    expect(destroy).toHaveBeenCalledExactlyOnceWith('cable');
    expect(screen.getByTestId('projection-edges')).toHaveTextContent('cable-link');

    if (failedRetry) {
      fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
      expect(await screen.findByRole('button', { name: 'Повторить обновление' })).toBeEnabled();
      expect(loadMap).toHaveBeenCalledTimes(4);
      expect(physicalRequests()).toEqual(initialRequests);
      expect(destroy).toHaveBeenCalledExactlyOnceWith('cable');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Повторить обновление' })).not.toBeInTheDocument());
    expect(loadMap).toHaveBeenCalledTimes(successfulRead);
    expect(destroy).toHaveBeenCalledExactlyOnceWith('cable');
    await waitFor(() => expect(physicalRequests()).toEqual([initialRequests[0], initialRequests[0]]));
    await waitFor(() => expect(screen.getByTestId('projection-edges')).toBeEmptyDOMElement());
    expect(screen.getByTestId('projection-nodes')).toHaveTextContent(/^node right$/);
  });
  it('ignores a cable delete refresh that finishes after switching maps', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const otherNode = { ...node, id: 'other', source_refs: [{ ...node.source_refs[0], entity_id: 'other' }] };
    const otherMap: SavedMap = {
      ...map, map_ref: { ...map.map_ref, entity_id: 'map-b' }, name: 'B',
      placements: [{ ...map.placements[0], physical_object_ref: otherNode.source_refs[0] }],
    };
    let resolveRetry!: (value: typeof cableMap) => void;
    const retry = new Promise<typeof cableMap>((resolve) => { resolveRetry = resolve; });
    const loadMap = vi.fn(async (id: string) => id === A ? cableMap : otherMap)
      .mockResolvedValueOnce(cableMap)
      .mockResolvedValueOnce(cableMap)
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockReturnValueOnce(retry);
    const loadProjection = vi.fn(async (request: TopologyProjectionRequest) => request.scope.include_entities.some((ref) => ref.entity_id === 'other')
      ? { ...doc, nodes: [otherNode], l1_off_map_continuations: [] }
      : collapsedCableDocument);
    const maps = cableDeletionMaps(vi.fn().mockResolvedValue([cableMap, otherMap]), loadMap);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderMapPage({
      dataSource: { loadProjection },
      deviceDetailsDataSource: { loadDeviceDetails: vi.fn() },
      savedMapDataSource: maps,
      cableDeleteDataSource: { deleteCable: destroy },
    }, `/map?map=${A}&view=physical`);

    fireEvent.click(await screen.findByText('select'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить кабель и разорвать физическое соединение…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить обновление' }));
    expect(loadMap).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole('button', { name: 'Карты' }));
    fireEvent.click(screen.getByRole('option', { name: 'B' }));
    await waitFor(() => expect(screen.getByTestId('projection-nodes')).toHaveTextContent(/^other$/));
    const projectionLoads = loadProjection.mock.calls.length;

    await act(async () => { resolveRetry(cableMap); });
    expect(loadProjection).toHaveBeenCalledTimes(projectionLoads);
    expect(screen.getByTestId('projection-nodes')).toHaveTextContent(/^other$/);
    expect(screen.getByTestId('projection-edges')).toBeEmptyDOMElement();
    expect(destroy).toHaveBeenCalledExactlyOnceWith('cable');
  });
  it('acknowledges a successful placement lock locally without reloading map or projection', async () => { const setPositionLock = vi.fn().mockResolvedValue(undefined); const loadProjection = vi.fn().mockResolvedValue(doc); const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), removePlacement: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), setPositionLock, createMap: vi.fn() }; renderMapPage({ dataSource: { loadProjection }, deviceDetailsDataSource: { loadDeviceDetails: vi.fn() }, savedMapDataSource: maps }, `/map?map=${A}&view=physical`); await screen.findByText('select'); fireEvent.click(screen.getByText('select')); const mapLoads = maps.loadMap.mock.calls.length; const projectionLoads = loadProjection.mock.calls.length; fireEvent.click(await screen.findByRole('menuitem', { name: 'Зафиксировать положение' })); await waitFor(() => expect(setPositionLock).toHaveBeenCalledWith(A, O, 'physical', true, VARIANT)); expect(maps.loadMap).toHaveBeenCalledTimes(mapLoads); expect(loadProjection).toHaveBeenCalledTimes(projectionLoads); fireEvent.click(screen.getByText('select')); expect(screen.getByRole('menuitem', { name: 'Разблокировать положение' })).toBeInTheDocument(); });
  it('keeps the last confirmed placement lock state after a failed write', async () => { const setPositionLock = vi.fn().mockRejectedValue(new Error('lock failed')); const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), removePlacement: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), setPositionLock, createMap: vi.fn() }; renderPage(maps); await screen.findByText('select'); fireEvent.click(screen.getByText('select')); fireEvent.click(await screen.findByRole('menuitem', { name: 'Зафиксировать положение' })); expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось изменить фиксацию положения.'); fireEvent.click(screen.getByText('select')); expect(screen.getByRole('menuitem', { name: 'Зафиксировать положение' })).toBeInTheDocument(); });
  it('applies size to every placement with the same Blueprint identity, not only the same immutable version', async () => {
    const presentation = (blueprintId: string, versionId: string) => ({ blueprint_presentation: { blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: blueprintId }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: versionId }, body: { kind: 'RECTANGLE', width: 100, height: 100 }, panels: [{ panel_key: 'panel-1', panel_number: 1, display_name: 'Панель 1', x: 0, y: 0, width: 100, height: 100 }], slots: [] } });
    const sibling = { ...node, id: 'sibling', label: 'SW2', attributes: { ...node.attributes, ...presentation('bp-1', 'version-2') }, source_refs: [{ ...node.source_refs[0], entity_id: 'sibling' }] };
    const different = { ...node, id: 'different', label: 'SW3', attributes: { ...node.attributes, ...presentation('bp-2', 'version-1') }, source_refs: [{ ...node.source_refs[0], entity_id: 'different' }] };
    const blueprintNode = { ...node, attributes: { ...node.attributes, ...presentation('bp-1', 'version-1') } };
    const blueprintDocument = { ...doc, nodes: [blueprintNode, sibling, different] };
    const blueprintMap = { ...map, placements: [
      { physical_object_ref: blueprintNode.source_refs[0], positions: { 'L1/PHYSICAL_OBJECT': { x: 1, y: 2, display_width: 180 } } },
      { physical_object_ref: sibling.source_refs[0], positions: { 'L1/PHYSICAL_OBJECT': { x: 3, y: 4, display_width: 220 } } },
      { physical_object_ref: different.source_refs[0], positions: { 'L1/PHYSICAL_OBJECT': { x: 5, y: 6, display_width: 260 } } },
    ] };
    const movePosition = vi.fn().mockResolvedValue(undefined);
    const maps: any = { listMaps: vi.fn().mockResolvedValue([blueprintMap]), loadMap: vi.fn().mockResolvedValue(blueprintMap), createMap: vi.fn(), movePosition, removePlacement: vi.fn(), addPlacement: vi.fn() };
    renderPage(maps, vi.fn(), blueprintDocument);
    await screen.findByText('select');
    fireEvent.click(screen.getByText('select'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Изменить размер…' }));
    const dialog = screen.getByRole('dialog', { name: 'Размер на карте' });
    expect(within(dialog).getByRole('spinbutton', { name: 'Ширина' })).toHaveValue(180);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    fireEvent.click(screen.getByText('select'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Применить этот размер ко всем объектам шаблона…' }));
    await waitFor(() => expect(movePosition).toHaveBeenCalledTimes(2));
    expect(movePosition).toHaveBeenNthCalledWith(1, A, O, 'physical', 1, 2, 180, VARIANT);
    expect(movePosition).toHaveBeenNthCalledWith(2, A, 'sibling', 'physical', 3, 4, 180, VARIANT);
  });

  it('reloads authoritative Saved Map after a bulk size write fails without repeating acknowledged writes', async () => {
    const presentation = (versionId: string) => ({ blueprint_presentation: { blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'bp-1' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: versionId }, body: { kind: 'RECTANGLE', width: 100, height: 100 }, panels: [{ panel_key: 'panel-1', panel_number: 1, display_name: 'Панель 1', x: 0, y: 0, width: 100, height: 100 }], slots: [] } });
    const sibling = { ...node, id: 'sibling', label: 'SW2', attributes: { ...node.attributes, ...presentation('version-2') }, source_refs: [{ ...node.source_refs[0], entity_id: 'sibling' }] };
    const blueprintNode = { ...node, attributes: { ...node.attributes, ...presentation('version-1') } };
    const sourcePlacement = { physical_object_ref: blueprintNode.source_refs[0], positions: { 'L1/PHYSICAL_OBJECT': { x: 1, y: 2, display_width: 180 } } };
    const siblingPlacement = { physical_object_ref: sibling.source_refs[0], positions: { 'L1/PHYSICAL_OBJECT': { x: 3, y: 4, display_width: 220 } } };
    const blueprintMap = { ...map, placements: [siblingPlacement, sourcePlacement] };
    const partiallyUpdated = { ...blueprintMap, placements: [
      { ...siblingPlacement, positions: { 'L1/PHYSICAL_OBJECT': { x: 3, y: 4, display_width: 180 } } },
      sourcePlacement,
    ] };
    const movePosition = vi.fn().mockResolvedValueOnce(partiallyUpdated).mockRejectedValueOnce(new Error('size failed'));
    const loadMap = vi.fn().mockResolvedValue(blueprintMap);
    const maps: any = { listMaps: vi.fn().mockResolvedValue([blueprintMap]), loadMap, createMap: vi.fn(), movePosition, removePlacement: vi.fn(), addPlacement: vi.fn() };
    renderPage(maps, vi.fn(), { ...doc, nodes: [blueprintNode, sibling] });
    await screen.findByText('select');
    const initialReads = loadMap.mock.calls.length;
    expect(screen.getByTestId('projection-widths')).toHaveTextContent('sibling:220');
    loadMap.mockResolvedValueOnce(partiallyUpdated);
    fireEvent.click(screen.getByText('select'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Применить этот размер ко всем объектам шаблона…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось применить размер на карте.');
    expect(screen.getByTestId('projection-widths')).toHaveTextContent('sibling:180');
    expect(screen.getByTestId('projection-widths')).toHaveTextContent('node:180');
    expect(loadMap).toHaveBeenCalledTimes(initialReads + 1);
    expect(loadMap).toHaveBeenLastCalledWith(A, VARIANT);
    expect(movePosition).toHaveBeenCalledTimes(2);
    expect(movePosition).toHaveBeenNthCalledWith(1, A, 'sibling', 'physical', 3, 4, 180, VARIANT);
    expect(movePosition).toHaveBeenNthCalledWith(2, A, O, 'physical', 1, 2, 180, VARIANT);
  });
});
