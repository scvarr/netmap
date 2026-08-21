import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiDeviceWriteDataSource } from './apiDeviceWriteDataSource';
import type { DeviceDetailsDocument } from './deviceDetailsTypes';

const document: DeviceDetailsDocument = {
  schema_version: '1.0',
  device: {
    source_ref: {
      ref_type: 'CANONICAL_FACT',
      entity_type: 'PhysicalObject',
      entity_id: '00000000-0000-0000-0000-000000000001',
    },
    label: 'CORE-NEW',
  },
  interfaces: [{
    interface_ref: {
      ref_type: 'CANONICAL_FACT',
      entity_type: 'NetworkInterface',
      entity_id: '00000000-0000-0000-0000-000000000002',
    },
    label: 'eth0',
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

describe('ApiDeviceWriteDataSource', () => {
  it('posts the public create request and validates DeviceDetailsDocument', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(document), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const request = {
      display_name: 'CORE-NEW',
      initial_interface: { display_name: 'eth0' },
    };

    await expect(new ApiDeviceWriteDataSource().createNetworkDevice(request)).resolves.toEqual(
      document,
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/topology/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  });

  it('rejects malformed success payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...document,
      device: { ...document.device, label: 17 },
    }), { status: 201 })));

    await expect(new ApiDeviceWriteDataSource().createNetworkDevice({
      display_name: 'CORE-NEW',
      initial_interface: { display_name: 'eth0' },
    })).rejects.toThrow('Malformed device details response');
  });

  it('surfaces the typed backend error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: {} },
    }), { status: 422 })));

    await expect(new ApiDeviceWriteDataSource().createNetworkDevice({
      display_name: 'CORE-NEW',
      initial_interface: { display_name: 'eth0' },
    })).rejects.toThrow('VALIDATION_ERROR: Request validation failed');
  });
});
