import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  NodeResizer: ({ onResizeEnd }: { onResizeEnd: (event: unknown, dimensions: { width: number }) => void }) => <button type="button" aria-label="resize" onClick={() => onResizeEnd({}, { width: 360 })} />,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
}));

import { DeviceNode } from './DeviceNode';

const projection = {
  id: 'panel', kind: 'PHYSICAL_OBJECT', label: 'PP1', source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'object-1' }],
  attributes: {
    blueprint_presentation: {
      blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' },
      version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v1' },
      body: { kind: 'RECTANGLE' as const, width: 200, height: 100 },
      slots: [
        { slot_key: 'front01', display_name: 'Front 01', kind: 'CONNECTION_POINT' as const, anchor: { side: 'LEFT' as const, offset: .25 }, connection_point_id: 'front-01' },
        { slot_key: 'rear01', display_name: 'Rear 01', kind: 'CONNECTION_POINT' as const, anchor: { side: 'RIGHT' as const, offset: .75 }, face: 'REAR' as const, connection_point_id: 'rear-01' },
      ],
    },
    internal_l1_links: [{ from_connection_point_id: 'front-01', from_member_index: 1, to_connection_point_id: 'rear-01', to_member_index: 1, connection_id: 'connection-1', connection_member_id: 'member-1', source_refs: [] }],
  },
};

describe('DeviceNode internal L1 overlay', () => {
  it('renders both physical faces simultaneously without runtime face tabs and keeps slots on their own surfaces', () => {
    render(<DeviceNode {...({ data: { projection, traceHighlightedConnectionMemberIds: new Set(['member-1']) }, selected: false, width: 320 } as any)} />);
    const front = screen.getByTestId('blueprint-face-FRONT');
    const rear = screen.getByTestId('blueprint-face-REAR');
    const body = screen.getByTestId('blueprint-map-node');
    expect(screen.queryByRole('button', { name: 'Передняя' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Задняя' })).not.toBeInTheDocument();
    expect(screen.queryByText('Передняя')).not.toBeInTheDocument();
    expect(screen.queryByText('Задняя')).not.toBeInTheDocument();
    expect(body).toHaveStyle({ height: '320px' });
    expect(within(body).getByTitle('PP1')).toHaveClass('blueprint-map-node__label');
    expect(front.nextElementSibling).toBe(rear);
    expect(within(front).getByTitle('Front 01 · CONNECTION_POINT')).toBeInTheDocument();
    expect(within(front).queryByTitle('Rear 01 · CONNECTION_POINT')).not.toBeInTheDocument();
    expect(within(rear).getByTitle('Rear 01 · CONNECTION_POINT')).toBeInTheDocument();
    expect(within(rear).queryByTitle('Front 01 · CONNECTION_POINT')).not.toBeInTheDocument();
    expect(front.querySelector('.blueprint-map-node__face-surface')).toHaveStyle({ height: '160px' });
    expect(rear.querySelector('.blueprint-map-node__face-surface')).toHaveStyle({ height: '160px' });
    // Cross-face continuity remains canonical/highlighted but has no misleading single-panel line.
    expect(screen.queryByTestId('internal-l1-line-member-1')).not.toBeInTheDocument();
    expect(screen.getByTitle('Front 01 · CONNECTION_POINT')).toHaveClass('blueprint-map-node__port--trace-highlighted');
    expect(screen.getByTitle('Rear 01 · CONNECTION_POINT')).toHaveClass('blueprint-map-node__port--trace-highlighted');
  });

  it('uses the historical missing face as FRONT and renders a REAR-only presentation alone', () => {
    const frontOnly = { ...projection, attributes: { ...projection.attributes, blueprint_presentation: { ...projection.attributes.blueprint_presentation, slots: [projection.attributes.blueprint_presentation.slots[0]] } } };
    const { rerender } = render(<DeviceNode {...({ data: { projection: frontOnly }, selected: false } as any)} />);
    expect(screen.getByTestId('blueprint-face-FRONT')).toBeInTheDocument();
    expect(screen.queryByTestId('blueprint-face-REAR')).not.toBeInTheDocument();
    expect(screen.getByTestId('blueprint-map-node')).toHaveStyle({ height: '120px' });
    const rearOnly = { ...projection, attributes: { ...projection.attributes, blueprint_presentation: { ...projection.attributes.blueprint_presentation, slots: [projection.attributes.blueprint_presentation.slots[1]] } } };
    rerender(<DeviceNode {...({ data: { projection: rearOnly }, selected: false } as any)} />);
    expect(screen.queryByTestId('blueprint-face-FRONT')).not.toBeInTheDocument();
    expect(screen.getByTestId('blueprint-face-REAR')).toBeInTheDocument();
  });

  it('persists one resized display width for both panels', () => {
    const onBlueprintDisplayResize = vi.fn();
    render(<DeviceNode {...({ data: { projection, blueprintResizeEnabled: true, onBlueprintDisplayResize }, selected: true, width: 320 } as any)} />);
    screen.getByRole('button', { name: 'resize' }).click();
    expect(onBlueprintDisplayResize).toHaveBeenCalledWith('object-1', 360);
  });
});
