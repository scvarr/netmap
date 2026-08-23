import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiInterfacePhysicalTraceDataSource } from './apiInterfacePhysicalTraceDataSource';

const artifact = {
  schema_version: 1,
  query: { from_interface_id: 'interface-a', to_interface_id: 'interface-b' },
  verdict: 'UNKNOWN', branches: [], gaps: [{ code: 'L1_TOPOLOGY_INCOMPLETE' }], warnings: [],
};

describe('ApiInterfacePhysicalTraceDataSource', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('posts the public query and returns the validated artifact', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));
    await expect(new ApiInterfacePhysicalTraceDataSource().traceInterfacePhysical(artifact.query)).resolves.toEqual(artifact);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/traces/interfaces/physical', expect.objectContaining({
      method: 'POST', body: JSON.stringify(artifact.query),
    }));
  });

  it('rejects artifacts outside the public verdict contract', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...artifact, verdict: 'UNREACHABLE' }), { status: 200 }));
    await expect(new ApiInterfacePhysicalTraceDataSource().traceInterfacePhysical(artifact.query)).rejects.toThrow('verdict');
  });
});
