import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiBaseTemplateDataSource } from './apiBaseTemplateDataSource';

afterEach(() => vi.unstubAllGlobals());

describe('object reconciliation API', () => {
  it('posts to the published-template operation and retains per-object outcomes and diagnostics', async () => {
    const result = { revision_id: 'latest', version_number: 3, objects: [
      { physical_object_id: 'a', status: 'updated', reasons: [] },
      { physical_object_id: 'b', status: 'requires_intervention', reasons: [{ code: 'CONCURRENT_CHANGE' }] },
    ] };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await new ApiBaseTemplateDataSource('/api/v1/library/base-templates').reconcileObjects('base/id')).toEqual(result);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/library/base-templates/base%2Fid/reconcile', { method: 'POST' });
  });

  it('surfaces request errors without automatically retrying a write', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'MODEL_ERROR', message: 'Retry update' } }), { status: 409 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(new ApiBaseTemplateDataSource().reconcileObjects('base')).rejects.toThrow('Retry update');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
