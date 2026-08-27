import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import type { TopologyProjectionNode } from '../topology/types';
import { PhysicalObjectDetailsSection } from './PhysicalObjectDetailsSection';
import { I18nProvider } from '../i18n';
import { BlueprintUpgradeApiError } from '../topology/blueprintUpgradeTypes';

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
const node = (id = 'object') => ({ id, kind: 'PHYSICAL_OBJECT', label: id, attributes: {}, source_refs: [ref('PhysicalObject', id)] }) as TopologyProjectionNode;
const point = (label: string, id = label, extra = {}): PhysicalObjectDetailsDocument['connection_points'][number] => ({ connection_point_ref: ref('ConnectionPoint', id), label, cardinality: 1, incident_connection_count: 0, external_connection_count: 0, direct_interface_binding_count: 0, ordering_key: label, direct_interface_bindings: [], internal_physical_counterparts: [], external_physical_attachments: [], source_refs: [], ...extra });
const document = (points = [point('A01')]): PhysicalObjectDetailsDocument => ({ schema_version: '1.0', physical_object: { source_ref: ref('PhysicalObject', 'object'), label: 'Object' }, connection_points: points, owned_interface_count: 0, gaps: [], warnings: [] });
const renderDetails = (value: PhysicalObjectDetailsDocument, props = {}) => render(<MemoryRouter><PhysicalObjectDetailsSection node={node()} dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(value) }} {...props} /></MemoryRouter>);
const deferred = <T,>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>((next) => { resolve = next; }), resolve }; };

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

  it('keeps free channel endpoints connectable and their per-port technical refs accessible', async () => {
    const a = point('A01', 'a'); const b = point('B01', 'b');
    a.internal_physical_counterparts = [{ connection_point_ref: ref('ConnectionPoint', 'b'), label: 'B01', connection_ref: ref('Connection', 'ab'), evidence_refs: [] }];
    b.internal_physical_counterparts = [{ connection_point_ref: ref('ConnectionPoint', 'a'), label: 'A01', connection_ref: ref('Connection', 'ab'), evidence_refs: [] }];
    renderDetails(document([a, b]), { deviceDetailsDataSource: { loadDeviceDetails: vi.fn() }, writeDataSource: { createPhysicalEndpointConnection: vi.fn() } });
    await screen.findByRole('heading', { name: 'Каналы' });
    expect(screen.getAllByRole('button', { name: 'Подключить' })).toHaveLength(2);
    await userEvent.click(screen.getAllByText('Технические данные')[0]);
    expect(screen.getAllByText('ConnectionPoint')).toHaveLength(2);
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
    const blueprint = { ...document(), blueprint_provenance: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v1' }, version_number: 3 } };
    const { rerender } = renderDetails(blueprint, { connectionPointWriteDataSource: { createConnectionPoint: vi.fn() } });
    expect(await screen.findByText(/версия 3/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть шаблон' })).toHaveAttribute('href', '/library/object-blueprints/bp/versions/v1/edit');
    expect(screen.queryByRole('button', { name: '+ Добавить точку' })).not.toBeInTheDocument();
    rerender(<MemoryRouter><PhysicalObjectDetailsSection node={node()} dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(document()) }} connectionPointWriteDataSource={{ createConnectionPoint: vi.fn() }} /></MemoryRouter>);
    expect(await screen.findByText('Ручная структура')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Добавить точку' })).toBeInTheDocument();
  });

  it('shows an outdated blueprint only after explicit dry-run, with localized changes and blockers', async () => {
    const blueprint = { ...document(), blueprint_provenance: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v1' }, version_number: 1 } };
    const analyzeBlueprintUpgrade = vi.fn().mockResolvedValue({ schema_version: '1.0', status: 'OUTDATED', current_version_number: 1, target_version_number: 2, compatible_changes: [{ code: 'SLOT_ADDED', slot_key: 'C' }], blockers: [{ code: 'SLOT_REMOVED', slot_key: 'B' }] });
    renderDetails(blueprint, { blueprintUpgradeDataSource: { analyzeBlueprintUpgrade }, objectBlueprintDataSource: { loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0', blueprints: [{ blueprint_ref: blueprint.blueprint_provenance.blueprint_ref, version_ref: { ...blueprint.blueprint_provenance.version_ref, entity_id: 'v2' }, version_number: 2, name: 'BP', body: { kind: 'RECTANGLE', width: 1, height: 1 }, slot_count: 0, internal_link_count: 0, version_count: 2 }] }), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn() } });
    expect(await screen.findByText(/Доступна версия 2/)).toBeInTheDocument(); expect(screen.queryByText('Добавлен порт C')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Проверить совместимость' }));
    expect(await screen.findByText(/Доступна версия 2/)).toBeInTheDocument(); expect(screen.getByText('Добавлен порт C')).toBeInTheDocument(); expect(screen.getByText('Удалён порт B')).toBeInTheDocument(); expect(analyzeBlueprintUpgrade).toHaveBeenCalledWith('object');
  });

  it('keeps an up-to-date blueprint detail uncluttered', async () => {
    const blueprint = { ...document(), blueprint_provenance: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v1' }, version_number: 1 } };
    renderDetails(blueprint, { blueprintUpgradeDataSource: { analyzeBlueprintUpgrade: vi.fn() }, objectBlueprintDataSource: { loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0', blueprints: [{ blueprint_ref: blueprint.blueprint_provenance.blueprint_ref, version_ref: blueprint.blueprint_provenance.version_ref, version_number: 1, name: 'BP', body: { kind: 'RECTANGLE', width: 1, height: 1 }, slot_count: 0, internal_link_count: 0, version_count: 1 }] }), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn() } });
    expect(await screen.findByText('Объект использует актуальную версию шаблона.')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Проверить совместимость' })).not.toBeInTheDocument();
  });

  it('applies only the reviewed target and retries only the refresh after a successful write', async () => {
    const blueprint = { ...document(), blueprint_provenance: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v1' }, version_number: 1 } };
    const load = vi.fn().mockResolvedValueOnce(blueprint).mockRejectedValueOnce(new Error('refresh')).mockResolvedValueOnce(blueprint);
    const applyBlueprintUpgrade = vi.fn().mockResolvedValue({});
    renderDetails(blueprint, { dataSource: { loadPhysicalObjectDetails: load }, blueprintUpgradeDataSource: { analyzeBlueprintUpgrade: vi.fn().mockResolvedValue({ schema_version: '1.0', status: 'OUTDATED', target_version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v2' }, target_version_number: 2, compatible_changes: [], blockers: [] }), applyBlueprintUpgrade }, objectBlueprintDataSource: { loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0', blueprints: [{ blueprint_ref: blueprint.blueprint_provenance.blueprint_ref, version_ref: { ...blueprint.blueprint_provenance.version_ref, entity_id: 'v2' }, version_number: 2, name: 'BP', body: { kind: 'RECTANGLE', width: 1, height: 1 }, slot_count: 0, internal_link_count: 0, version_count: 2 }] }), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn() } });
    await userEvent.click(await screen.findByRole('button', { name: 'Проверить совместимость' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Обновить до версии 2' }));
    expect(applyBlueprintUpgrade).toHaveBeenCalledWith('object', 'v2');
    expect(await screen.findByText(/обновление применено/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить обновление данных' }));
    expect(applyBlueprintUpgrade).toHaveBeenCalledTimes(1);
  });

  it('shows an alert when blueprint analysis rejects a malformed response', async () => {
    const blueprint = { ...document(), blueprint_provenance: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v1' }, version_number: 1 } };
    renderDetails(blueprint, { blueprintUpgradeDataSource: { analyzeBlueprintUpgrade: vi.fn().mockRejectedValue(new Error('Malformed Blueprint upgrade analysis response: status is unsupported.')) }, objectBlueprintDataSource: { loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0', blueprints: [{ blueprint_ref: blueprint.blueprint_provenance.blueprint_ref, version_ref: { ...blueprint.blueprint_provenance.version_ref, entity_id: 'v2' }, version_number: 2, name: 'BP', body: { kind: 'RECTANGLE', width: 1, height: 1 }, slot_count: 0, internal_link_count: 0, version_count: 2 }] }), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn() } });
    await userEvent.click(await screen.findByRole('button', { name: 'Проверить совместимость' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Malformed Blueprint upgrade analysis response: status is unsupported.');
  });

  it.each([
    ['treats a structured backend conflict as an upgrade conflict', new BlueprintUpgradeApiError('stale', 409, 'MODEL_ERROR', { reason: 'UPGRADE_CONFLICT' }), /Состояние изменилось/i],
    ['does not infer a conflict from an unstructured message', new Error('request failed with status 409'), /Не удалось применить обновление/i],
    ['does not classify other structured API failures as conflicts', new BlueprintUpgradeApiError('validation', 422, 'VALIDATION_ERROR'), /Не удалось применить обновление/i],
  ])('%s', async (_label, failure, expected) => {
    const blueprint = { ...document(), blueprint_provenance: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v1' }, version_number: 1 } };
    renderDetails(blueprint, { blueprintUpgradeDataSource: { analyzeBlueprintUpgrade: vi.fn().mockResolvedValue({ schema_version: '1.0', status: 'OUTDATED', target_version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v2' }, target_version_number: 2, compatible_changes: [], blockers: [] }), applyBlueprintUpgrade: vi.fn().mockRejectedValue(failure) }, objectBlueprintDataSource: { loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0', blueprints: [{ blueprint_ref: blueprint.blueprint_provenance.blueprint_ref, version_ref: { ...blueprint.blueprint_provenance.version_ref, entity_id: 'v2' }, version_number: 2, name: 'BP', body: { kind: 'RECTANGLE', width: 1, height: 1 }, slot_count: 0, internal_link_count: 0, version_count: 2 }] }), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn() } });
    await userEvent.click(await screen.findByRole('button', { name: 'Проверить совместимость' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Обновить до версии 2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
  });

  it('renders the new upgrade UI in English', async () => {
    window.localStorage.setItem('netmap.locale', 'en');
    const blueprint = { ...document(), blueprint_provenance: { blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id: 'bp' }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id: 'v1' }, version_number: 1 } };
    const list = { loadObjectBlueprints: vi.fn().mockResolvedValue({ schema_version: '1.0', blueprints: [{ blueprint_ref: blueprint.blueprint_provenance.blueprint_ref, version_ref: { ...blueprint.blueprint_provenance.version_ref, entity_id: 'v2' }, version_number: 2, name: 'BP', body: { kind: 'RECTANGLE', width: 1, height: 1 }, slot_count: 0, internal_link_count: 0, version_count: 2 }] }), loadObjectBlueprintVersion: vi.fn(), createObjectBlueprint: vi.fn() };
    render(<I18nProvider><MemoryRouter><PhysicalObjectDetailsSection node={node()} dataSource={{ loadPhysicalObjectDetails: vi.fn().mockResolvedValue(blueprint) }} blueprintUpgradeDataSource={{ analyzeBlueprintUpgrade: vi.fn().mockResolvedValue({ schema_version: '1.0', status: 'OUTDATED', compatible_changes: [], blockers: [] }) }} objectBlueprintDataSource={list} /></MemoryRouter></I18nProvider>);
    expect(await screen.findByText(/Version 2 is available/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Check compatibility' })).toBeInTheDocument();
    window.localStorage.removeItem('netmap.locale');
  });

  it('keeps technical identities collapsed until requested', async () => {
    renderDetails(document());
    const technical = await screen.findByText('Технические данные');
    await userEvent.click(technical);
    expect(screen.getByText('ConnectionPoint')).toBeInTheDocument();
  });

  it('retries local load errors, rejects stale responses, and does not load ambiguous refs', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(document());
    const { rerender } = render(<MemoryRouter><PhysicalObjectDetailsSection node={node()} dataSource={{ loadPhysicalObjectDetails: load }} /></MemoryRouter>);
    expect(await screen.findByText(/offline/)).toBeInTheDocument(); await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('rowheader', { name: 'A01' })).toBeInTheDocument();
    const first = deferred<PhysicalObjectDetailsDocument>(); const second = deferred<PhysicalObjectDetailsDocument>();
    const delayed = vi.fn((id: string) => id === 'one' ? first.promise : second.promise);
    rerender(<MemoryRouter><PhysicalObjectDetailsSection node={node('one')} dataSource={{ loadPhysicalObjectDetails: delayed }} /></MemoryRouter>);
    rerender(<MemoryRouter><PhysicalObjectDetailsSection node={node('two')} dataSource={{ loadPhysicalObjectDetails: delayed }} /></MemoryRouter>);
    second.resolve(document([point('Two')])); expect(await screen.findByRole('rowheader', { name: 'Two' })).toBeInTheDocument(); first.resolve(document([point('One')])); await Promise.resolve(); expect(screen.queryByRole('rowheader', { name: 'One' })).not.toBeInTheDocument();
    const noLoad = vi.fn(); rerender(<MemoryRouter><PhysicalObjectDetailsSection node={{ ...node(), source_refs: [ref('PhysicalObject', 'a'), ref('PhysicalObject', 'b')] }} dataSource={{ loadPhysicalObjectDetails: noLoad }} /></MemoryRouter>);
    expect(screen.getByText(/нет однозначной ссылки/)).toBeInTheDocument(); expect(noLoad).not.toHaveBeenCalled();
  });

  it('uses authoritative class and manual point responses with callbacks', async () => {
    const initial = document(); const updated = { ...initial, physical_object: { ...initial.physical_object, class: 'switch' } }; const afterPoint = document([point('A01'), point('A02')]);
    const setPhysicalObjectClass = vi.fn().mockResolvedValue(updated); const createConnectionPoint = vi.fn().mockResolvedValue(afterPoint); const onClassUpdated = vi.fn(); const onConnectionPointCreated = vi.fn();
    renderDetails(initial, { classWriteDataSource: { setPhysicalObjectClass }, connectionPointWriteDataSource: { createConnectionPoint }, onClassUpdated, onConnectionPointCreated });
    await screen.findByText('ФИЗИЧЕСКИЙ ОБЪЕКТ'); await userEvent.selectOptions(screen.getByLabelText('Классификация'), 'switch'); await userEvent.click(screen.getByRole('button', { name: 'Сохранить тип' }));
    expect(await screen.findByText('КОММУТАТОР')).toBeInTheDocument(); expect(onClassUpdated).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить точку' })); await userEvent.type(screen.getByLabelText('Название'), 'A02'); await userEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByRole('rowheader', { name: 'A02' })).toBeInTheDocument(); expect(createConnectionPoint).toHaveBeenCalledWith('object', { display_name: 'A02' }); expect(onConnectionPointCreated).toHaveBeenCalledTimes(1);
  });
});
