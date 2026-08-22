import { describe, expect, it } from 'vitest';
import { FixtureTopologyDataSource } from './fixtureTopologyDataSource';
import { toFlowProjection } from './layout';

const request = {
  layer: 'L2' as const,
  detail_level: 'DEVICE' as const,
  scope: { include_location_subtrees: [], include_entities: [] },
};

describe('FixtureTopologyDataSource', () => {
  it('returns the deterministic U.1 projection through the DTO boundary', async () => {
    const source = new FixtureTopologyDataSource();
    const first = await source.loadProjection(request);
    const second = await source.loadProjection(request);

    expect(first.nodes.map((node) => node.label)).toEqual([
      'SW-A-F1', 'SW-A-F2', 'CORE-A', 'EDGE-A', 'CORE-B', 'SW-B-F1', 'SW-B-F2',
    ]);
    expect(first.edges).toHaveLength(6);
    expect(first.nodes.every((node) => node.source_refs.length > 0)).toBe(true);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('maps projection DTOs to stable UI layout without mutating the document', async () => {
    const document = await new FixtureTopologyDataSource().loadProjection(request);
    const snapshot = structuredClone(document);
    const flow = await toFlowProjection(document);

    expect(flow.nodes.every((node) => Number.isFinite(node.position.x))).toBe(true);
    expect(flow.edges.find((edge) => edge.id === 'link-core-a-edge-a')).toMatchObject({
      source: 'core-a', target: 'edge-a',
    });
    expect(document).toEqual(snapshot);
  });
});
