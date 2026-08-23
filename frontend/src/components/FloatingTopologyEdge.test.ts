import { Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { getConnectionPointEndpoint, getFloatingEndpoints, type NodeRectangle } from './FloatingTopologyEdge';
import type { TopologyProjectionNode } from '../topology/types';

const node = (x: number, y: number): NodeRectangle => ({ x, y, width: 200, height: 100 });

describe('floating topology edge geometry', () => {
  it('lands on the exact generic rail marker identified by canonical ConnectionPoint UUID', () => {
    const projection: TopologyProjectionNode = { id: 'manual', kind: 'PHYSICAL_OBJECT', label: 'Outlet', source_refs: [], attributes: { connection_points: [
      { connection_point_id: 'port-10', display_name: 'Port10', cardinality: 1, external_connection_count: 0 },
      { connection_point_id: 'port-2', display_name: 'Port2', cardinality: 1, external_connection_count: 0 },
      { connection_point_id: 'port-1', display_name: 'Port1', cardinality: 1, external_connection_count: 0 },
    ] } };
    expect(getConnectionPointEndpoint(projection, node(10, 20), 'port-1')).toMatchObject({ x: 210, y: 45, side: Position.Right });
    expect(getConnectionPointEndpoint(projection, node(10, 20), 'port-10')).toMatchObject({ x: 210, y: 95, side: Position.Right });
  });

  it('uses nearest horizontal sides even when raw source is geometrically right of target', () => {
    const endpoints = getFloatingEndpoints(node(500, 0), node(0, 0));

    expect(endpoints.source.side).toBe(Position.Left);
    expect(endpoints.target.side).toBe(Position.Right);
    expect(endpoints.source.x).toBe(500);
    expect(endpoints.target.x).toBe(200);
  });

  it('connects left-to-right geometry through right and left sides', () => {
    const endpoints = getFloatingEndpoints(node(0, 0), node(500, 0));

    expect(endpoints.source.side).toBe(Position.Right);
    expect(endpoints.target.side).toBe(Position.Left);
  });

  it('connects vertical geometry through bottom and top sides', () => {
    const endpoints = getFloatingEndpoints(node(0, 0), node(0, 300));

    expect(endpoints.source.side).toBe(Position.Bottom);
    expect(endpoints.target.side).toBe(Position.Top);
  });

  it('recomputes the nearest sides after a node moves', () => {
    const horizontal = getFloatingEndpoints(node(0, 0), node(500, 0));
    const vertical = getFloatingEndpoints(node(0, 0), node(0, 300));

    expect(horizontal.source.side).toBe(Position.Right);
    expect(vertical.source.side).toBe(Position.Bottom);
  });
});
