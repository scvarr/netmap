import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiPhysicalEndpointConnectionWriteDataSource } from './apiPhysicalEndpointConnectionWriteDataSource';

const ref = (entity_type: string, entity_id: string) => ({
  ref_type: 'CANONICAL_FACT', entity_type, entity_id,
});

const document = {
  schema_version: '1.0',
  source: {
    kind: 'CONNECTION_POINT',
    endpoint_ref: ref('ConnectionPoint', 'point-a'),
    connection_point_ref: ref('ConnectionPoint', 'point-a'),
    member_index: 1,
  },
  target: {
    kind: 'NETWORK_INTERFACE',
    endpoint_ref: ref('NetworkInterface', 'interface-b'),
    connection_point_ref: ref('ConnectionPoint', 'point-b'),
    interface_binding_ref: ref('InterfacePhysicalBinding', 'binding-b'),
    member_index: 1,
  },
  cable_ref: ref('Cable', 'cable'),
  connection_ref: ref('Connection', 'connection-a'),
};

afterEach(() => vi.unstubAllGlobals());

describe('ApiPhysicalEndpointConnectionWriteDataSource', () => {
  it('posts the endpoint union and validates materialized canonical refs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(document), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const request = {
      source: { kind: 'CONNECTION_POINT' as const, connection_point_id: 'point-a', member_index: 1 as const },
      target: { kind: 'NETWORK_INTERFACE' as const, network_interface_id: 'interface-b' },
    };

    await expect(
      new ApiPhysicalEndpointConnectionWriteDataSource().createPhysicalEndpointConnection(request),
    ).resolves.toEqual(document);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/topology/physical-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  });

  it('rejects a response that omits a NetworkInterface materialization binding', async () => {
    const malformed = structuredClone(document);
    delete (malformed.target as { interface_binding_ref?: unknown }).interface_binding_ref;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(malformed), {
      status: 201,
    })));

    await expect(
      new ApiPhysicalEndpointConnectionWriteDataSource().createPhysicalEndpointConnection({
        source: { kind: 'CONNECTION_POINT', connection_point_id: 'point-a', member_index: 1 },
        target: { kind: 'NETWORK_INTERFACE', network_interface_id: 'interface-b' },
      }),
    ).rejects.toThrow(/interface_binding_ref/);
  });

  it('keeps a typed backend validation error visible to the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'VALIDATION_ERROR', message: 'NetworkInterface already has a direct physical binding' },
    }), { status: 422 })));

    await expect(
      new ApiPhysicalEndpointConnectionWriteDataSource().createPhysicalEndpointConnection({
        source: { kind: 'CONNECTION_POINT', connection_point_id: 'point-a', member_index: 1 },
        target: { kind: 'NETWORK_INTERFACE', network_interface_id: 'interface-b' },
      }),
    ).rejects.toThrow(/already has a direct physical binding/);
  });

  it('deletes one external physical connection without parsing a response body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new ApiPhysicalEndpointConnectionWriteDataSource().deleteExternalPhysicalConnection('connection-a'),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/topology/physical-connections/connection-a', { method: 'DELETE' });
  });
});
