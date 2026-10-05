import { describe, expect, it } from 'vitest';
import { internalL1Segments } from './internalL1Presentation';
import type { TopologyProjectionNode } from './types';

const panel = (key: string, x: number) => ({ panel_key: key, panel_number: x ? 2 : 1, display_name: key, x, y: 0, width: 100, height: 50 });
const slot = (key: string, panel_key: string, x: number, y: number) => ({ slot_key: key, display_name: key, kind: 'CONNECTION_POINT' as const, panel_key, panel_local_position: { x, y }, rendered_position: { x: (panel_key === 'right' ? 100 : 0) / 200 + x / 2, y }, external_attachment: { x, y, side: 'TOP' as const }, connection_point_id: key });
const link = (member: string, from: string, to: string) => ({ from_connection_point_id: from, from_member_index: 1, to_connection_point_id: to, to_member_index: 1, connection_id: `connection-${member}`, connection_member_id: member, source_refs: [] });
const node = (links: TopologyProjectionNode['attributes']['internal_l1_links'] = []): TopologyProjectionNode => ({
  id: 'panel', kind: 'PHYSICAL_OBJECT', label: 'PP1', source_refs: [], attributes: {
    blueprint_presentation: {
      blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'bp' },
      version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'v1' },
      body: { kind: 'RECTANGLE', width: 100, height: 50 },
      panels: [panel('left', 0), panel('right', 100)],
      slots: [slot('a', 'left', .2, .5), slot('b', 'right', .8, .5)],
    }, internal_l1_links: links,
  },
});

describe('internal L1 panel presentation', () => {
  it('derives both link ends from panel rectangles and local endpoint coordinates', () => {
    expect(internalL1Segments(node([link('one', 'a', 'b')]), false, new Set(), new Set(), 400)[0])
      .toMatchObject({ from: { x: 40, y: 50 }, to: { x: 360, y: 50 } });
  });
  it('keeps canonical links and exact highlight state', () => {
    const segments = internalL1Segments(node([link('b', 'a', 'b'), link('a', 'b', 'a')]), false, new Set(['b']));
    expect(segments.map((segment) => segment.connectionMemberId)).toEqual(['a', 'b']);
    expect(segments.map((segment) => segment.state)).toEqual(['normal', 'trace-highlighted']);
  });
  it('skips links with unknown endpoints', () => {
    expect(internalL1Segments(node([link('missing', 'a', 'unknown')]), false)).toEqual([]);
  });
});
