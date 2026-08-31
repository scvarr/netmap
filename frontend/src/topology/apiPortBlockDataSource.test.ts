import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiPortBlockDataSource, PortBlockDeletionConflictError } from './apiPortBlockDataSource';

afterEach(() => vi.unstubAllGlobals());

describe('ApiPortBlockDataSource deletion', () => {
  it('reads current-version kind counts, including zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ schema_version: '1.0', port_blocks: [{ port_block_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlock', entity_id: 'block-1' }, name: 'Panel', version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlockVersion', entity_id: 'version-1' }, version_number: 2, port_count: 3, connection_point_count: 0, network_port_count: 3, version_count: 2 }] }))));
    await expect(new ApiPortBlockDataSource().loadPortBlocks()).resolves.toMatchObject({ port_blocks: [expect.objectContaining({ connection_point_count: 0, network_port_count: 3 })] });
  });

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
