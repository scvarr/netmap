import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiPhysicalLinkWriteDataSource } from './apiPhysicalLinkWriteDataSource';
import type { PhysicalConnectionCreationDocument } from './physicalLinkWriteTypes';

const ref = (entity_type: string, entity_id: string) => ({
  ref_type: 'CANONICAL_FACT', entity_type, entity_id,
});

const document: PhysicalConnectionCreationDocument = {
  schema_version: '1.0',
  source_interface_ref: ref('NetworkInterface', 'source-interface'),
  target_interface_ref: ref('NetworkInterface', 'target-interface'),
  cable_ref: ref('Cable', 'cable'),
  source_binding_ref: ref('InterfacePhysicalBinding', 'source-binding'),
  target_binding_ref: ref('InterfacePhysicalBinding', 'target-binding'),
  connection_ref: ref('Connection', 'connection-1'),
};

afterEach(() => vi.unstubAllGlobals());

describe('ApiPhysicalLinkWriteDataSource', () => {
  it('posts the bounded user intent and validates canonical refs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(document), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const request = {
      source_interface_id: 'source-interface',
      target_interface_id: 'target-interface',
    };

    await expect(new ApiPhysicalLinkWriteDataSource().createPhysicalLink(request)).resolves.toEqual(
      document,
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/topology/physical-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  });

  it('rejects a response without the canonical Connection ref', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...document,
      connection_ref: ref('PhysicalObject', 'not-a-connection'),
    }), { status: 201 })));

    await expect(new ApiPhysicalLinkWriteDataSource().createPhysicalLink({
      source_interface_id: 'source-interface',
      target_interface_id: 'target-interface',
    })).rejects.toThrow('connection_ref.entity_type must be "Connection"');
  });

  it('surfaces typed backend validation errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'NetworkInterface already has a direct physical binding',
      },
    }), { status: 422 })));

    await expect(new ApiPhysicalLinkWriteDataSource().createPhysicalLink({
      source_interface_id: 'source-interface',
      target_interface_id: 'target-interface',
    })).rejects.toThrow('VALIDATION_ERROR: NetworkInterface already has');
  });
});
