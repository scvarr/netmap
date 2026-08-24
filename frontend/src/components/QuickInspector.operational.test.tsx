import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { QuickInspector } from './QuickInspector';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import type { TopologyProjectionDocument, TopologyProjectionNode } from '../topology/types';

const ref = (type: string, id: string) => ({ ref_type: 'CANONICAL_FACT', entity_type: type, entity_id: id });
const node = (id = 'sw', label = 'SW1'): TopologyProjectionNode => ({ id, kind: 'PHYSICAL_OBJECT', label, attributes: { class: 'switch' }, source_refs: [ref('PhysicalObject', id)] });
const document = (nodes = [node()]): TopologyProjectionDocument => ({ schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes, edges: [], gaps: [], warnings: [] });
const details = (id = 'sw', points = 52): PhysicalObjectDetailsDocument => ({ schema_version: '1.0', physical_object: { source_ref: ref('PhysicalObject', id), label: id === 'sw' ? 'SW1' : 'PP1', class: 'switch' }, connection_points: Array.from({ length: points }, (_, i) => ({ connection_point_ref: ref('ConnectionPoint', `${id}-${i}`), label: `A${String(i + 1).padStart(2, '0')}`, cardinality: 1, incident_connection_count: 0, direct_interface_binding_count: 0, external_physical_attachments: i < 17 ? [{ kind: 'DIRECT_CONNECTION' as const, connection_ref: ref('Connection', `${i}`), evidence_refs: [], remote_physical_object_label: 'PP1', remote_connection_point_label: `B${i + 1}` }] : [], source_refs: [] })), owned_interface_count: 4, gaps: ['gap'], warnings: ['warning'] });
const view = (props: Partial<React.ComponentProps<typeof QuickInspector>> = {}) => render(<BrowserRouter><QuickInspector document={document()} selection={{ type: 'node', item: node() }} onClose={vi.fn()} onSelectNode={vi.fn()} {...props} /></BrowserRouter>);

describe('QuickInspector operational reads', () => {
  it('loads canonical details and renders authoritative occupancy, preview and notices', async () => {
    const loadPhysicalObjectDetails = vi.fn().mockResolvedValue(details());
    view({ physicalObjectDetailsDataSource: { loadPhysicalObjectDetails } });
    await screen.findByText('52 портов · 17 подключено · 35 свободно');
    expect(loadPhysicalObjectDetails).toHaveBeenCalledWith('sw');
    expect(screen.getByText('Ещё 11 подключений')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(screen.getByText('gap')).toBeInTheDocument();
  });

  it('keeps the current canonical selection when an older details request resolves late', async () => {
    let resolveA!: (value: PhysicalObjectDetailsDocument) => void;
    const pendingA = new Promise<PhysicalObjectDetailsDocument>((resolve) => { resolveA = resolve; });
    const loadPhysicalObjectDetails = vi.fn((id: string) => id === 'sw' ? pendingA : Promise.resolve(details('pp', 0)));
    const rendered = view({ physicalObjectDetailsDataSource: { loadPhysicalObjectDetails } });
    rendered.rerender(<BrowserRouter><QuickInspector document={document([node('pp', 'PP1')])} selection={{ type: 'node', item: node('pp', 'PP1') }} onClose={vi.fn()} onSelectNode={vi.fn()} physicalObjectDetailsDataSource={{ loadPhysicalObjectDetails }} /></BrowserRouter>);
    await screen.findByText('Портов нет');
    resolveA(details());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'PP1' })).toBeInTheDocument());
  });

  it('does not refetch details for a refreshed projection node with the same canonical id', async () => {
    const loadPhysicalObjectDetails = vi.fn().mockResolvedValue(details());
    const physicalObjectDetailsDataSource = { loadPhysicalObjectDetails };
    const rendered = view({ physicalObjectDetailsDataSource });
    await screen.findByText(/52 портов/);
    rendered.rerender(<BrowserRouter><QuickInspector document={document([node('sw', 'SW1 refreshed')])} selection={{ type: 'node', item: node('sw', 'SW1 refreshed') }} onClose={vi.fn()} onSelectNode={vi.fn()} physicalObjectDetailsDataSource={physicalObjectDetailsDataSource} /></BrowserRouter>);
    expect(loadPhysicalObjectDetails).toHaveBeenCalledTimes(1);
  });

  it('retries a failed details read', async () => {
    const loadPhysicalObjectDetails = vi.fn().mockRejectedValueOnce(new Error('details failed')).mockResolvedValueOnce(details());
    view({ physicalObjectDetailsDataSource: { loadPhysicalObjectDetails } });
    expect(await screen.findByRole('alert')).toHaveTextContent('details failed');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByText(/52 портов/);
    expect(loadPhysicalObjectDetails).toHaveBeenCalledTimes(2);
  });
});
