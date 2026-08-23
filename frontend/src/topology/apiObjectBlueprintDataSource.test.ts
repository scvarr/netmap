import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiObjectBlueprintDataSource } from './apiObjectBlueprintDataSource';

const ref = (entity_type: 'ObjectBlueprint' | 'ObjectBlueprintVersion', entity_id: string) => ({ ref_type: 'LIBRARY_RECORD', entity_type, entity_id });
const list = { schema_version: '1.0', blueprints: [{ blueprint_ref: ref('ObjectBlueprint', 'bp'), name: 'Cable', version_ref: ref('ObjectBlueprintVersion', 'v1'), version_number: 1, body: { kind: 'RECTANGLE', width: 120, height: 6, fill_color: '#123456' }, slot_count: 2, internal_link_count: 1, version_count: 1 }] };
afterEach(() => vi.unstubAllGlobals());
describe('ApiObjectBlueprintDataSource', () => {
  it('reads the public library list and rejects malformed library refs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(list), { status: 200 })));
    await expect(new ApiObjectBlueprintDataSource().loadObjectBlueprints()).resolves.toEqual(list);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...list, blueprints: [{ ...list.blueprints[0], blueprint_ref: { ...list.blueprints[0].blueprint_ref, ref_type: 'CANONICAL_FACT' } }] }), { status: 200 })));
    await expect(new ApiObjectBlueprintDataSource().loadObjectBlueprints()).rejects.toThrow('Malformed object blueprint response');
  });
  it('posts only explicit canonical authoring fields and surfaces backend errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ schema_version: '1.0', blueprint_ref: ref('ObjectBlueprint', 'bp'), version_ref: ref('ObjectBlueprintVersion', 'v1') }), { status: 201 })); vi.stubGlobal('fetch', fetchMock);
    const request = { name: 'Cable', body: { kind: 'RECTANGLE' as const, width: 120, height: 6 }, slots: [], internal_links: [] };
    await new ApiObjectBlueprintDataSource().createObjectBlueprint(request);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/library/object-blueprints', expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Bad blueprint' } }), { status: 422 })));
    await expect(new ApiObjectBlueprintDataSource().createObjectBlueprint(request)).rejects.toThrow('VALIDATION_ERROR: Bad blueprint');
  });
});
