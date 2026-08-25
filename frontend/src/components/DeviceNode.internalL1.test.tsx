import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
}));

import { DeviceNode } from './DeviceNode';

const projection = {
  id: 'panel', kind: 'PHYSICAL_OBJECT', label: 'PP1', source_refs: [],
  attributes: {
    blueprint_presentation: {
      blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' },
      version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v1' },
      body: { kind: 'RECTANGLE' as const, width: 200, height: 100 },
      slots: [
        { slot_key: 'front01', display_name: 'Front 01', kind: 'CONNECTION_POINT' as const, anchor: { side: 'LEFT' as const, offset: .25 }, connection_point_id: 'front-01' },
        { slot_key: 'rear01', display_name: 'Rear 01', kind: 'CONNECTION_POINT' as const, anchor: { side: 'RIGHT' as const, offset: .75 }, connection_point_id: 'rear-01' },
      ],
    },
    internal_l1_links: [{ from_connection_point_id: 'front-01', from_member_index: 1, to_connection_point_id: 'rear-01', to_member_index: 1, connection_id: 'connection-1', connection_member_id: 'member-1', source_refs: [] }],
  },
};

describe('DeviceNode internal L1 overlay', () => {
  it('renders the canonical segment at its exact blueprint anchors and applies exact trace state', () => {
    render(<DeviceNode {...({ data: { projection, traceHighlightedConnectionMemberIds: new Set(['member-1']) }, selected: false } as any)} />);
    const line = screen.getByTestId('internal-l1-line-member-1');
    expect(line).toHaveAttribute('x1', '0');
    expect(line).toHaveAttribute('y1', '25');
    expect(line).toHaveAttribute('x2', '200');
    expect(line).toHaveAttribute('y2', '75');
    expect(line).toHaveClass('internal-l1-continuity__line--trace-highlighted');
    expect(screen.getByTitle('Front 01 · CONNECTION_POINT')).toHaveClass('blueprint-map-node__port--trace-highlighted');
    expect(screen.getByTitle('Rear 01 · CONNECTION_POINT')).toHaveClass('blueprint-map-node__port--trace-highlighted');
  });
});
