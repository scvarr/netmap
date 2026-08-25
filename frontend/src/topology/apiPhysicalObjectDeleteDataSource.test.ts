import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiPhysicalObjectDeleteDataSource, PhysicalObjectDeletionError } from './apiPhysicalObjectDeleteDataSource';

afterEach(() => vi.unstubAllGlobals());

describe('ApiPhysicalObjectDeleteDataSource', () => {
  it('preserves structured canonical blocker evidence as a concise Russian error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'MODEL_ERROR', message: 'PhysicalObject is in use', details: { reason: 'PHYSICAL_OBJECT_IN_USE', blockers: { L2_BINDING: 1, EXTERNAL_PHYSICAL_CONNECTION: 2 } } } }), { status: 409 })));
    await expect(new ApiPhysicalObjectDeleteDataSource().deletePhysicalObject('object-1')).rejects.toEqual(expect.objectContaining({ name: 'PhysicalObjectDeletionError', blockers: { L2_BINDING: 1, EXTERNAL_PHYSICAL_CONNECTION: 2 }, message: 'Удаление невозможно: привязки L2 (1), внешние физические соединения (2).' }));
  });
});
