import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiBaseTemplateDataSource } from './apiBaseTemplateDataSource';
import { moduleReviewDataSource } from './hardwareModules';

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

describe.each([
  { kind: 'base', parameter: 'object_ids', reconcile: (ids?: string[]) => new ApiBaseTemplateDataSource().reconcileObjects('template/id', ids) },
  { kind: 'module', parameter: 'installation_ids', reconcile: (ids?: string[]) => moduleReviewDataSource.reconcileInstallations!('template/id', ids) },
])('$kind reconcile scope', ({ kind, parameter, reconcile }) => {
  it('rejects empty selection before fetching and preserves the distinction between selected and all', async () => {
    const fetcher = vi.fn(async () => Response.json({ revision_id: 'latest' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(reconcile([])).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const root = '/api/v1/library/' + kind + '-templates/template%2Fid/reconcile';
    await reconcile(['a', 'b']);
    await reconcile();
    expect(fetcher.mock.calls).toEqual([
      [root + '?' + parameter + '=a&' + parameter + '=b', { method: 'POST' }],
      [root, { method: 'POST' }],
    ]);
  });
});
