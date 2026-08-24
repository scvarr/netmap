import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopologyCanvas } from './TopologyCanvas';
const screenToFlowPosition = vi.fn().mockReturnValue({ x: 12, y: 34 });
vi.mock('@xyflow/react', () => ({ applyNodeChanges: (_: any, nodes: any) => nodes, Background: () => null, BackgroundVariant: { Dots: 'dots' }, Controls: () => null, MiniMap: () => null, Panel: ({ children }: any) => <>{children}</>, ReactFlow: ({ edges, onEdgeClick }: any) => <button onClick={(e) => onEdgeClick(e, edges[0])}>edge</button>, useReactFlow: () => ({ fitView: vi.fn(), screenToFlowPosition }) }));
vi.mock('./DeviceNode', () => ({ DeviceNode: () => null }));
const continuation: any = { id: 'continuation', local_node_id: 'local', local_physical_object_ref: { entity_id: 'local' }, local_connection_point_ref: { entity_id: 'lp' }, local_connection_point_display_name: 'A01', cable_ref: { entity_id: 'cable' }, cable_display_name: 'C1', remote_physical_object_ref: { entity_id: 'remote' }, remote_display_name: 'PP1', remote_connection_point_ref: { entity_id: 'rp' }, remote_connection_point_display_name: 'B01', source_refs: [] };
describe('TopologyCanvas continuation anchor', () => {
  it('converts the continuation edge click and preserves selection', async () => {
    const onContinuationClickAnchor = vi.fn(); const onSelectionChange = vi.fn();
    const document: any = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [{ id: 'local', kind: 'PHYSICAL_OBJECT', label: 'SW1', source_refs: [], attributes: {} }], edges: [], gaps: [], warnings: [], l1_off_map_continuations: [continuation] };
    const layoutEngine: any = async () => ({ nodes: [{ id: 'local', type: 'device', position: { x: 0, y: 0 }, data: { projection: document.nodes[0] } }], edges: [{ id: 'edge', source: 'local', target: 'local', data: { continuation } }] });
    render(<TopologyCanvas document={document} selection={null} onSelectionChange={onSelectionChange} onContinuationClickAnchor={onContinuationClickAnchor} layoutEngine={layoutEngine} />);
    fireEvent.click(await screen.findByRole('button', { name: 'edge' }), { clientX: 120, clientY: 340 });
    expect(screenToFlowPosition).toHaveBeenCalledWith({ x: 120, y: 340 });
    expect(onContinuationClickAnchor).toHaveBeenCalledWith('continuation', { x: 12, y: 34 });
    expect(onSelectionChange).toHaveBeenCalledWith({ type: 'continuation', item: continuation });
  });
});
