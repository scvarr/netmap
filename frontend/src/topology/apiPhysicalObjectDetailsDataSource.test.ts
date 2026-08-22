import { describe, expect, it, vi } from 'vitest';
import {
  ApiPhysicalObjectDetailsDataSource,
  parsePhysicalObjectDetailsDocument,
} from './apiPhysicalObjectDetailsDataSource';
import { physicalObjectDocument } from '../test/physicalObjectDetailsFixture';

describe('ApiPhysicalObjectDetailsDataSource', () => {
  it('loads and validates the public details document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(physicalObjectDocument),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new ApiPhysicalObjectDetailsDataSource()
      .loadPhysicalObjectDetails('object/id');

    expect(result).toEqual(physicalObjectDocument);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/topology/physical-objects/object%2Fid');
  });

  it('rejects malformed factual counts and source refs', () => {
    expect(() => parsePhysicalObjectDetailsDocument({
      ...physicalObjectDocument,
      connection_points: [{
        ...physicalObjectDocument.connection_points[0],
        cardinality: 0,
      }],
    })).toThrow(/cardinality/);
    expect(() => parsePhysicalObjectDetailsDocument({
      ...physicalObjectDocument,
      physical_object: {
        ...physicalObjectDocument.physical_object,
        source_ref: { ref_type: 'OTHER', entity_type: 'PhysicalObject', entity_id: 'id' },
      },
    })).toThrow(/CANONICAL_FACT/);
  });

  it('accepts an optional class and rejects a blank class', () => {
    expect(parsePhysicalObjectDetailsDocument({
      ...physicalObjectDocument,
      physical_object: { ...physicalObjectDocument.physical_object, class: 'custom-kind' },
    }).physical_object.class).toBe('custom-kind');
    expect(() => parsePhysicalObjectDetailsDocument({
      ...physicalObjectDocument,
      physical_object: { ...physicalObjectDocument.physical_object, class: '' },
    })).toThrow(/physical_object.class/);
  });
});
