import { describe, expect, it } from 'vitest';
import { genericConnectionPoints } from './genericEndpointPresentation';
import type { TopologyProjectionNode } from './types';

describe('generic endpoint presentation', () => {
  it('naturally orders labels and uses canonical ConnectionPoint UUID as the stable tie-breaker', () => {
    const node: TopologyProjectionNode = { id: 'manual', kind: 'PHYSICAL_OBJECT', label: 'Manual', source_refs: [], attributes: { connection_points: [
      { connection_point_id: 'z', display_name: 'Port2', cardinality: 1, external_connection_count: 0 },
      { connection_point_id: 'b', display_name: 'Port1', cardinality: 1, external_connection_count: 0 },
      { connection_point_id: 'a', display_name: 'Port1', cardinality: 1, external_connection_count: 0 },
      { connection_point_id: 'c', display_name: 'Port10', cardinality: 1, external_connection_count: 0 },
    ] } };
    expect(genericConnectionPoints(node).map((point) => point.connection_point_id)).toEqual(['a', 'b', 'z', 'c']);
  });
});
