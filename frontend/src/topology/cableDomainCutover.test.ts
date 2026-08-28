import { describe, expect, it } from 'vitest';
import { parsePhysicalObjectDetailsDocument } from './apiPhysicalObjectDetailsDataSource';
import { cableRouteForCollapsedCable } from './cableRoutePresentation';
import type { TopologyProjectionNode } from './types';

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });

describe('Cable.1 canonical frontend contracts', () => {
  it('accepts only a canonical Cable attachment in object details', () => {
    const document: any = {
      schema_version: '1.0', physical_object: { source_ref: ref('PhysicalObject', 'left'), label: 'left' },
      connection_points: [{ connection_point_ref: ref('ConnectionPoint', 'p'), label: 'p', cardinality: 1, incident_connection_count: 1, external_connection_count: 1, direct_interface_binding_count: 0, source_refs: [], external_physical_attachments: [{ kind: 'CABLE', connection_ref: ref('Connection', 'connection'), cable_ref: ref('Cable', 'cable'), evidence_refs: [] }] }],
      owned_interface_count: 0, gaps: [], warnings: [],
    };
    expect(parsePhysicalObjectDetailsDocument(document)).toEqual(document);
    document.connection_points[0].external_physical_attachments[0].cable_ref = ref('PhysicalObject', 'cable');
    expect(() => parsePhysicalObjectDetailsDocument(document)).toThrow('must be a Cable ref');
  });

  it('matches routes by canonical Cable identity, never a PhysicalObject identity', () => {
    const cable: TopologyProjectionNode = { id: 'node', kind: 'PHYSICAL_OBJECT', label: 'Cable', source_refs: [ref('Cable', 'cable')], attributes: {} };
    const route: any = { cable_ref: ref('Cable', 'cable'), view: 'L1/PHYSICAL_OBJECT', waypoints: [] };
    expect(cableRouteForCollapsedCable(cable, [route])).toBe(route);
    expect(cableRouteForCollapsedCable(cable, [{ ...route, cable_ref: ref('PhysicalObject', 'cable') }])).toBeUndefined();
  });
});
