import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiConnectionPointWriteDataSource } from './apiConnectionPointWriteDataSource';
import type { PhysicalObjectDetailsDocument } from './physicalObjectDetailsTypes';

const document: PhysicalObjectDetailsDocument = {
  schema_version: '1.0',
  physical_object: {
    source_ref: {
      ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'object/id',
    },
    label: 'PP1',
    class: 'patch_panel',
  },
  connection_points: [{
    connection_point_ref: {
      ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'point-2',
    },
    label: 'Port02',
    cardinality: 1,
    incident_connection_count: 0,
    external_connection_count: 0,
    direct_interface_binding_count: 0,
    source_refs: [],
  }],
  owned_interface_count: 0,
  gaps: [],
  warnings: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('ApiConnectionPointWriteDataSource', () => {
  it('posts to the selected public physical object endpoint and validates the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(document), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const request = { display_name: 'Port02' };

    await expect(
      new ApiConnectionPointWriteDataSource().createConnectionPoint('object/id', request),
    ).resolves.toEqual(document);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/topology/physical-objects/object%2Fid/connection-points',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
    );
  });

  it('rejects malformed success payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...document,
      connection_points: [{ ...document.connection_points[0], cardinality: 0 }],
    }), { status: 201 })));

    await expect(new ApiConnectionPointWriteDataSource().createConnectionPoint(
      'object-a',
      { display_name: 'Port02' },
    )).rejects.toThrow('Malformed physical object details response');
  });

  it('surfaces typed backend errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'VALIDATION_ERROR', message: 'PhysicalObject does not exist' },
    }), { status: 422 })));

    await expect(new ApiConnectionPointWriteDataSource().createConnectionPoint(
      'missing',
      { display_name: 'Port02' },
    )).rejects.toThrow('VALIDATION_ERROR: PhysicalObject does not exist');
  });
});
