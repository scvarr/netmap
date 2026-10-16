import { afterEach, describe, expect, it, vi } from 'vitest';
import { hardwareModuleDataSource } from './hardwareModules';

afterEach(() => vi.unstubAllGlobals());

describe('module template deletion API', () => {
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
