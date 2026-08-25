import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiPhysicalObjectDeleteDataSource, PhysicalObjectDeletionError } from './apiPhysicalObjectDeleteDataSource';

afterEach(() => vi.unstubAllGlobals());

describe('ApiPhysicalObjectDeleteDataSource', () => {
  it('preserves structured canonical blocker evidence as a concise Russian error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'MODEL_ERROR', message: 'PhysicalObject is in use', details: { reason: 'PHYSICAL_OBJECT_IN_USE', blockers: { EXTERNAL_PHYSICAL_CONNECTION: 2, L3_BINDING: 1 } } } }), { status: 409 })));
    await expect(new ApiPhysicalObjectDeleteDataSource().deletePhysicalObject('object-1')).rejects.toEqual(expect.objectContaining({ name: 'PhysicalObjectDeletionError', blockers: { EXTERNAL_PHYSICAL_CONNECTION: 2, L3_BINDING: 1 }, message: 'Удаление невозможно: внешние физические соединения (2), привязки L3 (1).' }));
  });
});
