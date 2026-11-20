import { selectCableType, stubCableCatalog } from '../testCableCatalog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MapPage } from './MapPage';
import { createMapPageHarness } from './MapPage.testHarness';

beforeEach(stubCableCatalog);
afterEach(() => vi.unstubAllGlobals());

vi.mock('../components/TopologyCanvas', () => ({ TopologyCanvas: (p: any) => <div data-testid="canvas"><button onClick={() => p.onPhysicalPortClick?.({ physicalObjectId: 'a', connectionPointId: 'a-cp', label: 'A01' })}>blueprint port</button><button onClick={() => p.onPhysicalPortClick?.({ physicalObjectId: 'b', connectionPointId: 'b-cp', label: 'B01' })}>generic port</button><button onClick={() => p.onPaneClick?.({ x: 10, y: 20 })}>pane 1</button><span data-states={JSON.stringify(p.physicalPortStates)} data-preview={JSON.stringify(p.wiringRoute)} /></div> }));
const renderMapPage = createMapPageHarness(MapPage);
const VARIANT = 'variant-1';
const map = { map_ref: { entity_type: 'SavedMap', entity_id: 'map-1' }, active_variant_ref: { entity_type: 'MapPresentationVariant', entity_id: VARIANT }, variants: [{ variant_ref: { entity_type: 'MapPresentationVariant', entity_id: VARIANT }, name: 'Основной' }], name: 'M1', placements: [{ physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'a' }, positions: { 'L1/PHYSICAL_OBJECT': { x: 0, y: 0 } } }, { physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'b' }, positions: { 'L1/PHYSICAL_OBJECT': { x: 1, y: 1 } } }] } as any;
const node = (id: string, label: string, cp: string, count = 0) => ({ id, kind: 'PHYSICAL_OBJECT', label, source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id }], attributes: { class: 'switch', connection_points: [{ connection_point_id: cp, display_name: cp === 'a-cp' ? 'A01' : 'B01', cardinality: 1, external_connection_count: count }] } });
const doc = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [node('a', 'Source', 'a-cp'), node('b', 'Target', 'b-cp')], edges: [], gaps: [], warnings: [] } as any;
const creation = { cable_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: 'cable-1' }, source: {}, target: {}, connection_refs: [] } as any;
const renderPage = (write = vi.fn().mockResolvedValue(creation), loadProjection = vi.fn().mockResolvedValue(doc), cableLabelDataSource: any = { loadCableLabelTemplates: vi.fn().mockResolvedValue({ schema_version: '1.0', templates: [{ id: 'template-1', name: 'FC', pattern: 'FC####', start_at: 1 }] }) }) => { const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createMap: vi.fn() }; renderMapPage({ dataSource: { loadProjection }, savedMapDataSource: maps, physicalEndpointConnectionWriteDataSource: { createPhysicalEndpointConnection: write }, cableLabelDataSource }, '/map?map=map-1&view=physical'); return { write, loadProjection, maps }; };
const startWiring = () => { fireEvent.click(screen.getByRole('button', { name: 'Инструменты' })); fireEvent.click(screen.getByRole('button', { name: 'Соединить порты' })); };

