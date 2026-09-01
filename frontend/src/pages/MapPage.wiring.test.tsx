import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MapPage } from './MapPage';
import { createMapPageHarness } from './MapPage.testHarness';
import { ApiSavedMapDataSource } from '../topology/apiSavedMapDataSource';
import { HistoricalCableLabelReuseRequiredError } from '../topology/historicalCableLabelReuse';

vi.mock('../components/TopologyCanvas', () => ({ TopologyCanvas: (p: any) => <div data-testid="canvas"><button onClick={() => p.onPhysicalPortClick?.({ physicalObjectId: 'a', connectionPointId: 'a-cp', label: 'A01' })}>blueprint port</button><button onClick={() => p.onPhysicalPortClick?.({ physicalObjectId: 'b', connectionPointId: 'b-cp', label: 'B01' })}>generic port</button><button onClick={() => p.onPaneClick?.({ x: 10, y: 20 })}>pane 1</button><button onClick={() => p.onPaneClick?.({ x: 30, y: 40 })}>pane 2</button><button onClick={() => p.wiringRoute?.onWaypointMove(0, { x: 99, y: 88 })}>drag waypoint</button><span data-states={JSON.stringify(p.physicalPortStates)} data-waypoints={JSON.stringify(p.wiringRoute?.waypoints)} /></div> }));
const renderMapPage = createMapPageHarness(MapPage);
const map = { map_ref: { entity_type: 'SavedMap', entity_id: 'map-1' }, name: 'M1', placements: [{ physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'a' }, positions: { 'L1/PHYSICAL_OBJECT': { x: 0, y: 0 } } }, { physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'b' }, positions: { 'L1/PHYSICAL_OBJECT': { x: 1, y: 1 } } }] } as any;
const node = (id: string, label: string, cp: string, count = 0) => ({ id, kind: 'PHYSICAL_OBJECT', label, source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id }], attributes: { class: 'switch', connection_points: [{ connection_point_id: cp, display_name: cp === 'a-cp' ? 'A01' : 'B01', cardinality: 1, external_connection_count: count }] } });
const doc = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [node('a', 'Source', 'a-cp'), node('b', 'Target', 'b-cp')], edges: [], gaps: [], warnings: [] } as any;
const creation = { cable_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: 'cable-1' }, source: {}, target: {}, connection_refs: [] } as any;
const renderPage = (write = vi.fn().mockResolvedValue(creation), loadProjection = vi.fn().mockResolvedValue(doc), setCableRoute = vi.fn().mockResolvedValue(map), cableLabelDataSource: any = { loadCableLabelTemplates: vi.fn().mockResolvedValue({ schema_version: '1.0', templates: [{ id: 'template-1', name: 'FC', pattern: 'FC####', start_at: 1 }] }) }) => { const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createMap: vi.fn(), setCableRoute }; renderMapPage({ dataSource: { loadProjection }, savedMapDataSource: maps, physicalEndpointConnectionWriteDataSource: { createPhysicalEndpointConnection: write }, cableLabelDataSource }, '/map?map=map-1&view=physical'); return { write, loadProjection, maps, setCableRoute }; };
const apiResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('MapPage visual wiring', () => {
  it('keeps primary map controls usable while the transient trace dock opens and closes without saved-map writes', async () => {
    const { maps } = renderPage();
    await screen.findByTestId('canvas');
    const initialMapReads = maps.loadMap.mock.calls.length;
    const initialMapLists = maps.listMaps.mock.calls.length;
    await fireEvent.click(screen.getByRole('button', { name: 'Трассировка' }));
    expect(screen.getByLabelText('L1 трассировка PhysicalObject')).toHaveClass('trace-command--docked');
    fireEvent.click(screen.getByRole('button', { name: 'Соединить порты' }));
    expect(screen.getByText('Выберите исходный свободный порт')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(maps.loadMap).toHaveBeenCalledTimes(initialMapReads);
    expect(maps.listMaps).toHaveBeenCalledTimes(initialMapLists);
    expect(maps.setCableRoute).not.toHaveBeenCalled();
  });

  it('uses a non-modal selecting panel, keeps canvas clickable, then writes exact ports once', async () => {
    const { write, loadProjection } = renderPage();
    await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Соединить порты' }));
    expect(screen.getByLabelText('Соединить порты')).not.toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('canvas')).toBeInTheDocument();
    expect(screen.getByTestId('canvas').querySelector('span')?.getAttribute('data-states')).toContain('eligible');
    fireEvent.click(screen.getByRole('button', { name: 'blueprint port' }));
    expect(screen.getByText('Выберите конечный свободный порт')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'generic port' }));
    expect(screen.getByText('Источник: Source / A01')).toBeInTheDocument();
    expect(screen.getByText('Назначение: Target / B01')).toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith({ source: { kind: 'CONNECTION_POINT', connection_point_id: 'a-cp', member_index: 1 }, target: { kind: 'CONNECTION_POINT', connection_point_id: 'b-cp', member_index: 1 }, cable_label: null, cable_label_template_id: null, generate_cable_label: false, confirmed_historical_label: null }));
    expect(write).toHaveBeenCalledTimes(1); expect(loadProjection.mock.calls.length).toBeGreaterThan(1);
  });

  it('retries only projection refresh after a successful write', async () => {
    const write = vi.fn().mockResolvedValue(creation); let physicalReads = 0; const loadProjection = vi.fn((request: any) => request.layer === 'L1' && ++physicalReads === 2 ? Promise.reject(new Error('refresh')) : Promise.resolve(doc));
    renderPage(write, loadProjection); await screen.findByTestId('canvas'); fireEvent.click(screen.getByRole('button', { name: 'Соединить порты' })); fireEvent.click(screen.getByRole('button', { name: 'blueprint port' })); fireEvent.click(screen.getByRole('button', { name: 'generic port' })); fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    expect(await screen.findByText('Кабель и трасса сохранены, но карту не удалось обновить.')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' })); await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  });

  it('passes generated and manual Cable naming through the map create request and requires a template for generation', async () => {
    const { write } = renderPage(); await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Соединить порты' })); fireEvent.click(screen.getByRole('button', { name: 'blueprint port' })); fireEvent.click(screen.getByRole('button', { name: 'generic port' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Сгенерировать по шаблону' })); await screen.findByRole('option', { name: 'FC' }); expect(screen.getByRole('button', { name: 'Создать кабель' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Шаблон'), { target: { value: 'template-1' } }); expect(screen.getByRole('button', { name: 'Создать кабель' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(expect.objectContaining({ cable_label: null, cable_label_template_id: 'template-1', generate_cable_label: true })));
  });
  it('confirms exact historical generated label reuse without replaying post-write refresh', async () => {
    const write = vi.fn().mockRejectedValueOnce(new HistoricalCableLabelReuseRequiredError('FC0003')).mockResolvedValue(creation); const { loadProjection } = renderPage(write); await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Соединить порты' })); fireEvent.click(screen.getByRole('button', { name: 'blueprint port' })); fireEvent.click(screen.getByRole('button', { name: 'generic port' })); fireEvent.click(screen.getByRole('radio', { name: 'Сгенерировать по шаблону' })); await screen.findByRole('option', { name: 'FC' }); fireEvent.change(screen.getByLabelText('Шаблон'), { target: { value: 'template-1' } }); fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    expect(await screen.findByRole('heading', { name: 'Имя FC0003 использовалось ранее' })).toBeInTheDocument(); expect(write).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Использовать FC0003' })); await waitFor(() => expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ confirmed_historical_label: 'FC0003', cable_label_template_id: 'template-1', generate_cable_label: true }))); expect(loadProjection.mock.calls.length).toBeGreaterThan(1);
  });

  it('passes a manual Cable label through the map create request without generation', async () => {
    const { write } = renderPage(); await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Соединить порты' })); fireEvent.click(screen.getByRole('button', { name: 'blueprint port' })); fireEvent.click(screen.getByRole('button', { name: 'generic port' }));
    fireEvent.change(screen.getByLabelText('Имя кабеля'), { target: { value: 'MANUAL-01' } }); fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(expect.objectContaining({ cable_label: 'MANUAL-01', cable_label_template_id: null, generate_cable_label: false })));
  });

  it('keeps ordered pane route draft across confirmation and persists it against returned cable identity', async () => {
    const { write, setCableRoute } = renderPage(); await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Соединить порты' })); fireEvent.click(screen.getByRole('button', { name: 'blueprint port' }));
    expect(screen.getByTestId('canvas').querySelector('span')).toHaveAttribute('data-waypoints', '[]');
    fireEvent.click(screen.getByRole('button', { name: 'pane 1' })); fireEvent.click(screen.getByRole('button', { name: 'pane 2' }));
    expect(screen.getByText('Точек трассы: 2')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'generic port' }));
    fireEvent.click(screen.getByRole('button', { name: 'Назад' })); expect(screen.getByText('Точек трассы: 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'generic port' })); fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1)); expect(setCableRoute).toHaveBeenCalledWith('map-1', 'cable-1', [{ x: 10, y: 20 }, { x: 30, y: 40 }]);
  });

  it('does not write during route drafting and retries only route persistence after its failure', async () => {
    const setCableRoute = vi.fn().mockRejectedValueOnce(new Error('route')).mockResolvedValue(map); const { write } = renderPage(vi.fn().mockResolvedValue(creation), vi.fn().mockResolvedValue(doc), setCableRoute); await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Соединить порты' })); fireEvent.click(screen.getByRole('button', { name: 'blueprint port' })); fireEvent.click(screen.getByRole('button', { name: 'pane 1' })); fireEvent.click(screen.getByRole('button', { name: 'drag waypoint' }));
    expect(write).not.toHaveBeenCalled(); expect(setCableRoute).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'generic port' })); fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    expect(await screen.findByText('Кабель создан, но трассу не удалось сохранить.')).toBeInTheDocument(); expect(setCableRoute).toHaveBeenLastCalledWith('map-1', 'cable-1', [{ x: 99, y: 88 }]); fireEvent.click(screen.getByRole('button', { name: 'Повторить сохранение трассы' })); await waitFor(() => expect(setCableRoute).toHaveBeenCalledTimes(2)); expect(write).toHaveBeenCalledTimes(1);
  });

  it('uses ApiSavedMapDataSource acknowledgement and retries only the authoritative read after a malformed post-write response', async () => {
    const mapId = '00000000-0000-4000-8000-000000000001';
    const cableId = '00000000-0000-4000-8000-000000000003';
    const savedMap: any = { map_ref: { entity_type: 'SavedMap', entity_id: mapId }, name: 'M1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', placements: [{ physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: '00000000-0000-4000-8000-000000000011' }, positions: { 'L1/PHYSICAL_OBJECT': { x: 0, y: 0, locked: false } } }], cable_routes: [], regions: [], text_annotations: [] };
    let acknowledged = false; let postWriteReads = 0;
    const refreshedMap = { ...savedMap, cable_routes: [{ cable_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: cableId }, view: 'L1/PHYSICAL_OBJECT', waypoints: [] }] };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/v1/maps') return Promise.resolve(apiResponse({ maps: [savedMap] }));
      if ((init?.method ?? 'GET') === 'PUT') { acknowledged = true; return Promise.resolve(apiResponse({ acknowledged: true })); }
      if (acknowledged && postWriteReads++ === 0) return Promise.resolve(apiResponse({ malformed: true }));
      return Promise.resolve(apiResponse(acknowledged ? refreshedMap : savedMap));
    });
    vi.stubGlobal('fetch', fetchMock);
    const write = vi.fn().mockResolvedValue({ ...creation, cable_ref: { ...creation.cable_ref, entity_id: cableId } });
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(doc) }, savedMapDataSource: new ApiSavedMapDataSource(), physicalEndpointConnectionWriteDataSource: { createPhysicalEndpointConnection: write } }, `/map?map=${mapId}&view=physical`);
    await screen.findByTestId('canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Соединить порты' })); fireEvent.click(screen.getByRole('button', { name: 'blueprint port' })); fireEvent.click(screen.getByRole('button', { name: 'generic port' })); fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    expect(await screen.findByText('Кабель и трасса сохранены, но карту не удалось обновить.')).toBeInTheDocument();
    expect(screen.queryByText(/Malformed SavedMap response/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/cable-routes/') && (init as RequestInit).method === 'PUT')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(postWriteReads).toBe(2));
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/cable-routes/') && (init as RequestInit).method === 'PUT')).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
