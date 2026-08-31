import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MapPage } from './MapPage';
import { createMapPageHarness } from './MapPage.testHarness';

vi.mock('../components/TopologyCanvas', () => ({ TopologyCanvas: (props: any) => <>
  <button onClick={() => props.regionMode?.onMoveDraftVertex?.(0, { x: 7, y: 8 })}>move vertex</button>
  <button onClick={() => props.regionMode?.onInsertDraftVertex?.(0, { x: 5, y: 0 })}>insert vertex</button>
  <button onClick={() => props.regionMode?.onTranslateDraft?.({ x: 10, y: 20 })}>translate region</button>
  <button onClick={() => props.regionMode?.onMoveLabel?.({ x: 70, y: -30 })}>move label</button>
</> }));
const renderMapPage = createMapPageHarness(MapPage);

const mapId = 'map-a';
const region = {
  region_ref: { entity_type: 'MapRegion' as const, entity_id: 'region-a' }, label: 'Стойка 01',
  points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }], label_position: { x: 3, y: 4 },
  style: { fill_color: '#123456', fill_opacity: .3, stroke_color: '#abcdef', stroke_width: 2, stroke_style: 'dashed' as const }, z_order: 4,
};
const map = { map_ref: { entity_type: 'SavedMap' as const, entity_id: mapId }, name: 'A', created_at: '', updated_at: '', placements: [], cable_routes: [], regions: [region] };
const document: any = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [], edges: [], gaps: [], warnings: [] };

const renderPage = (maps: any) => renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`);

describe('MapPage existing Region geometry editing', () => {
  it('clones selected authoritative geometry, preserves non-geometry metadata, and translates an explicit label position only with the polygon', async () => {
    const after = { ...map, regions: [region] };
    const replaceRegion = vi.fn().mockResolvedValue(undefined);
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValueOnce(map).mockResolvedValueOnce(after), replaceRegion, createMap: vi.fn() };
    renderPage(maps);
    await screen.findByRole('button', { name: 'Области' });
    fireEvent.click(screen.getByRole('button', { name: 'Области' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Стойка 01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать геометрию' }));
    fireEvent.click(screen.getByText('translate region'));
    expect(region.points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(replaceRegion).toHaveBeenCalledTimes(1));
    const [, , write] = replaceRegion.mock.calls[0];
    expect(write).toMatchObject({ label: 'Стойка 01', style: region.style, z_order: 4 });
    const delta = { x: write.label_position.x - region.label_position.x, y: write.label_position.y - region.label_position.y };
    expect(write.points).toEqual(region.points.map((point: any) => ({ x: point.x + delta.x, y: point.y + delta.y })));
    expect(replaceRegion).toHaveBeenCalledTimes(1);
  });

  it('keeps local geometry editable on a spatial-conflict failure and cancel performs no write', async () => {
    const replaceRegion = vi.fn().mockRejectedValue(new Error('MAP_REGION_SPATIAL_CONFLICT: conflict'));
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), replaceRegion, createMap: vi.fn() };
    renderPage(maps);
    fireEvent.click(await screen.findByRole('button', { name: 'Области' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Стойка 01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать геометрию' }));
    fireEvent.click(screen.getByText('move vertex'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Область пересекается или касается другой области.');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(replaceRegion).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Стойка 01' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('retries only refresh after acknowledgement and leaves the target selected', async () => {
    const replaceRegion = vi.fn().mockResolvedValue(undefined);
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), replaceRegion, createMap: vi.fn() };
    renderPage(maps);
    fireEvent.click(await screen.findByRole('button', { name: 'Области' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Стойка 01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать геометрию' }));
    maps.loadMap.mockRejectedValueOnce(new Error('refresh'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByRole('button', { name: 'Повторить обновление' });
    fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(replaceRegion).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Стойка 01' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('MapPage Region properties and deletion', () => {
  const openProperties = async (maps: any) => {
    renderPage(maps);
    fireEvent.click(await screen.findByRole('button', { name: 'Области' }));
    fireEvent.click(screen.getByRole('button', { name: 'Стойка 01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Свойства' }));
  };

  it('keeps properties local until save, previews label/style, preserves points and z-order, and trims a rename', async () => {
    const replaceRegion = vi.fn().mockResolvedValue(undefined);
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), replaceRegion, createMap: vi.fn() };
    await openProperties(maps);
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: '  Повторяющееся имя  ' } });
    fireEvent.change(screen.getByLabelText('Цвет контура'), { target: { value: '#123123' } });
    fireEvent.change(screen.getByLabelText('Стиль контура'), { target: { value: 'dotted' } });
    fireEvent.click(screen.getByText('move label'));
    expect(replaceRegion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(replaceRegion).toHaveBeenCalledTimes(1));
    expect(replaceRegion).toHaveBeenCalledWith(mapId, 'region-a', expect.objectContaining({ label: 'Повторяющееся имя', points: region.points, z_order: 4, label_position: { x: 70, y: -30 }, style: expect.objectContaining({ stroke_color: '#123123', stroke_style: 'dotted' }) }));
  });

  it('resets a dragged label to automatic and cancel makes no write', async () => {
    const replaceRegion = vi.fn();
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), replaceRegion, createMap: vi.fn() };
    await openProperties(maps);
    fireEvent.click(screen.getByText('move label'));
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть автоматическую позицию названия' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(replaceRegion).toHaveBeenCalledWith(mapId, 'region-a', expect.objectContaining({ label_position: null })));
    fireEvent.click(screen.getByRole('button', { name: 'Свойства' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(replaceRegion).toHaveBeenCalledTimes(1);
  });

  it('retries only refresh after an acknowledged properties PUT', async () => {
    const replaceRegion = vi.fn().mockResolvedValue(undefined);
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), replaceRegion, createMap: vi.fn() };
    await openProperties(maps);
    maps.loadMap.mockRejectedValueOnce(new Error('refresh'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByRole('button', { name: 'Повторить обновление' });
    fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(replaceRegion).toHaveBeenCalledTimes(1));
  });

  it('confirms exactly one DELETE, preserves nested Regions in the reload, and retries only refresh', async () => {
    const nested = { ...region, region_ref: { entity_type: 'MapRegion' as const, entity_id: 'nested' }, label: 'Вложенная' };
    const after = { ...map, regions: [nested] };
    const deleteRegion = vi.fn().mockResolvedValue(undefined);
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), deleteRegion, createMap: vi.fn() };
    renderPage(maps);
    fireEvent.click(await screen.findByRole('button', { name: 'Области' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Стойка 01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить область' }));
    expect(deleteRegion).not.toHaveBeenCalled();
    maps.loadMap.mockRejectedValueOnce(new Error('refresh')).mockResolvedValueOnce(after);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await screen.findByRole('button', { name: 'Повторить обновление' });
    expect(deleteRegion).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(deleteRegion).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Вложенная' })).toBeInTheDocument();
  });

  it('keeps deletion confirmation retryable after DELETE failure', async () => {
    const deleteRegion = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(undefined);
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), deleteRegion, createMap: vi.fn() };
    renderPage(maps);
    fireEvent.click(await screen.findByRole('button', { name: 'Области' })); fireEvent.click(await screen.findByRole('button', { name: 'Стойка 01' })); fireEvent.click(screen.getByRole('button', { name: 'Удалить область' })); fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось удалить область.');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(deleteRegion).toHaveBeenCalledTimes(2));
  });
});
