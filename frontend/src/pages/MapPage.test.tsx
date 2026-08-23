import { describe, expect, it } from 'vitest';
import { mapCandidateChoices } from './MapPage';
import type { TopologyProjectionNode } from '../topology/types';

const node = (id: string, label: string, className?: string): TopologyProjectionNode => ({ id, kind: 'PHYSICAL_OBJECT', label, source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id }], attributes: className ? { class: className } : {} });

describe('Saved Map candidate picker', () => {
  it('shows ordinary physical objects but excludes canonical cable mediators', () => {
    expect(mapCandidateChoices([
      node('00000000-0000-4000-8000-000000000001', 'PC1'),
      node('00000000-0000-4000-8000-000000000002', 'PP1'),
      node('00000000-0000-4000-8000-000000000003', 'cable-17', 'cable'),
    ], []).map((item) => item.label)).toEqual(['PC1', 'PP1']);
  });
});
