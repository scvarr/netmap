import { describe, expect, it } from 'vitest';
import { objectVirtualChannels, OBJECT_CHANNEL_RAIL_OFFSET, type VirtualChannelSegment } from './objectVirtualChannels';
import { uniformGridPresentation } from './uniformGridPresentation';
import type { BlueprintPresentation } from './types';
import type { MapPlacement } from './savedMapTypes';

const presentation: BlueprintPresentation = {
  blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'bp' },
  version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'rev' },
  body: { kind: 'RECTANGLE', width: 200, height: 100 },
  panels: [{ panel_key: 'panel', panel_number: 1, display_name: 'Panel', x: 0, y: 0, width: 200, height: 100 }],
  slots: [[.2, .1], [.2, .3], [.6, .2], [.6, .8]].map(([x, y], i) => ({
    slot_key: String(i), connection_point_id: `cp-${i}`, display_name: String(i),
    kind: 'CONNECTION_POINT', panel_key: 'panel', panel_local_position: { x, y },
    rendered_position: { x, y }, external_attachment: { x: 1, y, side: 'RIGHT' },
  })),
};

function path(first: VirtualChannelSegment) {
  const segments: VirtualChannelSegment[] = [];
  for (let segment: VirtualChannelSegment | null = first; segment; segment = segment.next) segments.push(segment);
  return segments;
}

describe('object virtual channels', () => {
  it('builds all port paths without cables, with one exit and shared, orthogonal segments', () => {
    const graph = objectVirtualChannels(presentation, 200, 320);
    expect(graph.exit).toEqual({ x: 320, y: 50 });
    expect(graph.paths.size).toBe(presentation.slots.length);
    const used = new Set<VirtualChannelSegment>();
    for (const { connection_point_id, rendered_position: { x, y } } of presentation.slots) {
      const segments = path(graph.paths.get(connection_point_id)!);
      expect(segments[0].from).toEqual({ x: 72 + 200 * x, y: 100 * y });
      expect(segments.at(-1)?.to).toBe(graph.exit);
      segments.forEach(segment => used.add(segment));
    }
    expect(used.size).toBe(graph.segments.length);
    expect(graph.paths.get('cp-1')?.next).toBe(graph.paths.get('cp-0'));
    expect(path(graph.paths.get('cp-0')!)).toContain(path(graph.paths.get('cp-2')!)[1]);
    expect(new Set(graph.segments.map(s => JSON.stringify([s.from, s.to]))).size).toBe(used.size);
    for (const { from, to, next } of graph.segments) {
      expect((from.x === to.x) !== (from.y === to.y)).toBe(true);
      if (next) expect(to).toEqual(next.from);
      // Horizontal transit is outside the body or in the right-hand reserve.
      if (from.y === to.y) expect(from.y < 0 || from.y > 100 || from.x > 272).toBe(true);
    }
    const resized = objectVirtualChannels(presentation, 400, 492);
    expect(resized.exit).toEqual({ x: 492, y: 100 });
    expect(resized.paths.get('cp-0')?.from).toEqual({ x: 152, y: 20 });
    expect([...resized.paths.keys()].sort()).toEqual([...graph.paths.keys()].sort());
  });

  it('reserves top and bottom corridors in both grid orientations while preserving equipment sizes', () => {
    const placements: MapPlacement[] = ['a', 'b'].map(entity_id => ({
      physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id },
      positions: {},
    }));
    const rectangle = { x: 0, y: 0, width: 292, height: 100 };
    const objects = placements.map(p => ({ physicalObjectId: p.physical_object_ref.entity_id, rectangle, flexibleCableZone: true }));
    for (const direction of ['VERTICAL', 'HORIZONTAL'] as const) {
      const { frames, positions } = uniformGridPresentation([], placements, objects, [], {
        mode: 'uniform_grid', version: 1, hide_empty: false, tables: {},
        object_sequences: { root: { direction, order: ['b', 'a'] } },
      });
      const a = positions.get('a')!, b = positions.get('b')!;
      const root = frames.get('root')!;
      for (const box of [a, b]) {
        expect(box).toMatchObject({ width: rectangle.width, height: rectangle.height });
        expect(box.y - OBJECT_CHANNEL_RAIL_OFFSET).toBeGreaterThan(root.y);
        expect(box.y + box.height + OBJECT_CHANNEL_RAIL_OFFSET).toBeLessThan(root.y + root.height);
      }
      if (direction === 'VERTICAL') expect(b.y + b.height + OBJECT_CHANNEL_RAIL_OFFSET).toBeLessThan(a.y - OBJECT_CHANNEL_RAIL_OFFSET);
      else expect(b.x + b.width).toBeLessThan(a.x);
    }
  });
});
