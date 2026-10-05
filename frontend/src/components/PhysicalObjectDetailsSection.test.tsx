import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import type { TopologyProjectionNode } from '../topology/types';
import { PhysicalObjectClassEditor, PhysicalObjectDetailsSection } from './PhysicalObjectDetailsSection';
import { I18nProvider } from '../i18n';

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
const node = (id = 'object') => ({ id, kind: 'PHYSICAL_OBJECT', label: id, attributes: {}, source_refs: [ref('PhysicalObject', id)] }) as TopologyProjectionNode;
const point = (label: string, id = label, extra = {}): PhysicalObjectDetailsDocument['connection_points'][number] => ({ connection_point_ref: ref('ConnectionPoint', id), label, cardinality: 1, incident_connection_count: 0, external_connection_count: 0, direct_interface_binding_count: 0, ordering_key: label, direct_interface_bindings: [], internal_physical_counterparts: [], external_physical_attachments: [], source_refs: [], ...extra });
const document = (points = [point('A01')]): PhysicalObjectDetailsDocument => ({ schema_version: '1.0', physical_object: { source_ref: ref('PhysicalObject', 'object'), label: 'Object' }, connection_points: points, owned_interface_count: 0, gaps: [], warnings: [] });
const renderDetails = (value: PhysicalObjectDetailsDocument, props = {}) => render(<MemoryRouter><PhysicalObjectDetailsSection node={node()} dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(value) }} {...props} /></MemoryRouter>);
const deferred = <T,>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>((next) => { resolve = next; }), resolve }; };

