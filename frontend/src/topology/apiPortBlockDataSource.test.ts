import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiPortBlockDataSource, PortBlockDeletionConflictError } from './apiPortBlockDataSource';

afterEach(() => vi.unstubAllGlobals());

describe('ApiPortBlockDataSource deletion', () => {
  it('deletes the exact PortBlock ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new ApiPortBlockDataSource().deletePortBlock('block/id')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/library/port-blocks/block%2Fid', { method: 'DELETE' });
  });

  it('preserves the in-use conflict for the library UI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'MODEL_ERROR', message: 'PortBlock is in use', details: { reason: 'PORT_BLOCK_IN_USE_BY_OBJECT_BLUEPRINT' } } }), { status: 409 })));
    await expect(new ApiPortBlockDataSource().deletePortBlock('block-1')).rejects.toBeInstanceOf(PortBlockDeletionConflictError);
  });
});
