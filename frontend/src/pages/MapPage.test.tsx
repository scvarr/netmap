import { describe, expect, it } from 'vitest';
import { mapCandidateChoices } from './MapPage';
import type { CatalogInventoryEquipmentItem } from '../topology/catalogInventoryTypes';

const equipment = (id: string, label: string, className?: string): CatalogInventoryEquipmentItem => ({ physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: id }, label, ...(className ? { class: className } : {}), map_memberships: [] });

describe('Saved Map candidate picker', () => {
  it('uses catalog equipment and excludes already placed objects', () => {
    expect(mapCandidateChoices([
      equipment('00000000-0000-4000-8000-000000000001', 'PC1'),
      equipment('00000000-0000-4000-8000-000000000002', 'Z10', 'switch'),
      equipment('00000000-0000-4000-8000-000000000003', 'Z2'),
    ], ['00000000-0000-4000-8000-000000000001']).map((item) => item.label)).toEqual(['Z2', 'Z10']);
  });
});
