import { describe, expect, it, vi } from 'vitest';
import { physicalObjectDocument } from '../test/physicalObjectDetailsFixture';
import { ApiPhysicalObjectDisplayNameWriteDataSource } from './apiPhysicalObjectDisplayNameWriteDataSource';

describe('ApiPhysicalObjectDisplayNameWriteDataSource', () => {
  it('puts a display name and parses authoritative details', async () => {
    const responseDocument = {
      ...physicalObjectDocument,
      physical_object: { ...physicalObjectDocument.physical_object, label: 'Renamed' },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(responseDocument),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new ApiPhysicalObjectDisplayNameWriteDataSource()
      .renamePhysicalObject('object/id', 'Renamed')).resolves.toEqual(responseDocument);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/topology/physical-objects/object%2Fid/display-name',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: 'Renamed' }),
      },
    );
  });
});
