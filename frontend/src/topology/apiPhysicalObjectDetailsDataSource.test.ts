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

  it('validates operational port provenance, bindings, and resolved cable attachments', () => {
    const result = parsePhysicalObjectDetailsDocument({
      ...physicalObjectDocument,
      blueprint_provenance: {
        blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'bp' },
        version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'version' },
        version_number: 2,
      },
      connection_points: [{ ...physicalObjectDocument.connection_points[0], ordering_key: 'A01', blueprint_slot: { slot_key: 'A01', kind: 'NETWORK_PORT' }, direct_interface_bindings: [{ interface_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'NetworkInterface', entity_id: 'ni' }, label: 'A01', evidence_refs: [] }], internal_physical_counterparts: [], external_physical_attachments: [{ kind: 'CABLE', connection_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Connection', entity_id: 'c1' }, evidence_refs: [], cable_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: 'cable' }, cable_label: 'Cable 1', remote_physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'remote' }, remote_physical_object_label: 'PP1', remote_connection_point_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'remote-cp' }, remote_connection_point_label: 'B01' }] }],
    });
    expect(result.connection_points[0].blueprint_slot?.slot_key).toBe('A01');
    expect(() => parsePhysicalObjectDetailsDocument({ ...result, connection_points: [{ ...result.connection_points[0], external_physical_attachments: [{ kind: 'GUESS', connection_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Connection', entity_id: 'c' }, evidence_refs: [] }] }] })).toThrow(/kind/);
  });
});
