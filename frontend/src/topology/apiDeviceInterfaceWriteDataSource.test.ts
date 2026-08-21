import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiDeviceInterfaceWriteDataSource } from './apiDeviceInterfaceWriteDataSource';
import type { DeviceDetailsDocument } from './deviceDetailsTypes';

const document: DeviceDetailsDocument = {
  schema_version: '1.0',
  device: {
    source_ref: {
      ref_type: 'CANONICAL_FACT',
      entity_type: 'PhysicalObject',
      entity_id: 'device/id',
    },
    label: 'CORE-NEW',
  },
  interfaces: [{
    interface_ref: {
      ref_type: 'CANONICAL_FACT',
      entity_type: 'NetworkInterface',
      entity_id: 'interface-eth1',
    },
    label: 'eth1',
    addresses: [],
    l2_binding_count: 0,
    l3_binding_count: 0,
    direct_physical_bindings: [],
    realization_down_count: 0,
    realization_up_count: 0,
    source_refs: [],
  }],
  gaps: [],
  warnings: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('ApiDeviceInterfaceWriteDataSource', () => {
  it('posts to the selected public device endpoint and validates the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(document), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const request = { display_name: 'eth1' };

    await expect(
      new ApiDeviceInterfaceWriteDataSource().createDeviceInterface('device/id', request),
    ).resolves.toEqual(document);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/topology/devices/device%2Fid/interfaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  });

  it('rejects malformed success payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...document,
      interfaces: [{ ...document.interfaces[0], l2_binding_count: -1 }],
    }), { status: 201 })));

    await expect(new ApiDeviceInterfaceWriteDataSource().createDeviceInterface(
      'device-a',
      { display_name: 'eth1' },
    )).rejects.toThrow('Malformed device details response');
  });

  it('surfaces typed backend errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'VALIDATION_ERROR', message: 'PhysicalObject does not exist' },
    }), { status: 422 })));

    await expect(new ApiDeviceInterfaceWriteDataSource().createDeviceInterface(
      'missing',
      { display_name: 'eth1' },
    )).rejects.toThrow('VALIDATION_ERROR: PhysicalObject does not exist');
  });
});
