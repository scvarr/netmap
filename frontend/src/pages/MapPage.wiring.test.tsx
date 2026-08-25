import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MapPage } from './MapPage';

vi.mock('../components/TopologyCanvas', () => ({ TopologyCanvas: (p: any) => <div data-testid="canvas"><button onClick={() => p.onPhysicalPortClick?.({ physicalObjectId: 'a', connectionPointId: 'a-cp', label: 'A01' })}>blueprint port</button><button onClick={() => p.onPhysicalPortClick?.({ physicalObjectId: 'b', connectionPointId: 'b-cp', label: 'B01' })}>generic port</button><span data-states={JSON.stringify(p.physicalPortStates)} /></div> }));
const map = { map_ref: { entity_type: 'SavedMap', entity_id: 'map-1' }, name: 'M1', placements: [{ physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'a' }, positions: { 'L1/PHYSICAL_OBJECT': { x: 0, y: 0 } } }, { physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'b' }, positions: { 'L1/PHYSICAL_OBJECT': { x: 1, y: 1 } } }] } as any;
const node = (id: string, label: string, cp: string, count = 0) => ({ id, kind: 'PHYSICAL_OBJECT', label, source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id }], attributes: { class: 'switch', connection_points: [{ connection_point_id: cp, display_name: cp === 'a-cp' ? 'A01' : 'B01', cardinality: 1, external_connection_count: count }] } });
const doc = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [node('a', 'Source', 'a-cp'), node('b', 'Target', 'b-cp')], edges: [], gaps: [], warnings: [] } as any;
const creation = { cable_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'cable-1' }, source: {}, target: {}, connection_refs: [] } as any;
const renderPage = (write = vi.fn().mockResolvedValue(creation), loadProjection = vi.fn().mockResolvedValue(doc), setCableRoute = vi.fn().mockResolvedValue(map)) => { const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createMap: vi.fn(), setCableRoute }; render(<MemoryRouter initialEntries={['/map?map=map-1&view=physical']}><MapPage dataSource={{ loadProjection }} savedMapDataSource={maps} physicalEndpointConnectionWriteDataSource={{ createPhysicalEndpointConnection: write }} /></MemoryRouter>); return { write, loadProjection, maps, setCableRoute }; };

describe('MapPage visual wiring', () => {
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
    fireEvent.change(screen.getByLabelText('Название кабеля'), { target: { value: ' C1 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith({ source: { kind: 'CONNECTION_POINT', connection_point_id: 'a-cp', member_index: 1 }, target: { kind: 'CONNECTION_POINT', connection_point_id: 'b-cp', member_index: 1 }, cable_display_name: 'C1' }));
    expect(write).toHaveBeenCalledTimes(1); expect(loadProjection.mock.calls.length).toBeGreaterThan(1);
  });

  it('retries only projection refresh after a successful write', async () => {
    const write = vi.fn().mockResolvedValue(creation); let physicalReads = 0; const loadProjection = vi.fn((request: any) => request.layer === 'L1' && ++physicalReads === 2 ? Promise.reject(new Error('refresh')) : Promise.resolve(doc));
    renderPage(write, loadProjection); await screen.findByTestId('canvas'); fireEvent.click(screen.getByRole('button', { name: 'Соединить порты' })); fireEvent.click(screen.getByRole('button', { name: 'blueprint port' })); fireEvent.click(screen.getByRole('button', { name: 'generic port' })); fireEvent.click(screen.getByRole('button', { name: 'Создать кабель' }));
    expect(await screen.findByText('Кабель и трасса сохранены, но карту не удалось обновить.')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' })); await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  });
});
