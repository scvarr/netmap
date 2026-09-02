import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MapPage } from './MapPage';
import { createMapPageHarness } from './MapPage.testHarness';

vi.mock('../components/TopologyCanvas', () => ({ TopologyCanvas: (props: any) => <div data-testid="canvas" data-members={JSON.stringify([...props.compositeMemberSelection?.selectedPhysicalObjectIds ?? []])}>{props.document.nodes.map((node: any) => <button key={node.id} type="button" onClick={() => props.compositeMemberSelection ? props.compositeMemberSelection.onPhysicalObjectClick(node.source_refs[0].entity_id) : props.onSelectionChange({ type: 'node', item: node })}>{node.label}</button>)}</div> }));
vi.mock('../components/QuickInspector', () => ({ QuickInspector: (props: any) => props.selection ? <div data-testid="inspector" /> : null }));

const renderMapPage = createMapPageHarness(MapPage);
const mapId = '00000000-0000-4000-8000-000000000010';
const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const variantId = '00000000-0000-4000-8000-000000000011';
const node = (id: string, label: string) => ({ id: `node-${id}`, kind: 'PHYSICAL_OBJECT', label, source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: id }], attributes: {} });
const document = { schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT', nodes: [node(firstId, 'PP1'), node(secondId, 'SW1')], edges: [], gaps: [], warnings: [] } as const;
const savedMap = { map_ref: { entity_type: 'SavedMap' as const, entity_id: mapId }, active_variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, variants: [{ variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, name: 'Основной' }], name: 'Карта', created_at: 'x', updated_at: 'x', placements: [firstId, secondId].map((id, index) => ({ physical_object_ref: { ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id: id }, positions: { 'L1/PHYSICAL_OBJECT': { x: index, y: 0 } } })), cable_routes: [], composites: [], regions: [], text_annotations: [] };
const renderPage = (createComposite = vi.fn(), loadMap = vi.fn().mockResolvedValue(savedMap)) => {
  const maps: any = { listMaps: vi.fn().mockResolvedValue([savedMap]), loadMap, createMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), removePlacement: vi.fn(), createComposite };
  renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`);
  return { maps, createComposite };
};
const begin = async () => { await screen.findByText('PP1'); fireEvent.click(screen.getByRole('button', { name: /Компоновка/ })); fireEvent.click(screen.getByRole('button', { name: 'Создать составной блок' })); };

describe('MapPage composite creation', () => {
  it('keeps only map CRUD and view switches in the top toolbar, and hides utilities for ordinary inspection', async () => {
    renderPage(); await screen.findByText('PP1');
    const toolbar = screen.getByLabelText('Основные элементы карты');
    expect(within(toolbar).getByRole('button', { name: 'Карты' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '+ Новая карта' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Удалить карту' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Логическая' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Физическая' })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: /Компоновка|Соединить порты|Области|составной блок/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Компоновка · Основной' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Инструменты' }));
    expect(screen.getByRole('button', { name: 'Соединить порты' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Области' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PP1' }));
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Служебные инструменты карты' })).not.toBeInTheDocument();
  });

  it('uses a temporary canvas membership selection instead of topology selection', async () => {
    renderPage(); await begin();
    expect(screen.getByText('Выбрано: 0')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/создать composite|название composite|участники composite/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'PP1' }));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-members', JSON.stringify([firstId]));
    expect(screen.queryByTestId('inspector')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PP1' }));
    expect(screen.getByText('Выбрано: 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PP1' })); fireEvent.click(screen.getByRole('button', { name: 'SW1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(screen.getByRole('dialog', { name: 'Создать составной блок' })).toHaveTextContent('В блок войдут выбранные объекты: 2.');
  });

  it('keeps members on Back and clears them on Cancel', async () => {
    renderPage(); await begin();
    fireEvent.click(screen.getByRole('button', { name: 'PP1' })); fireEvent.click(screen.getByRole('button', { name: 'SW1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' })); fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText('Выбрано: 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByText('Выбрано: 2')).not.toBeInTheDocument();
  });

  it('submits trimmed members once and clears the temporary mode on success', async () => {
    let resolve!: (value: any) => void;
    const createComposite = vi.fn(() => new Promise((done) => { resolve = done; }));
    renderPage(createComposite); await begin();
    fireEvent.click(screen.getByRole('button', { name: 'PP1' })); fireEvent.click(screen.getByRole('button', { name: 'SW1' })); fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    fireEvent.change(screen.getByLabelText('Название составного блока'), { target: { value: '  Стойка  ' } });
    const submit = screen.getByRole('button', { name: 'Создать' }); fireEvent.click(submit); fireEvent.click(submit);
    expect(createComposite).toHaveBeenCalledTimes(1);
    expect(createComposite).toHaveBeenCalledWith(mapId, 'Стойка', [firstId, secondId], variantId);
    resolve({ composite_ref: { entity_type: 'MapComposite' as const, entity_id: '00000000-0000-4000-8000-000000000012' }, name: 'Стойка', physical_object_refs: [], presentation: { variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, collapsed: false, x: 0, y: 0, width: 280, height: 180 } });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Создать составной блок' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Создать составной блок' })).toBeInTheDocument();
  });

  it('keeps the dialog and members after a rejected write without exposing diagnostics', async () => {
    const createComposite = vi.fn().mockRejectedValue(new Error('raw backend error'));
    renderPage(createComposite); await begin();
    fireEvent.click(screen.getByRole('button', { name: 'PP1' })); fireEvent.click(screen.getByRole('button', { name: 'SW1' })); fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    fireEvent.change(screen.getByLabelText('Название составного блока'), { target: { value: 'Стойка' } }); fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось создать составной блок.');
    expect(screen.getByLabelText('Название составного блока')).toHaveValue('Стойка');
    expect(screen.queryByText('raw backend error')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText('Выбрано: 2')).toBeInTheDocument();
  });

  it('retries only the authoritative read after an acknowledged composite create', async () => {
    const createComposite = vi.fn().mockResolvedValue({ composite_ref: { entity_type: 'MapComposite' as const, entity_id: '00000000-0000-4000-8000-000000000012' }, name: 'Стойка', physical_object_refs: [], presentation: { variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, collapsed: false, x: 0, y: 0, width: 280, height: 180 } });
    let reads = 0;
    const loadMap = vi.fn(() => ++reads <= 2 ? Promise.resolve(savedMap) : reads === 3 ? Promise.reject(new Error('refresh')) : Promise.resolve(savedMap));
    renderPage(createComposite, loadMap); await begin();
    fireEvent.click(screen.getByRole('button', { name: 'PP1' })); fireEvent.click(screen.getByRole('button', { name: 'SW1' })); fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    fireEvent.change(screen.getByLabelText('Название составного блока'), { target: { value: 'Стойка' } }); fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Составной блок создан, но карту не удалось обновить.');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' }));
    await waitFor(() => expect(reads).toBe(4));
    expect(createComposite).toHaveBeenCalledTimes(1);
  });
});
