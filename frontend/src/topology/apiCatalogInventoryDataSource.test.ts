import { describe, expect, it, vi } from 'vitest';
import { ApiCatalogInventoryDataSource, parseCatalogInventoryDocument } from './apiCatalogInventoryDataSource';

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT', entity_type, entity_id });
const document = (): any => ({
  schema_version: '1.0',
  equipment: [{ physical_object_ref: ref('PhysicalObject', 'sw'), label: 'SW1', class: 'switch', occupancy: { total_ports: 52, connected_ports: 17, free_ports: 35 }, map_memberships: [{ map_ref: { entity_type: 'SavedMap', entity_id: 'map' }, name: 'Primary' }] }],
  cables: [
    { cable_ref: ref('PhysicalObject', 'cable'), label: 'C-001', resolution: 'SIMPLE_CABLE', endpoint_a: { remote_physical_object_ref: ref('PhysicalObject', 'left'), remote_physical_object_label: 'Left', remote_connection_point_ref: ref('ConnectionPoint', 'lp'), remote_connection_point_label: 'L1', evidence_refs: [ref('Connection', 'c1'), ref('ConnectionMember', 'm1')] }, endpoint_b: { remote_physical_object_ref: ref('PhysicalObject', 'right'), remote_physical_object_label: 'Right', remote_connection_point_ref: ref('ConnectionPoint', 'rp'), remote_connection_point_label: 'R1', evidence_refs: [ref('Connection', 'c2'), ref('ConnectionMember', 'm2')] }, gaps: [], warnings: [] },
    { cable_ref: ref('PhysicalObject', 'broken'), label: 'Broken', label_source: 'TECHNICAL_FALLBACK', resolution: 'UNRESOLVED', gaps: [], warnings: [] },
  ], gaps: [], warnings: [],
});

describe('ApiCatalogInventoryDataSource', () => {
  it('parses equipment, map memberships, optional occupancy, and cable resolutions', () => {
    const value = document();
    value.equipment[0].occupancy = null;
    const parsed = parseCatalogInventoryDocument(value);
    expect(parsed.equipment[0].occupancy).toBeNull();
    expect(parsed.equipment[0].map_memberships[0].name).toBe('Primary');
    expect(parsed.cables[0].endpoint_a?.remote_connection_point_label).toBe('L1');
    expect(parsed.cables[1].resolution).toBe('UNRESOLVED');
    const absent = document();
    delete absent.equipment[0].occupancy;
    expect(parseCatalogInventoryDocument(absent).equipment[0].occupancy).toBeUndefined();
  });

  it('rejects malformed canonical refs and invalid cable relation shapes', () => {
    const malformedRef = document();
    malformedRef.equipment[0].physical_object_ref.ref_type = 'OTHER';
    expect(() => parseCatalogInventoryDocument(malformedRef)).toThrow(/ref_type/);
    const malformedCable = document();
    delete (malformedCable.cables[0] as Partial<typeof malformedCable.cables[number]>).endpoint_b;
    expect(() => parseCatalogInventoryDocument(malformedCable)).toThrow(/endpoint_b/);
    const guessedEndpoint = document();
    guessedEndpoint.cables[1] = { ...guessedEndpoint.cables[1], endpoint_a: guessedEndpoint.cables[0].endpoint_a };
    expect(() => parseCatalogInventoryDocument(guessedEndpoint)).toThrow(/unresolved cable/);
    const malformedMapRef = document();
    malformedMapRef.equipment[0].map_memberships[0].map_ref.ref_type = 'CANONICAL_FACT';
    expect(() => parseCatalogInventoryDocument(malformedMapRef)).toThrow(/unsupported fields/);
  });

  it('fetches the bounded public inventory endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(document()), { status: 200 }));
    await expect(new ApiCatalogInventoryDataSource().loadCatalogInventory()).resolves.toMatchObject({ schema_version: '1.0' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/catalog/inventory');
    fetchMock.mockRestore();
  });
});
