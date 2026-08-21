import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiDeviceDetailsDataSource } from './apiDeviceDetailsDataSource';
import type { DeviceDetailsDocument } from './deviceDetailsTypes';

const document: DeviceDetailsDocument = {
  schema_version: '1.0',
  device: {
    source_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'device-a' },
    label: 'PhysicalObject device-a',
    label_source: 'TECHNICAL_FALLBACK',
  },
  interfaces: [{
    interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'interface-a' },
    label: 'NetworkInterface interface-a',
    label_source: 'TECHNICAL_FALLBACK',
    addresses: [{
      address: '2001:db8::10',
      prefix_length: 64,
      source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'InterfaceAddress', entity_id: 'address-a' }],
    }],
    l2_binding_count: 1,
    l3_binding_count: 1,
    direct_physical_bindings: [{
      connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'point-a' },
      member_index: 2,
      source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'InterfacePhysicalBinding', entity_id: 'binding-a' }],
    }],
    realization_down_count: 0,
    realization_up_count: 1,
    source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'interface-a' }],
  }],
  gaps: [],
  warnings: [],
};

const jsonResponse = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  ...init,
});

describe('ApiDeviceDetailsDataSource', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads and validates the complete public device details response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(document));

    await expect(new ApiDeviceDetailsDataSource().loadDeviceDetails('device/a')).resolves.toEqual(document);

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/topology/devices/device%2Fa');
  });

  it.each([
    [{ ...document, schema_version: '2.0' }, 'schema_version'],
    [{ ...document, interfaces: [{ ...document.interfaces[0], l2_binding_count: -1 }] }, 'l2_binding_count'],
    [{ ...document, interfaces: [{ ...document.interfaces[0], interface_ref: { ...document.interfaces[0].interface_ref, ref_type: 'OTHER' } }] }, 'ref_type'],
    [{ ...document, interfaces: [{ ...document.interfaces[0], addresses: [{ ...document.interfaces[0].addresses[0], prefix_length: 129 }] }] }, 'prefix_length'],
    [{ ...document, interfaces: [{ ...document.interfaces[0], addresses: [{ address: '192.0.2.1', prefix_length: 24 }] }] }, 'source_refs'],
    [{ ...document, interfaces: [{ ...document.interfaces[0], direct_physical_bindings: [{ member_index: 0 }] }] }, 'connection_point_ref'],
  ])('rejects malformed nested DTO data', async (body, expectedPath) => {
    fetchMock.mockResolvedValue(jsonResponse(body));
    await expect(new ApiDeviceDetailsDataSource().loadDeviceDetails('device-a')).rejects.toThrow(
      String(expectedPath),
    );
  });

  it('turns backend ErrorResponse into a readable error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      error: { code: 'VALIDATION_ERROR', message: 'PhysicalObject does not exist', details: {} },
    }, { status: 422 }));

    await expect(new ApiDeviceDetailsDataSource().loadDeviceDetails('missing')).rejects.toThrow(
      'VALIDATION_ERROR: PhysicalObject does not exist',
    );
  });
});
