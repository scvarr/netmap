import { afterEach, expect, it, vi } from 'vitest';
import { ApiLocationDataSource } from './apiLocationDataSource';

afterEach(() => vi.unstubAllGlobals());

it('uses preview and one atomic series endpoint', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ names: ['U01', 'U02'], conflicts: [] }) })
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ locations: [
      { location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: 'one' }, name: 'U01', parent_location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: 'rack' } },
      { location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: 'two' }, name: 'U02', parent_location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: 'rack' } },
    ] }) });
  vi.stubGlobal('fetch', fetchMock);
  const source = new ApiLocationDataSource();
  const request = { parent_location_id: 'rack', pattern: 'U##', from: 1, to: 2, step: 1, type: null };
  expect(await source.previewLocationSeries(request)).toEqual({ names: ['U01', 'U02'], conflicts: [] });
  expect((await source.createLocationSeries(request)).map((item) => item.name)).toEqual(['U01', 'U02']);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/locations/series/preview', '/api/v1/locations/series']);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(request);
});
