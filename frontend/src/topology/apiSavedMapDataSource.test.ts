import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiSavedMapDataSource, SavedMapApiError } from './apiSavedMapDataSource';

const mapId = '00000000-0000-4000-8000-000000000001';
const objectId = '00000000-0000-4000-8000-000000000002';
const annotationWrite = { text: 'Line one\nLine two', position: { x: 3, y: 4 }, text_color: '#123456', font_size: 18 };
const annotation = { annotation_ref: { entity_type: 'MapTextAnnotation' as const, entity_id: '00000000-0000-4000-8000-000000000004' }, ...annotationWrite };
const variantId = '00000000-0000-4000-8000-000000000005';
const body = { map_ref: { entity_type: 'SavedMap', entity_id: mapId }, name: 'First', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', active_variant_ref: { entity_type: 'MapPresentationVariant', entity_id: variantId }, variants: [{ variant_ref: { entity_type: 'MapPresentationVariant', entity_id: variantId }, name: 'Основной' }], location_states: [], placements: [{ physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: objectId }, positions: { 'L1/PHYSICAL_OBJECT': { x: 12, y: 34, locked: false } } }], text_annotations: [annotation] };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('ApiSavedMapDataSource', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); }); afterEach(() => vi.unstubAllGlobals());
  it('saves only boundary placement and returns authoritative variant state', async () => {
    fetchMock.mockResolvedValueOnce(response(body));
    await expect(new ApiSavedMapDataSource().setLocationBoundaryPlacement(mapId, variantId, objectId, { edge: 'left', offset: .25 })).resolves.toMatchObject({ location_states: [], placements: body.placements });
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/maps/${mapId}/presentation-variants/${variantId}/locations/${objectId}/boundary-placement`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ edge: 'left', offset: .25 });
  });
  it('returns the complete authoritative layout after an atomic frame edit', async () => {
    fetchMock.mockResolvedValueOnce(response(body));
    const geometry = { x: 0, y: 0, width: 500, height: 400, edge: 'right' as const, offset: .5 };
    await expect(new ApiSavedMapDataSource().setLocationGeometry(mapId, variantId, objectId, geometry)).resolves.toMatchObject({ location_states: [], placements: body.placements });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify(geometry));
  });

  it('parses list, create and detail responses strictly', async () => { fetchMock.mockResolvedValueOnce(response({ maps: [body] })).mockResolvedValueOnce(response(body)).mockResolvedValueOnce(response(body)); const source = new ApiSavedMapDataSource(); await expect(source.listMaps()).resolves.toHaveLength(1); await expect(source.createMap('First')).resolves.toMatchObject({ name: 'First' }); await expect(source.loadMap(mapId)).resolves.toMatchObject({ placements: [{ positions: { 'L1/PHYSICAL_OBJECT': { x: 12, y: 34, locked: false } } }] }); });
  it('preserves the complete variant catalog while parsing different active variants', async () => {
    const copyId = '00000000-0000-4000-8000-000000000006';
    const variants = [...body.variants, { variant_ref: { entity_type: 'MapPresentationVariant', entity_id: copyId }, name: 'A' }];
    fetchMock.mockResolvedValueOnce(response({ ...body, variants })).mockResolvedValueOnce(response({ ...body, variants, active_variant_ref: { entity_type: 'MapPresentationVariant', entity_id: copyId } }));
    const source = new ApiSavedMapDataSource();
    const primary = await source.loadMap(mapId, variantId);
    const copy = await source.loadMap(mapId, copyId);
    expect(primary.variants).toEqual(copy.variants);
    expect(primary.variants.map((variant) => variant.name)).toEqual(['Основной', 'A']);
    expect(primary.active_variant_ref.entity_id).toBe(variantId);
    expect(copy.active_variant_ref.entity_id).toBe(copyId);
  });
  it('deletes an exact canonical SavedMap UUID', async () => { fetchMock.mockImplementation(async () => response({})); await new ApiSavedMapDataSource().deleteMap(mapId); expect(fetchMock).toHaveBeenCalledWith(`/api/v1/maps/${mapId}`, { method: 'DELETE' }); await expect(new ApiSavedMapDataSource().deleteMap('not-a-uuid')).rejects.toThrow('mapId must be a UUID'); });
  it('deletes an exact presentation variant UUID on its SavedMap', async () => { fetchMock.mockImplementation(async () => response({})); const source = new ApiSavedMapDataSource(); await source.deletePresentationVariant(mapId, variantId); expect(fetchMock).toHaveBeenCalledWith(`/api/v1/maps/${mapId}/presentation-variants/${variantId}`, { method: 'DELETE' }); await expect(source.deletePresentationVariant('not-a-uuid', variantId)).rejects.toThrow('mapId must be a UUID'); await expect(source.deletePresentationVariant(mapId, 'not-a-uuid')).rejects.toThrow('variantId must be a UUID'); });
  it('reads and writes typed variant Location state', async () => { const state = { boundary_point_id: objectId, geometry: { x: 0, y: 0, width: 300, height: 200, edge: 'right', offset: .5 }, location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: objectId }, collapsed: true, visible_direct_elements: [{ entity_type: 'PhysicalObject', entity_id: mapId }] }; fetchMock.mockResolvedValueOnce(response({ ...body, location_states: [state] })).mockResolvedValueOnce(response({})); const source = new ApiSavedMapDataSource(); await expect(source.loadMap(mapId, variantId)).resolves.toMatchObject({ location_states: [state] }); await source.setLocationState(mapId, variantId, objectId, { collapsed: true, visible_direct_elements: state.visible_direct_elements as [{ entity_type: 'PhysicalObject'; entity_id: string }] }); expect(fetchMock.mock.calls[1][0]).toBe(`/api/v1/maps/${mapId}/presentation-variants/${variantId}/locations/${objectId}`); expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ collapsed: true, visible_direct_elements: state.visible_direct_elements })); });
  it('posts one Location group displacement and preserves backend validation details', async () => {
    const move = { delta_x: 40, delta_y: 20, footprints: [{ physical_object_id: objectId, x: 0, y: 0, width: 100, height: 60 }] };
    const source = new ApiSavedMapDataSource();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(response({ error: { code: 'VALIDATION_ERROR', message: 'Location group contains a locked position' } }, 422));
    await source.moveLocationGroup(mapId, variantId, objectId, move);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/maps/${mapId}/presentation-variants/${variantId}/locations/${objectId}/group-move`, expect.objectContaining({ method: 'POST', body: JSON.stringify(move) }));
    await expect(source.moveLocationGroup(mapId, variantId, objectId, move)).rejects.toThrow('VALIDATION_ERROR: Location group contains a locked position');
  });
  it('keeps structured FastAPI validation paths on a group-move failure', async () => {
    const details = { errors: [{ loc: ['body', 'footprints', 0, 'side'], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' }] };
    fetchMock.mockImplementation(async () => response({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details } }, 422));
    const move = { delta_x: 1, delta_y: 1, footprints: [] };
    try { await new ApiSavedMapDataSource().moveLocationGroup(mapId, variantId, objectId, move); throw new Error('Expected validation failure'); }
    catch (reason) { expect(reason).toBeInstanceOf(SavedMapApiError); expect(reason).toMatchObject({ code: 'VALIDATION_ERROR', serverMessage: 'Request validation failed', details }); }
  });
  it('loads typed canonical direct elements for the collapse editor', async () => { const choices = [{ ref: { entity_type: 'Location', entity_id: objectId }, label: 'Rack' }, { ref: { entity_type: 'PhysicalObject', entity_id: mapId }, label: 'UPS' }]; fetchMock.mockImplementation(async () => response(choices)); await expect(new ApiSavedMapDataSource().loadLocationDirectElements(mapId, variantId, objectId)).resolves.toEqual(choices); expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/maps/${mapId}/presentation-variants/${variantId}/locations/${objectId}/direct-elements`); });
  it.each([{ name: 'Copy' }, { variant_ref: { entity_type: 'MapPresentationVariant', entity_id: variantId }, name: '' }])('rejects malformed variant creation response', async (invalid) => { fetchMock.mockImplementation(async () => response(invalid)); await expect(new ApiSavedMapDataSource().createPresentationVariant(mapId, 'Copy', variantId)).rejects.toThrow('Malformed SavedMap'); });
  it('uses public placement, per-view position and lock paths and bodies', async () => { fetchMock.mockImplementation(async () => response(body)); const source = new ApiSavedMapDataSource(); await source.addPlacement(mapId, objectId, 1, 2, 96); await source.movePosition(mapId, objectId, 'physical', 3, 4); await source.movePosition(mapId, objectId, 'logical', 5, 6); await source.setPositionLock(mapId, objectId, 'physical', true); await source.removePlacement(mapId, objectId); expect(fetchMock.mock.calls.map(([url, init]) => [url, init ? [(init as RequestInit).method, (init as RequestInit).body] : ['DELETE', undefined]])).toEqual([[`/api/v1/maps/${mapId}/placements`, ['POST', JSON.stringify({ physical_object_id: objectId, x: 1, y: 2, display_width: 96 })]], [`/api/v1/maps/${mapId}/placements/${objectId}/positions/physical`, ['PUT', JSON.stringify({ x: 3, y: 4 })]], [`/api/v1/maps/${mapId}/placements/${objectId}/positions/logical`, ['PUT', JSON.stringify({ x: 5, y: 6 })]], [`/api/v1/maps/${mapId}/placements/${objectId}/locks/physical`, ['PUT', JSON.stringify({ locked: true })]], [`/api/v1/maps/${mapId}/placements/${objectId}`, ['DELETE', undefined]]]); });
  it('round-trips optional physical display width and rejects malformed widths', async () => { fetchMock.mockImplementation(async () => response({ ...body, placements: [{ ...body.placements[0], positions: { 'L1/PHYSICAL_OBJECT': { x: 12, y: 34, locked: false, display_width: 320 } } }] })); const source = new ApiSavedMapDataSource(); await expect(source.loadMap(mapId)).resolves.toMatchObject({ placements: [{ positions: { 'L1/PHYSICAL_OBJECT': { display_width: 320 } } }] }); await source.movePosition(mapId, objectId, 'physical', 3, 4, 320); expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ x: 3, y: 4, display_width: 320 })); fetchMock.mockImplementation(async () => response({ ...body, placements: [{ ...body.placements[0], positions: { 'L1/PHYSICAL_OBJECT': { x: 12, y: 34, locked: false, display_width: 0 } } }] })); await expect(source.loadMap(mapId)).rejects.toThrow('display_width'); });
    it('parses and transports text annotation presentation only through SavedMap reads', async () => { fetchMock.mockImplementation(async () => response({})); const source = new ApiSavedMapDataSource(); const replacement = { ...annotationWrite, text: 'Other', position: { x: 8, y: 9 } }; await source.createTextAnnotation(mapId, annotationWrite); await source.replaceTextAnnotation(mapId, annotation.annotation_ref.entity_id, replacement); await source.deleteTextAnnotation(mapId, annotation.annotation_ref.entity_id); expect(fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit).method, (init as RequestInit).body])).toEqual([[`/api/v1/maps/${mapId}/text-annotations`, 'POST', JSON.stringify(annotationWrite)], [`/api/v1/maps/${mapId}/text-annotations/${annotation.annotation_ref.entity_id}`, 'PUT', JSON.stringify(replacement)], [`/api/v1/maps/${mapId}/text-annotations/${annotation.annotation_ref.entity_id}`, 'DELETE', undefined]]); });
  it.each([{ ...body, map_ref: { entity_type: 'SavedMap', entity_id: 'bad' } }, { ...body, placements: [{ ...body.placements[0], physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Connection', entity_id: objectId } }] }, { ...body, placements: [{ ...body.placements[0], positions: { 'L1/PHYSICAL_OBJECT': { x: Infinity, y: 1 } } }] }, { ...body, placements: [{ ...body.placements[0], positions: { unknown: { x: 1, y: 2 } } }] }, { ...body, placements: {} }])('rejects malformed response', async (invalid) => { fetchMock.mockImplementation(async () => response(invalid)); await expect(new ApiSavedMapDataSource().loadMap(mapId)).rejects.toThrow('Malformed SavedMap'); });
  it('exposes API errors', async () => { fetchMock.mockImplementation(async () => response({ error: { code: 'MODEL_ERROR', message: 'Conflict' } }, 409)); await expect(new ApiSavedMapDataSource().listMaps()).rejects.toThrow('MODEL_ERROR: Conflict'); });
});