describe('PhysicalObjectDetailsSection ports', () => {
  it('renders module contextual names for physical ports, bound interfaces and remote attachments', async () => {
    const first = 'Back / PCIe1 / feth1'; const second = 'Back / PCIe2 / feth1';
    renderDetails(document([
      point(first, 'module-one', { direct_interface_bindings: [{ interface_ref: ref('NetworkInterface', 'ni-one'), label: first, evidence_refs: [] }] }),
      point(second, 'module-two', { external_physical_attachments: [{ kind: 'DIRECT_CONNECTION', connection_ref: ref('Connection', 'link'), evidence_refs: [], remote_physical_object_label: 'Other object', remote_connection_point_label: 'Front / Slot 1 / feth1' }] }),
      point('MGMT'),
    ]));
    expect(await screen.findByRole('rowheader', { name: first })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: second })).toBeInTheDocument();
    expect(within(screen.getByRole('rowheader', { name: first }).closest('tr')!).getAllByText(first)).toHaveLength(2);
    expect(screen.getByText('Other object · Front / Slot 1 / feth1')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'MGMT' })).toBeInTheDocument();
  });
  it('renders active ports in natural display-label ordering with factual status, neighbour, cable, interface and icon actions', async () => {
    const cable = point('A10', 'a10', { ordering_key: '000', direct_interface_bindings: [{ interface_ref: ref('NetworkInterface', 'ni'), label: 'Eth1', evidence_refs: [] }], external_physical_attachments: [{ kind: 'CABLE', connection_ref: ref('Connection', 'c'), cable_ref: ref('Cable', 'cable'), evidence_refs: [], cable_label: 'CAB-1', remote_physical_object_label: 'SW2', remote_connection_point_label: 'Eth2' }] });
    const direct = point('A02', 'a02', { ordering_key: 'zzz', external_physical_attachments: [{ kind: 'DIRECT_CONNECTION', connection_ref: ref('Connection', 'd'), evidence_refs: [], remote_physical_object_label: 'PP1', remote_connection_point_label: 'B01' }] });
    renderDetails(document([cable, direct, point('A01')]), { deviceDetailsDataSource: { loadDeviceDetails: vi.fn() }, writeDataSource: { createPhysicalEndpointConnection: vi.fn(), deleteExternalPhysicalConnection: vi.fn() } });
    await screen.findByRole('rowheader', { name: 'A01' });
    expect(screen.getAllByRole('row').slice(1).map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['A01', 'A02', 'A10']);
    expect(screen.getByText('Свободен')).toBeInTheDocument();
    expect(screen.getByText(/SW2 · Eth2 · CAB-1/)).toBeInTheDocument();
    expect(screen.getByText('PP1 · B01')).toBeInTheDocument();
    expect(screen.getByText('Eth1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подключить порт' })).toHaveAttribute('title', 'Подключить порт');
    expect(screen.getAllByRole('button', { name: 'Разорвать физическое подключение' })).toHaveLength(2);
    expect(screen.queryByText('Технические данные')).not.toBeInTheDocument();
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

  it('keeps free channel endpoints connectable without per-port technical refs', async () => {
    const a = point('A01', 'a'); const b = point('B01', 'b');
    a.internal_physical_counterparts = [{ connection_point_ref: ref('ConnectionPoint', 'b'), label: 'B01', connection_ref: ref('Connection', 'ab'), evidence_refs: [] }];
    b.internal_physical_counterparts = [{ connection_point_ref: ref('ConnectionPoint', 'a'), label: 'A01', connection_ref: ref('Connection', 'ab'), evidence_refs: [] }];
    renderDetails(document([a, b]), { deviceDetailsDataSource: { loadDeviceDetails: vi.fn() }, writeDataSource: { createPhysicalEndpointConnection: vi.fn() } });
    await screen.findByRole('heading', { name: 'Каналы' });
    expect(screen.getAllByRole('button', { name: 'Подключить порт' })).toHaveLength(2);
    expect(screen.queryByText('Технические данные')).not.toBeInTheDocument();
  });

  it('confirms one disconnect write and retries only authoritative details refresh', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const occupied = document([point('A01', 'a', { external_connection_count: 1, incident_connection_count: 1, external_physical_attachments: [{ kind: 'CABLE', connection_ref: ref('Connection', 'external'), cable_ref: ref('Cable', 'cable'), evidence_refs: [], cable_label: 'CAB-1' }] })]);
    const refreshed = document([point('A01', 'a')]);
    const load = vi.fn().mockResolvedValueOnce(occupied).mockRejectedValueOnce(new Error('refresh failed')).mockResolvedValueOnce(refreshed);
    const deleteExternalPhysicalConnection = vi.fn().mockResolvedValue(undefined);
    renderDetails(occupied, { dataSource: { loadPhysicalObjectDetails: load }, writeDataSource: { createPhysicalEndpointConnection: vi.fn(), deleteExternalPhysicalConnection } });
    await userEvent.click(await screen.findByRole('button', { name: 'Разорвать физическое подключение' }));
    expect(deleteExternalPhysicalConnection).toHaveBeenCalledWith('external');
    expect(await screen.findByText('Не удалось загрузить физический объект.')).toBeInTheDocument();
    expect(screen.queryByText(/refresh failed/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('rowheader', { name: 'A01' })).toBeInTheDocument();
    expect(deleteExternalPhysicalConnection).toHaveBeenCalledTimes(1);
  });

  it('uses ordinary ports for paired network ports or bound interfaces and hides mixed-cardinality summary', async () => {
    const a = point('A01', 'a', { blueprint_slot: { slot_key: 'A01', kind: 'NETWORK_PORT' }, direct_interface_bindings: [{ interface_ref: ref('NetworkInterface', 'ni'), label: 'A01', evidence_refs: [] }] }); const b = point('B01', 'b');
    a.internal_physical_counterparts = [{ connection_point_ref: ref('ConnectionPoint', 'b'), label: 'B01', connection_ref: ref('Connection', 'ab'), evidence_refs: [] }];
    b.internal_physical_counterparts = [{ connection_point_ref: ref('ConnectionPoint', 'a'), label: 'A01', connection_ref: ref('Connection', 'ab'), evidence_refs: [] }];
    renderDetails(document([{ ...a, cardinality: 2 }, b]));
    expect(await screen.findByRole('columnheader', { name: 'Порт' })).toBeInTheDocument();
    expect(screen.queryByText(/Подключено:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Свободно:/)).not.toBeInTheDocument();
  });

  it('hides structural add-point for blueprint instances and keeps it explicit for manual objects', async () => {
    const blueprint = { ...document(), blueprint_provenance: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'BaseTemplate' as const, entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'BaseTemplateRevision' as const, entity_id: 'v1' }, version_number: 3 } };
    const { rerender } = renderDetails(blueprint, { connectionPointWriteDataSource: { createConnectionPoint: vi.fn() } });
    expect(screen.queryByRole('button', { name: '+ Добавить точку' })).not.toBeInTheDocument();
    rerender(<MemoryRouter><PhysicalObjectDetailsSection node={node()} dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(document()) }} connectionPointWriteDataSource={{ createConnectionPoint: vi.fn() }} /></MemoryRouter>);
    expect(await screen.findByText('Ручная структура')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Добавить точку' })).toBeInTheDocument();
  });

  it('keeps technical identities collapsed until requested', async () => {
    renderDetails(document());
    const technical = await screen.findByText('Технические данные объекта');
    await userEvent.click(technical);
    expect(screen.getByText('PhysicalObject')).toBeInTheDocument();
  });

  it('retries local load errors, rejects stale responses, and does not load ambiguous refs', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(document());
    const { rerender } = render(<MemoryRouter><PhysicalObjectDetailsSection node={node()} dataSource={{ loadPhysicalObjectDetails: load }} /></MemoryRouter>);
    expect(await screen.findByText('Не удалось загрузить физический объект.')).toBeInTheDocument(); expect(screen.queryByText(/offline/)).not.toBeInTheDocument(); await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('rowheader', { name: 'A01' })).toBeInTheDocument();
    const first = deferred<PhysicalObjectDetailsDocument>(); const second = deferred<PhysicalObjectDetailsDocument>();
    const delayed = vi.fn((id: string) => id === 'one' ? first.promise : second.promise);
    rerender(<MemoryRouter><PhysicalObjectDetailsSection node={node('one')} dataSource={{ loadPhysicalObjectDetails: delayed }} /></MemoryRouter>);
    rerender(<MemoryRouter><PhysicalObjectDetailsSection node={node('two')} dataSource={{ loadPhysicalObjectDetails: delayed }} /></MemoryRouter>);
    second.resolve(document([point('Two')])); expect(await screen.findByRole('rowheader', { name: 'Two' })).toBeInTheDocument(); first.resolve(document([point('One')])); await Promise.resolve(); expect(screen.queryByRole('rowheader', { name: 'One' })).not.toBeInTheDocument();
    const noLoad = vi.fn(); rerender(<MemoryRouter><PhysicalObjectDetailsSection node={{ ...node(), source_refs: [ref('PhysicalObject', 'a'), ref('PhysicalObject', 'b')] }} dataSource={{ loadPhysicalObjectDetails: noLoad }} /></MemoryRouter>);
    expect(screen.getByText(/однозначно определить объект/)).toBeInTheDocument(); expect(noLoad).not.toHaveBeenCalled();
  });

  it('uses authoritative class and manual point responses with callbacks', async () => {
    const initial = document(); const updated = { ...initial, physical_object: { ...initial.physical_object, class: 'switch' } }; const afterPoint = document([point('A01'), point('A02')]);
    const setPhysicalObjectClass = vi.fn().mockResolvedValue(updated); const createConnectionPoint = vi.fn().mockResolvedValue(afterPoint); const onClassUpdated = vi.fn(); const onConnectionPointCreated = vi.fn();
    render(<MemoryRouter><PhysicalObjectClassEditor physicalObjectId="object" currentClass={initial.physical_object.class} dataSource={{ setPhysicalObjectClass }} onUpdated={onClassUpdated} /></MemoryRouter>);
    expect(await screen.findByText('ФИЗИЧЕСКИЙ ОБЪЕКТ')).toBeInTheDocument(); expect(screen.queryByLabelText('Классификация')).not.toBeInTheDocument(); await userEvent.click(screen.getByRole('button', { name: 'Изменить тип объекта' })); await userEvent.selectOptions(screen.getByLabelText('Классификация'), 'switch'); await userEvent.click(screen.getByRole('button', { name: 'Сохранить тип' }));
    expect(setPhysicalObjectClass).toHaveBeenCalledWith('object', 'switch'); expect(onClassUpdated).toHaveBeenCalledTimes(1);
    renderDetails(initial, { connectionPointWriteDataSource: { createConnectionPoint }, onConnectionPointCreated });
    await screen.findByRole('rowheader', { name: 'A01' });
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить точку' })); await userEvent.type(screen.getByLabelText('Название'), 'A02'); await userEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByRole('rowheader', { name: 'A02' })).toBeInTheDocument(); expect(createConnectionPoint).toHaveBeenCalledWith('object', { display_name: 'A02' }); expect(onConnectionPointCreated).toHaveBeenCalledTimes(1);
  });
});