describe('MapPage visual wiring', () => {
  it('keeps primary map controls usable while the transient trace dock opens and closes without saved-map writes', async () => {
    const { maps } = renderPage();
    await screen.findByTestId('canvas');
    const initialMapReads = maps.loadMap.mock.calls.length;
    const initialMapLists = maps.listMaps.mock.calls.length;
    await fireEvent.click(screen.getByRole('button', { name: 'Трассировка' }));
    expect(screen.getByLabelText('Трассировка сети L1')).toHaveClass('trace-command--docked');
    startWiring();
    expect(screen.getByText('Выберите исходный свободный порт')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(maps.loadMap).toHaveBeenCalledTimes(initialMapReads);
    expect(maps.listMaps).toHaveBeenCalledTimes(initialMapLists);
  });

  it('creates the exact cable once without a route and refreshes both map and projection', async () => {
    const { write, loadProjection, maps } = renderPage();
    await screen.findByTestId('canvas');
    const mapReads = maps.loadMap.mock.calls.length;
    const projectionReads = loadProjection.mock.calls.length;
    startWiring();
    expect(screen.getByLabelText('Соединить порты')).not.toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('canvas')).toBeInTheDocument();
    expect(screen.getByTestId('canvas').querySelector('span')?.getAttribute('data-states')).toContain('eligible');
    fireEvent.click(screen.getByRole('button', { name: 'blueprint port' }));
    expect(screen.getByText('Выберите конечный свободный порт')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'generic port' }));
    expect(screen.getByRole('button', { name: 'Создать кабель' })).toBeDisabled();
    await selectCableType();
    expect(screen.queryByRole('option', { name: 'Archived fiber' })).toBeNull();
    await screen.findAllByRole('option', { name: 'RJ45 plug' });
    fireEvent.change(screen.getByLabelText('Разъём B'), { target: { value: 'connector' } });
    expect(screen.getByText('Source / A01 → Target / B01')).toBeInTheDocument();
    expect(screen.queryByText('Источник: Source / A01')).not.toBeInTheDocument();
    expect(screen.queryByText('Назначение: Target / B01')).not.toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith({ cable_type_id: 'copper', connector_b_type_id: 'connector', source: { kind: 'CONNECTION_POINT', connection_point_id: 'a-cp', member_index: 1 }, target: { kind: 'CONNECTION_POINT', connection_point_id: 'b-cp', member_index: 1 }, cable_label: null, cable_label_template_id: null, generate_cable_label: false }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Соединить порты' })).not.toBeInTheDocument());
    expect(write).toHaveBeenCalledTimes(1);
    expect(maps.loadMap).toHaveBeenCalledTimes(mapReads + 1);
    expect(loadProjection.mock.calls.length).toBeGreaterThan(projectionReads);
  });

  it('retries only projection refresh after a successful write', async () => {
    const write = vi.fn().mockResolvedValue(creation); let physicalReads = 0; const loadProjection = vi.fn((request: any) => request.layer === 'L1' && ++physicalReads === 2 ? Promise.reject(new Error('refresh')) : Promise.resolve(doc));
    renderPage(write, loadProjection); await screen.findByTestId('canvas'); startWiring(); fireEvent.click(screen.getByRole('button', { name: 'blueprint port' })); fireEvent.click(screen.getByRole('button', { name: 'generic port' })); await selectCableType(); fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    expect(await screen.findByText('Кабель создан, но карту не удалось обновить.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Соединить порты' })).not.toBeInTheDocument());
    expect(physicalReads).toBe(3);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('passes generated and manual Cable naming through the map create request and requires a template for generation', async () => {
    const { write } = renderPage(); await screen.findByTestId('canvas');
    startWiring(); fireEvent.click(screen.getByRole('button', { name: 'blueprint port' })); fireEvent.click(screen.getByRole('button', { name: 'generic port' })); await selectCableType();
    fireEvent.click(screen.getByRole('radio', { name: 'Сгенерировать по шаблону' })); await screen.findByRole('option', { name: 'FC' }); expect(screen.getByRole('button', { name: 'Создать кабель' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Шаблон'), { target: { value: 'template-1' } }); expect(screen.getByRole('button', { name: 'Создать кабель' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(expect.objectContaining({ cable_label: null, cable_label_template_id: 'template-1', generate_cable_label: true })));
  });
  it('passes a manual Cable label through the map create request without generation', async () => {
    const { write } = renderPage(); await screen.findByTestId('canvas');
    startWiring(); fireEvent.click(screen.getByRole('button', { name: 'blueprint port' })); fireEvent.click(screen.getByRole('button', { name: 'generic port' })); await selectCableType();
    fireEvent.change(screen.getByLabelText('Имя кабеля'), { target: { value: 'MANUAL-01' } }); fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(expect.objectContaining({ cable_label: 'MANUAL-01', cable_label_template_id: null, generate_cable_label: false })));
  });


  it('keeps only the selected endpoints in preview and cancels without a write', async () => {
    const { write } = renderPage();
    const canvas = await screen.findByTestId('canvas');
    startWiring();
    fireEvent.click(screen.getByText('blueprint port'));
    fireEvent.click(screen.getByText('pane 1'));
    fireEvent.click(screen.getByText('generic port')); await selectCableType();
    const preview = JSON.parse(canvas.querySelector('span')!.dataset.preview!);
    expect(Object.keys(preview)).toEqual(['source', 'target']);
    expect(preview.source.connectionPointId).toBe('a-cp');
    expect(preview.target.connectionPointId).toBe('b-cp');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(canvas.querySelector('span')).not.toHaveAttribute('data-preview');
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps the confirmation available after canonical creation fails', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('rejected')).mockResolvedValue(creation);
    renderPage(write);
    await screen.findByTestId('canvas');
    startWiring();
    fireEvent.click(screen.getByText('blueprint port'));
    fireEvent.click(screen.getByText('generic port')); await selectCableType();
    fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Source / A01 → Target / B01')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Соединить порты' })).not.toBeInTheDocument());
    expect(write).toHaveBeenCalledTimes(2);
  });
});
