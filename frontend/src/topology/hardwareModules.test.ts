import { afterEach, describe, expect, it, vi } from 'vitest';
import { hardwareModuleDataSource, moduleReviewDataSource } from './hardwareModules';

afterEach(() => vi.unstubAllGlobals());

describe('module template deletion API', () => {
  it('persists exact module input and sends generation for save and check', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ generation: 4 }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const definition = { name: ' Name ', compatibility: ' OCP3 ', endpoints: [{ key: 'stable-key', display_name: ' P1 ', kind: 'NETWORK_PORT' as const }] };
    await moduleReviewDataSource.loadDraft('module/id');
    await moduleReviewDataSource.saveDraft('module/id', definition, 3);
    await moduleReviewDataSource.checkDraft('module/id', 4);
    expect(fetch.mock.calls).toEqual([
      ['/api/v1/library/module-templates/module%2Fid/draft', { method: 'GET' }],
      ['/api/v1/library/module-templates/module%2Fid/draft?expected_generation=3', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(definition) }],
      ['/api/v1/library/module-templates/module%2Fid/draft/check?expected_generation=4', { method: 'POST' }],
    ]);
  });
  it('deletes a stable installation ID under its owning object and returns configuration', async () => {
    const configuration = { configuration_id: 'config', bays: [] };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(configuration), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(hardwareModuleDataSource.uninstallModule('object/id', 'installation/id')).resolves.toEqual(configuration);
    expect(fetch).toHaveBeenCalledWith('/api/v1/topology/physical-objects/object%2Fid/module-installations/installation%2Fid', { method: 'DELETE' });
  });
  it('deletes the encoded root ID and accepts an empty 204 response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(hardwareModuleDataSource.deleteModule('module/id')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/v1/library/module-templates/module%2Fid', { method: 'DELETE' });
  });
  it('propagates the existing domain error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'ModuleTemplate revision is installed' } }), { status: 409 })));
    await expect(hardwareModuleDataSource.deleteModule('module')).rejects.toThrow('ModuleTemplate revision is installed');
  });
});
