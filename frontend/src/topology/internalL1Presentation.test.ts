import { describe, expect, it } from 'vitest';
import { internalL1Segments } from './internalL1Presentation';
import type { TopologyProjectionNode } from './types';

const panel = (links: TopologyProjectionNode['attributes']['internal_l1_links'] = []): TopologyProjectionNode => ({
  id: 'panel',
  kind: 'PHYSICAL_OBJECT',
  label: 'PP1',
  source_refs: [],
  attributes: {
    blueprint_presentation: {
      blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'bp' },
      version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v1' },
      body: { kind: 'RECTANGLE', width: 200, height: 100 },
      slots: [
        { slot_key: 'front01', display_name: 'Front 01', kind: 'CONNECTION_POINT', rendered_position: { x: 0, y: .25 }, external_attachment: { x: 0, y: .25, side: 'LEFT' }, connection_point_id: 'front-01' },
        { slot_key: 'rear01', display_name: 'Rear 01', kind: 'CONNECTION_POINT', rendered_position: { x: 1, y: .75 }, external_attachment: { x: 1, y: .75, side: 'RIGHT' }, connection_point_id: 'rear-01' },
        { slot_key: 'rear02', display_name: 'Rear 02', kind: 'CONNECTION_POINT', rendered_position: { x: .5, y: 1 }, external_attachment: { x: .5, y: 1, side: 'BOTTOM' }, connection_point_id: 'rear-02' },
      ],
    },
    internal_l1_links: links,
  },
});

const link = (member: string, to = 'rear-01') => ({
  from_connection_point_id: 'front-01', from_member_index: 1,
  to_connection_point_id: to, to_member_index: 1,
  connection_id: `connection-${member}`, connection_member_id: member, source_refs: [],
});

describe('internal L1 continuity presentation', () => {
  it('creates a blueprint-only segment on exact slot anchors', () => {
    expect(internalL1Segments(panel([link('member-1')]), false)).toEqual([{
      connectionMemberId: 'member-1', fromConnectionPointId: 'front-01', toConnectionPointId: 'rear-01',
      from: { x: 0, y: 25 }, to: { x: 200, y: 75 }, state: 'normal',
    }]);
  });

  it('does not invent geometry for absent internal links or unknown endpoints', () => {
    expect(internalL1Segments(panel(), false)).toEqual([]);
    expect(internalL1Segments(panel([{ ...link('member-unknown'), to_connection_point_id: 'unknown' }]), false)).toEqual([]);
  });

  it('keeps every canonical branched link and presents them deterministically', () => {
    const segments = internalL1Segments(panel([link('member-b', 'rear-02'), link('member-a')]), false);
    expect(segments.map((segment) => segment.connectionMemberId)).toEqual(['member-a', 'member-b']);
    expect(segments[1].to).toEqual({ x: 100, y: 100 });
  });

  it('uses normal, selected, and exact trace-member states without highlighting sibling links', () => {
    const node = panel([link('member-1'), link('member-2', 'rear-02')]);
    expect(internalL1Segments(node, false).map((segment) => segment.state)).toEqual(['normal', 'normal']);
    expect(internalL1Segments(node, true).map((segment) => segment.state)).toEqual(['selected', 'selected']);
    expect(internalL1Segments(node, true, new Set(['member-1'])).map((segment) => segment.state)).toEqual(['trace-highlighted', 'selected']);
    expect(internalL1Segments(node, false, new Set()).map((segment) => segment.state)).toEqual(['normal', 'normal']);
  });
});
