import { describe, expect, it, vi } from 'vitest';
import { physicalObjectDocument } from '../test/physicalObjectDetailsFixture';
import { ApiPhysicalObjectWriteDataSource } from './apiPhysicalObjectWriteDataSource';

describe('ApiPhysicalObjectWriteDataSource', () => {
  it('posts the bounded create request and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(physicalObjectDocument),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const request = {
      display_name: 'Розетка 101-1',
      initial_connection_point: { display_name: 'Порт' },
    };

    const result = await new ApiPhysicalObjectWriteDataSource().createPhysicalObject(request);

    expect(result).toEqual(physicalObjectDocument);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/topology/physical-objects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  });
});
