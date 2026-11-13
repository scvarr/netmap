import { Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { getConnectionPointEndpoint, getFloatingEndpoints, getRenderedConnectionPoint, routedCablePath, type NodeRectangle } from './FloatingTopologyEdge';
import type { TopologyProjectionNode } from '../topology/types';

const node = (x: number, y: number): NodeRectangle => ({ x, y, width: 200, height: 100 });

describe('floating topology edge geometry', () => {
  it('uses persisted waypoints literally and in their stored order', () => {
    expect(routedCablePath(
      { x: 10, y: 20, side: Position.Right },
      { x: 90, y: 80, side: Position.Left },
      [{ x: 50, y: -1 }, { x: -4, y: 12 }, { x: 33.5, y: 7 }],
    )).toBe('M 10 20 L 50 -1 L -4 12 L 33.5 7 L 90 80');
  });

  it('keeps an explicit zero-waypoint route as the exact endpoint-to-endpoint path', () => {
    expect(routedCablePath(
      { x: 10, y: 20, side: Position.Right },
      { x: 90, y: 80, side: Position.Left },
      [],
    )).toBe('M 10 20 L 90 80');
  });

  it('lands on the exact generic rail marker identified by canonical ConnectionPoint UUID', () => {
    const projection: TopologyProjectionNode = { id: 'manual', kind: 'PHYSICAL_OBJECT', label: 'Outlet', source_refs: [], attributes: { connection_points: [
      { connection_point_id: 'port-10', display_name: 'Port10', cardinality: 1, external_connection_count: 0 },
      { connection_point_id: 'port-2', display_name: 'Port2', cardinality: 1, external_connection_count: 0 },
      { connection_point_id: 'port-1', display_name: 'Port1', cardinality: 1, external_connection_count: 0 },
    ] } };
    expect(getConnectionPointEndpoint(projection, node(10, 20), 'port-1')).toMatchObject({ x: 210, y: 45, side: Position.Right });
    expect(getConnectionPointEndpoint(projection, node(10, 20), 'port-10')).toMatchObject({ x: 210, y: 95, side: Position.Right });
  });

  it('keeps a Blueprint slot anchor exact when a cable path is routed', () => {
    const projection: TopologyProjectionNode = { id: 'blueprint', kind: 'PHYSICAL_OBJECT', label: 'Patch panel', source_refs: [], attributes: {
      blueprint_presentation: { blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'v1' }, body: { kind: 'RECTANGLE', width: 200, height: 100 }, panels: [{ panel_key: 'one', panel_number: 1, display_name: 'Panel 1', x: 0, y: 0, width: 200, height: 100 }], slots: [{ slot_key: 'rear01', display_name: 'rear01', kind: 'CONNECTION_POINT', connection_point_id: 'rear-01', panel_key: 'one', panel_local_position: { x: .25, y: .5 }, rendered_position: { x: .25, y: .5 }, external_attachment: { x: .25, y: 0, side: 'TOP' } }] },
    } };
    const endpoint = getConnectionPointEndpoint(projection, { ...node(10, 20), width: 292 }, 'rear-01');
    const renderedPort = getRenderedConnectionPoint(projection, { ...node(10, 20), width: 292 }, 'rear-01');
    expect(endpoint).toMatchObject({ x: 132, y: 20, side: Position.Top });
    expect(renderedPort).toMatchObject({ x: 132, y: 70, side: Position.Top });
    expect(routedCablePath(endpoint!, { x: 300, y: 200, side: Position.Left }, [{ x: 80, y: 30 }]))
      .toBe('M 132 20 L 80 30 L 300 200');
    expect(routedCablePath(renderedPort!, { x: 320, y: 220, side: Position.Left }, [{ x: 80, y: 30 }]))
      .toBe('M 132 70 L 80 30 L 320 220');
  });

  it('uses complete composition coordinates for slots on adjacent panels', () => {
    const projection: TopologyProjectionNode = { id: 'blueprint', kind: 'PHYSICAL_OBJECT', label: 'Patch panel', source_refs: [], attributes: {
      blueprint_presentation: { blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'v1' }, body: { kind: 'RECTANGLE', width: 200, height: 100 }, panels: [{ panel_key: 'a', panel_number: 1, display_name: 'A', x: 0, y: 0, width: 200, height: 100 }, { panel_key: 'b', panel_number: 2, display_name: 'B', x: 0, y: 100, width: 200, height: 100 }], slots: [{ slot_key: 'front', display_name: 'front', kind: 'CONNECTION_POINT', connection_point_id: 'front', panel_key: 'a', panel_local_position: { x: .25, y: .5 }, rendered_position: { x: .25, y: .25 }, external_attachment: { x: .25, y: 0, side: 'TOP' } }, { slot_key: 'rear', display_name: 'rear', kind: 'CONNECTION_POINT', connection_point_id: 'rear', panel_key: 'b', panel_local_position: { x: .25, y: .5 }, rendered_position: { x: .25, y: .75 }, external_attachment: { x: .25, y: 1, side: 'BOTTOM' } }] },
    } };
    expect(getConnectionPointEndpoint(projection, { x: 10, y: 20, width: 292, height: 200 }, 'front')).toMatchObject({ x: 132, y: 20, side: Position.Top });
    expect(getConnectionPointEndpoint(projection, { x: 10, y: 20, width: 292, height: 200 }, 'rear')).toMatchObject({ x: 132, y: 220, side: Position.Bottom });
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


describe('OBJECT-UX-01 dense three-zone endpoint geometry', () => {
  it.each([48, 52])('keeps %s ports aligned through resize without mutating published coordinates', count => {
    const columns = count / 2;
    const slots = Array.from({ length: count }, (_, i) => {
      const point = { x: (i % columns + .5) / columns, y: i < columns ? .25 : .75 };
      return { slot_key: `${i}`, display_name: `${i}`, kind: 'NETWORK_PORT' as const, connection_point_id: `${i}`, panel_key: 'one', panel_local_position: point, rendered_position: point, external_attachment: { ...point, side: 'TOP' as const } };
    });
    const projection: TopologyProjectionNode = { id: 'dense', kind: 'PHYSICAL_OBJECT', label: 'Long object name without U', source_refs: [], attributes: { blueprint_presentation: { blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'b' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'v' }, body: { kind: 'RECTANGLE', width: 480, height: 44 }, panels: [{ panel_key: 'one', panel_number: 1, display_name: 'Panel', x: 0, y: 0, width: 480, height: 44 }], slots } } };
    const before = JSON.stringify(projection);
    for (const width of [columns * 10, 480, 960]) {
      for (const slot of slots) {
        const point = getRenderedConnectionPoint(projection, { x: 100, y: 50, width: width + 92, height: width * 44 / 480 }, slot.connection_point_id)!;
        expect(point.x).toBeCloseTo(100 + 72 + width * slot.panel_local_position.x);
        expect(point.y).toBeCloseTo(50 + width * 44 / 480 * slot.panel_local_position.y);
      }
    }
    expect(JSON.stringify(projection)).toBe(before);
  });
});
