import { describe, expect, it, vi } from 'vitest';
import { physicalObjectDocument } from '../test/physicalObjectDetailsFixture';
import { ApiPhysicalObjectClassWriteDataSource } from './apiPhysicalObjectClassWriteDataSource';

describe('ApiPhysicalObjectClassWriteDataSource', () => {
  it('puts the bounded class value and parses authoritative details', async () => {
    const responseDocument = {
      ...physicalObjectDocument,
      physical_object: { ...physicalObjectDocument.physical_object, class: 'outlet' },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(responseDocument),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new ApiPhysicalObjectClassWriteDataSource()
      .setPhysicalObjectClass('object/id', 'outlet')).resolves.toEqual(responseDocument);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/topology/physical-objects/object%2Fid/class',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'outlet' }),
      },
    );
  });
});
