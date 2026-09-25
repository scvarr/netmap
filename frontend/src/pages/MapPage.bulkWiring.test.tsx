import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MapPage } from './MapPage';
import { createMapPageHarness } from './MapPage.testHarness';

vi.mock('../components/TopologyCanvas', () => ({ TopologyCanvas: (props: any) => <div data-testid="bulk-canvas">
  <button onClick={() => props.onPhysicalNodeContextMenu?.(nodes[0], { x: 20, y: 20 })}>source object menu</button>
  {['a1', 'a2', 'b1', 'b2'].map((id) => <button key={id} onClick={() => props.onPhysicalPortClick?.({ physicalObjectId: id[0], connectionPointId: id, label: id })}>{id}</button>)}
  <output data-testid="numbers">{JSON.stringify(props.bulkPortNumbers)}</output><output data-testid="pairs">{JSON.stringify(props.bulkPairs)}</output>
</div> }));
const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT', entity_type, entity_id });
const nodes = ['a', 'b'].map((id) => ({ id, kind: 'PHYSICAL_OBJECT', label: id, source_refs: [ref('PhysicalObject', id)], attributes: { class: 'switch', connection_points: [1, 2].map((index) => ({ connection_point_id: `${id}${index}`, display_name: `${id}${index}`, cardinality: 1, external_connection_count: 0 })) } }));
const doc: any = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes, edges: [], gaps: [], warnings: [] };
const map: any = { map_ref: ref('SavedMap', 'map'), active_variant_ref: ref('MapPresentationVariant', 'variant'), variants: [], name: 'Map', placements: nodes.map((node) => ({ physical_object_ref: ref('PhysicalObject', node.id), positions: { 'L1/PHYSICAL_OBJECT': { x: 0, y: 0 } } })) };
const renderPage = createMapPageHarness(MapPage);

function setup(projection = vi.fn().mockResolvedValue(doc)) {
  const create = vi.fn().mockResolvedValue({ created: [{ cable_id: 'c1', connection_id: 'l1' }, { cable_id: 'c2', connection_id: 'l2' }] });
  const preview = vi.fn().mockResolvedValue({ labels: [{ label: 'B001', historical: false }, { label: 'B002', historical: true }] });
  const setCableRoute = vi.fn();
  renderPage({ dataSource: { loadProjection: projection }, savedMapDataSource: { listMaps: vi.fn().mockResolvedValue([map]), loadMap: vi.fn().mockResolvedValue(map), setCableRoute } as any, physicalEndpointConnectionWriteDataSource: { createPhysicalEndpointConnection: vi.fn(), createBulkPhysicalConnections: create, previewBulkCableLabels: preview }, cableLabelDataSource: { loadCableLabelTemplates: vi.fn().mockResolvedValue({ templates: [{ id: 'template', name: 'Bulk' }] }) } as any }, '/map?map=map&view=physical');
  return { create, preview, projection, setCableRoute };
}
async function start() { await screen.findByTestId('bulk-canvas'); fireEvent.click(screen.getByText('source object menu')); fireEvent.click(screen.getByRole('menuitem', { name: 'Массовое соединение портов' })); }

describe('MapPage bulk port pairing', () => {
  it('keeps ordered source selection, renumbers toggles, previews reverse pairing and writes once', async () => {
    const { create, projection, setCableRoute } = setup(); await start();
    const readsBeforeCreate = projection.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'a2' })); fireEvent.click(screen.getByRole('button', { name: 'a1' }));
    expect(screen.getByTestId('numbers')).toHaveTextContent('"a2":1');
    fireEvent.click(screen.getByRole('button', { name: 'a2' })); fireEvent.click(screen.getByRole('button', { name: 'a2' }));
    expect(screen.getByTestId('numbers')).toHaveTextContent('"a1":1');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByText(/Выберите 2 портов/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'a1' }));
    expect(screen.getByText(/Выберите 2 портов/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'b2' }));
    expect(screen.getByText(/Выберите 2 портов/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'b1' }));
    expect(screen.getByTestId('pairs')).toHaveTextContent('"connectionPointId":"a1"');
    expect(screen.getByTestId('pairs')).toHaveTextContent('"connectionPointId":"b2"');
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ pairs: [expect.objectContaining({ source: expect.objectContaining({ connection_point_id: 'a1' }), target: expect.objectContaining({ connection_point_id: 'b2' }) }), expect.objectContaining({ source: expect.objectContaining({ connection_point_id: 'a2' }), target: expect.objectContaining({ connection_point_id: 'b1' }) })] }));
    expect(setCableRoute).not.toHaveBeenCalled();
    await waitFor(() => expect(projection.mock.calls.length).toBe(readsBeforeCreate + 1));
  });

  it('shows generated labels and requires explicit historical confirmation', async () => {
    const { create, preview } = setup(); await start();
    fireEvent.click(screen.getByRole('button', { name: 'a1' })); fireEvent.click(screen.getByRole('button', { name: 'a2' })); fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'b1' })); fireEvent.click(screen.getByRole('button', { name: 'b2' }));
    fireEvent.change(screen.getByLabelText('Имена кабелей'), { target: { value: 'template' } });
    await waitFor(() => expect(preview).toHaveBeenCalledWith('template', 2));
    expect(screen.getByText(/B001/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать кабель' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Подтвердить повторное использование B002'));
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ expected_generated_labels: ['B001', 'B002'], confirmed_historical_labels: ['B002'] })));
  });

  it('returns to source selection and Escape cancels', async () => {
    setup(); await start(); fireEvent.click(screen.getByRole('button', { name: 'a1' })); fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText(/Выберите свободные исходные порты/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Массовое соединение портов')).not.toBeInTheDocument();
  });

  it('retries only projection read after acknowledged creation', async () => {
    let reads = 0;
    const projection = vi.fn(() => ++reads === 3 ? Promise.reject(new Error('refresh')) : Promise.resolve(doc));
    const { create } = setup(projection); await start();
    fireEvent.click(screen.getByRole('button', { name: 'a1' })); fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'b1' })); fireEvent.keyDown(window, { key: 'Enter' });
    expect(await screen.findByText('Соединения созданы, но карту не удалось обновить.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(screen.queryByText('Соединения созданы, но карту не удалось обновить.')).not.toBeInTheDocument());
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('refreshes a stale generated label preview and waits for a new confirmation', async () => {
    const { create, preview } = setup();
    create.mockRejectedValueOnce(new Error('BULK_LABEL_PREVIEW_STALE'));
    preview.mockResolvedValueOnce({ labels: [{ label: 'B001', historical: false }] })
      .mockResolvedValueOnce({ labels: [{ label: 'B003', historical: false }] });
    await start(); fireEvent.click(screen.getByRole('button', { name: 'a1' })); fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'b1' }));
    fireEvent.change(screen.getByLabelText('Имена кабелей'), { target: { value: 'template' } });
    await screen.findByText(/B001/);
    fireEvent.keyDown(window, { key: 'Enter' });
    await screen.findByText(/B003/);
    expect(create).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ expected_generated_labels: ['B003'] }));
  });
});
