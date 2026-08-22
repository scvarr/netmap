import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';

export const physicalObjectDocument: PhysicalObjectDetailsDocument = {
  schema_version: '1.0',
  physical_object: {
    source_ref: {
      ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'object/id',
    },
    label: 'Розетка 101-1',
  },
  connection_points: [{
    connection_point_ref: {
      ref_type: 'CANONICAL_FACT', entity_type: 'ConnectionPoint', entity_id: 'point-1',
    },
    label: 'Порт',
    cardinality: 1,
    incident_connection_count: 0,
    direct_interface_binding_count: 0,
    source_refs: [{
      ref_type: 'CANONICAL_FACT', entity_type: 'EntityMetadata', entity_id: 'alias-1',
    }],
  }],
  owned_interface_count: 0,
  gaps: [],
  warnings: [],
};
