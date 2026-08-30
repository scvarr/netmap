import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MapPage } from './MapPage';

vi.mock('../components/TopologyCanvas', () => ({ TopologyCanvas: (props: any) => <>
  <button onClick={() => props.regionMode?.onAnnotationPlace?.({ x: 12, y: 34 })}>place text</button>
  <button onClick={() => props.regionMode?.onMoveAnnotation?.('annotation-a', { x: 70, y: -30 })}>drag text</button>
  <button onClick={() => props.regionMode?.onAnnotationSelect?.('annotation-a')}>select annotation</button>
  <output data-testid="annotation-preview">{JSON.stringify(props.regionMode?.previewAnnotation ?? null)}</output>
</> }));

const mapId = 'map-a';
const annotation = { annotation_ref: { entity_type: 'MapTextAnnotation' as const, entity_id: 'annotation-a' }, text: 'Existing\ntext', position: { x: 3, y: 4 }, text_color: '#123456', font_size: 16 };
const region = { region_ref: { entity_type: 'MapRegion' as const, entity_id: 'region-a' }, label: 'Region', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }], style: { fill_color: '#123456', fill_opacity: .3, stroke_color: '#abcdef', stroke_width: 2, stroke_style: 'solid' as const }, z_order: 1 };
const map = { map_ref: { entity_type: 'SavedMap' as const, entity_id: mapId }, name: 'A', created_at: '', updated_at: '', placements: [], cable_routes: [], regions: [region], text_annotations: [annotation] };
const document: any = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [], edges: [], gaps: [], warnings: [] };
const renderPage = (maps: any) => render(<MemoryRouter initialEntries={[`/map?map=${mapId}&view=physical`]}><MapPage dataSource={{ loadProjection: vi.fn().mockResolvedValue(document) }} savedMapDataSource={maps} /></MemoryRouter>);

const enterRegionMode = async () => { fireEvent.click(await screen.findByRole('button', { name: 'Области' })); };
const selectText = () => fireEvent.click(screen.getByRole('tab', { name: 'Текст' }));

describe('MapPage text annotations', () => {
  it('keeps a new annotation local through placement and editing, then creates exactly once and reloads authoritatively', async () => {
    const createTextAnnotation = vi.fn().mockResolvedValue(undefined);
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createTextAnnotation, createMap: vi.fn() };
    renderPage(maps); await enterRegionMode();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить текст' }));
    fireEvent.click(screen.getByText('place text'));
    expect(createTextAnnotation).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Local\npreview  ' } });
    fireEvent.change(screen.getAllByLabelText('Размер шрифта').at(-1)!, { target: { value: '22' } });
    expect(screen.getByTestId('annotation-preview')).toHaveTextContent('Local\\npreview');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(createTextAnnotation).toHaveBeenCalledTimes(1));
    expect(createTextAnnotation).toHaveBeenCalledWith(mapId, { text: 'Local\npreview', position: { x: 12, y: 34 }, text_color: '#1f2937', font_size: 22 });
  });

  it('cancels an unacknowledged annotation without a write and validates blank text', async () => {
    const createTextAnnotation = vi.fn(); const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createTextAnnotation, createMap: vi.fn() };
    renderPage(maps); await enterRegionMode(); fireEvent.click(screen.getByRole('button', { name: 'Добавить текст' })); fireEvent.click(screen.getByText('place text'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); expect(await screen.findByRole('alert')).toHaveTextContent('Введите текст.');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' })); expect(createTextAnnotation).not.toHaveBeenCalled();
  });

  it('free-drags an existing annotation, replaces it once, and retries only reload after acknowledgement', async () => {
    const replaceTextAnnotation = vi.fn().mockResolvedValue(undefined);
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), replaceTextAnnotation, createMap: vi.fn() };
    renderPage(maps); await enterRegionMode(); selectText(); fireEvent.click(screen.getByRole('button', { name: 'Existing' })); fireEvent.click(screen.getByRole('button', { name: 'Изменить текст' })); fireEvent.click(screen.getByText('drag text'));
    expect(screen.getByTestId('annotation-preview')).toHaveTextContent('70');
    maps.loadMap.mockRejectedValueOnce(new Error('refresh'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); await screen.findByRole('button', { name: 'Повторить обновление' }); fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(replaceTextAnnotation).toHaveBeenCalledTimes(1));
    expect(replaceTextAnnotation).toHaveBeenCalledWith(mapId, 'annotation-a', expect.objectContaining({ position: { x: 70, y: -30 } }));
  });

  it('confirms deletion and retries only refresh after one acknowledged DELETE', async () => {
    const deleteTextAnnotation = vi.fn().mockResolvedValue(undefined); const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), deleteTextAnnotation, createMap: vi.fn() };
    renderPage(maps); await enterRegionMode(); selectText(); fireEvent.click(screen.getByRole('button', { name: 'Existing' })); fireEvent.click(screen.getByRole('button', { name: 'Удалить текст' })); expect(deleteTextAnnotation).not.toHaveBeenCalled(); maps.loadMap.mockRejectedValueOnce(new Error('refresh'));
    fireEvent.click(screen.getByRole('alertdialog').querySelector('button')!); await screen.findByRole('button', { name: 'Повторить обновление' }); fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(deleteTextAnnotation).toHaveBeenCalledTimes(1));
  });

  it('excludes Region and text annotation operations in both directions', async () => {
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createMap: vi.fn() };
    renderPage(maps); await enterRegionMode();
    fireEvent.click(screen.getByRole('button', { name: 'Region' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить текст' })); fireEvent.click(screen.getByText('place text'));
    expect(screen.getByRole('button', { name: 'Region' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Редактировать геометрию' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    fireEvent.click(screen.getByRole('button', { name: 'Новая область' })); selectText();
    expect(screen.getByRole('button', { name: 'Existing' })).toBeDisabled();
    fireEvent.click(screen.getByText('select annotation'));
    expect(screen.getByRole('button', { name: 'Existing' })).toHaveAttribute('aria-pressed', 'false');
  });
});
