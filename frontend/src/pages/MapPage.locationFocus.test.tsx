import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MapPage } from './MapPage';
import { createMapPageHarness } from './MapPage.testHarness';

vi.mock('../components/TopologyCanvas', () => ({ TopologyCanvas: (props: any) => <output data-testid="location-focus">{[...(props.locationFocusObjectIds ?? [])].sort().join(',')}</output> }));
const renderMapPage = createMapPageHarness(MapPage);

const mapId = 'map-a';
const ref = (entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id });
const region = { region_ref: { entity_type: 'MapRegion' as const, entity_id: 'region-a' }, location_ref: ref('root'), label: 'Site', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], style: { fill_color: '#123456', fill_opacity: .2, stroke_color: '#abcdef', stroke_width: 1, stroke_style: 'solid' as const }, z_order: 0 };
const map = { map_ref: { entity_type: 'SavedMap' as const, entity_id: mapId }, name: 'A', created_at: '', updated_at: '', cable_routes: [], text_annotations: [], regions: [region], placements: [
  { physical_object_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject' as const, entity_id: 'root-object' }, location_ref: ref('root'), positions: {} },
  { physical_object_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject' as const, entity_id: 'child-object' }, location_ref: ref('child'), positions: {} },
  { physical_object_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject' as const, entity_id: 'other-object' }, location_ref: ref('other'), positions: {} },
] };
const document: any = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [], edges: [], gaps: [], warnings: [] };

describe('MapPage Location.3 focus', () => {
  it('focuses exact and descendant canonical Locations from one catalog read without presentation writes', async () => {
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createMap: vi.fn(), replaceRegion: vi.fn() };
    const locations = { loadLocations: vi.fn().mockResolvedValue([
      { location_ref: ref('root'), name: 'Site', type: 'any type', parent_location_ref: null },
      { location_ref: ref('child'), name: 'Room', type: 'another type', parent_location_ref: ref('root') },
      { location_ref: ref('other'), name: 'Elsewhere', type: 'Room', parent_location_ref: null },
    ]) };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps, locationDataSource: locations }, `/map?map=${mapId}&view=physical`);
    fireEvent.click(await screen.findByRole('button', { name: 'Области' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Site' }));
    await waitFor(() => expect(screen.getByTestId('location-focus')).toHaveTextContent('child-object,root-object'));
    expect(locations.loadLocations).toHaveBeenCalledTimes(1);
    expect(maps.replaceRegion).not.toHaveBeenCalled();
  });

  it('shows explicit hierarchy paths and sends select/change/clear only in acknowledged Region replaces', async () => {
    const maps: any = { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), createMap: vi.fn(), replaceRegion: vi.fn().mockResolvedValue(undefined) };
    const locations = { loadLocations: vi.fn().mockResolvedValue([
      { location_ref: ref('root'), name: 'Site', type: 'uninterpreted', parent_location_ref: null },
      { location_ref: ref('child'), name: 'Room', type: 'also uninterpreted', parent_location_ref: ref('root') },
      { location_ref: ref('other'), name: 'Elsewhere', type: 'Room', parent_location_ref: null },
    ]) };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps, locationDataSource: locations }, `/map?map=${mapId}&view=physical`);
    fireEvent.click(await screen.findByRole('button', { name: 'Области' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Site' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Свойства' }).at(-1)!);
    const picker = await screen.findByLabelText('Местоположение');
    expect(picker).toHaveTextContent('Site / Room');
    fireEvent.change(picker, { target: { value: 'child' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить' }).at(-1)!);
    await waitFor(() => expect(maps.replaceRegion).toHaveBeenLastCalledWith(mapId, 'region-a', expect.objectContaining({ location_id: 'child' })));
    fireEvent.click(screen.getAllByRole('button', { name: 'Свойства' }).at(-1)!);
    fireEvent.change(await screen.findByLabelText('Местоположение'), { target: { value: '' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить' }).at(-1)!);
    await waitFor(() => expect(maps.replaceRegion).toHaveBeenLastCalledWith(mapId, 'region-a', expect.objectContaining({ location_id: null })));
  });
});
