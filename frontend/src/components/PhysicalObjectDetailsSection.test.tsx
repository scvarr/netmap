import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import type { TopologyProjectionNode } from '../topology/types';
import { PhysicalObjectDetailsSection } from './PhysicalObjectDetailsSection';

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
const node = (id = 'object') => ({ id, kind: 'PHYSICAL_OBJECT', label: id, attributes: {}, source_refs: [ref('PhysicalObject', id)] }) as TopologyProjectionNode;
const point = (label: string, id = label, extra = {}): PhysicalObjectDetailsDocument['connection_points'][number] => ({ connection_point_ref: ref('ConnectionPoint', id), label, cardinality: 1, incident_connection_count: 0, external_connection_count: 0, direct_interface_binding_count: 0, ordering_key: label, direct_interface_bindings: [], internal_physical_counterparts: [], external_physical_attachments: [], source_refs: [], ...extra });
const document = (points = [point('A01')]): PhysicalObjectDetailsDocument => ({ schema_version: '1.0', physical_object: { source_ref: ref('PhysicalObject', 'object'), label: 'Object' }, connection_points: points, owned_interface_count: 0, gaps: [], warnings: [] });
const renderDetails = (value: PhysicalObjectDetailsDocument, props = {}) => render(<MemoryRouter><PhysicalObjectDetailsSection node={node()} dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(value) }} {...props} /></MemoryRouter>);

describe('PhysicalObjectDetailsSection ports', () => {
  it('renders active ports in natural ordering with factual status, neighbour, cable, interface and connect action', async () => {
    const cable = point('A10', 'a10', { direct_interface_bindings: [{ interface_ref: ref('NetworkInterface', 'ni'), label: 'Eth1', evidence_refs: [] }], external_physical_attachments: [{ kind: 'SIMPLE_CABLE', connection_ref: ref('Connection', 'c'), evidence_refs: [], cable_label: 'CAB-1', remote_physical_object_label: 'SW2', remote_connection_point_label: 'Eth2' }] });
    const direct = point('A02', 'a02', { external_physical_attachments: [{ kind: 'DIRECT_CONNECTION', connection_ref: ref('Connection', 'd'), evidence_refs: [], remote_physical_object_label: 'PP1', remote_connection_point_label: 'B01' }] });
    renderDetails(document([cable, direct, point('A01')]), { deviceDetailsDataSource: { loadDeviceDetails: vi.fn() }, writeDataSource: { createPhysicalEndpointConnection: vi.fn() } });
    await screen.findByRole('rowheader', { name: 'A01' });
    expect(screen.getAllByRole('row').slice(1).map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['A01', 'A02', 'A10']);
    expect(screen.getByText('Свободен')).toBeInTheDocument();
    expect(screen.getByText(/SW2 · Eth2 · CAB-1/)).toBeInTheDocument();
    expect(screen.getByText('PP1 · B01')).toBeInTheDocument();
    expect(screen.getByText('Eth1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Подключить/i })).toBeInTheDocument();
  });

  it('states unresolved external attachment without presenting a remote endpoint', async () => {
    renderDetails(document([point('A01', 'a', { external_physical_attachments: [{ kind: 'UNRESOLVED', connection_ref: ref('Connection', 'c'), evidence_refs: [], remote_physical_object_label: 'Adjacent cable' }] })]));
    expect(await screen.findByText('Физическая связь не разрешена')).toBeInTheDocument();
    expect(screen.queryByText('Adjacent cable')).not.toBeInTheDocument();
  });

  it('renders exact symmetric internal pairs once as channels and falls back for ambiguous topology', async () => {
    const a = point('A01', 'a'); const b = point('B01', 'b');
    a.internal_physical_counterparts = [{ connection_point_ref: ref('ConnectionPoint', 'b'), label: 'B01', connection_ref: ref('Connection', 'ab'), evidence_refs: [] }];
    b.internal_physical_counterparts = [{ connection_point_ref: ref('ConnectionPoint', 'a'), label: 'A01', connection_ref: ref('Connection', 'ab'), evidence_refs: [] }];
    const { rerender } = renderDetails(document([a, b]));
    expect(await screen.findByRole('heading', { name: 'Каналы' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    rerender(<MemoryRouter><PhysicalObjectDetailsSection node={node()} dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(document([{ ...a, internal_physical_counterparts: [] }, b])) }} /></MemoryRouter>);
    expect(await screen.findByRole('columnheader', { name: 'Порт' })).toBeInTheDocument();
  });

  it('hides structural add-point for blueprint instances and keeps it explicit for manual objects', async () => {
    const blueprint = { ...document(), blueprint_provenance: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v1' }, version_number: 3 } };
    const { rerender } = renderDetails(blueprint, { connectionPointWriteDataSource: { createConnectionPoint: vi.fn() } });
    expect(await screen.findByText(/версия 3/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть шаблон' })).toHaveAttribute('href', '/library/object-blueprints/bp/versions/v1/edit');
    expect(screen.queryByRole('button', { name: '+ Добавить точку' })).not.toBeInTheDocument();
    rerender(<MemoryRouter><PhysicalObjectDetailsSection node={node()} dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(document()) }} connectionPointWriteDataSource={{ createConnectionPoint: vi.fn() }} /></MemoryRouter>);
    expect(await screen.findByText('Ручная структура')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Добавить точку' })).toBeInTheDocument();
  });

  it('keeps technical identities collapsed until requested', async () => {
    renderDetails(document());
    const technical = await screen.findByText('Технические данные');
    await userEvent.click(technical);
    expect(screen.getByText('ConnectionPoint')).toBeInTheDocument();
  });
});
