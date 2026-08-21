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
  cable_ref: ref('PhysicalObject', 'cable'),
  source_binding_ref: ref('InterfacePhysicalBinding', 'source-binding'),
  target_binding_ref: ref('InterfacePhysicalBinding', 'target-binding'),
  connection_refs: [
    ref('Connection', 'connection-1'),
    ref('Connection', 'connection-2'),
    ref('Connection', 'connection-3'),
  ],
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
      cable_display_name: 'CORE-FW-01',
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

  it('rejects a response that does not contain all three connection refs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...document,
      connection_refs: document.connection_refs.slice(0, 2),
    }), { status: 201 })));

    await expect(new ApiPhysicalLinkWriteDataSource().createPhysicalLink({
      source_interface_id: 'source-interface',
      target_interface_id: 'target-interface',
    })).rejects.toThrow('connection_refs must contain exactly three refs');
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
