import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MapPage } from './MapPage';
import { createMapPageHarness } from './MapPage.testHarness';

vi.mock('../components/TopologyCanvas', () => ({ TopologyCanvas: (props: any) => <div data-testid="canvas" data-members={JSON.stringify([...props.compositeMemberSelection?.selectedPhysicalObjectIds ?? []])}>{props.document.nodes.map((node: any) => <button key={node.id} type="button" onClick={() => props.compositeMemberSelection ? props.compositeMemberSelection.onPhysicalObjectClick(node.source_refs[0].entity_id) : props.onSelectionChange({ type: 'node', item: node })}>{node.label}</button>)}{props.compositeInputs?.filter((item: any) => item.collapsed).map((item: any) => <button key={`drag-${item.id}`} type="button" onClick={() => props.onCompositeDragStop(item.id, { x: 44, y: 55, width: 600, height: 240 })}>drag composite {item.id}</button>)}</div> }));
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
  it('shows existing composites by name and member count without exposing their UUIDs', async () => {
    const compositeId = '00000000-0000-4000-8000-000000000099';
    const populated = { ...savedMap, composites: [{ composite_ref: { entity_type: 'MapComposite' as const, entity_id: compositeId }, name: 'Стойка A', physical_object_refs: [savedMap.placements[0].physical_object_ref, savedMap.placements[1].physical_object_ref], presentation: { variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, collapsed: false, x: 0, y: 0, width: 280, height: 180 } }] };
    const maps: any = { listMaps: vi.fn().mockResolvedValue([populated]), loadMap: vi.fn().mockResolvedValue(populated), createMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), removePlacement: vi.fn(), createComposite: vi.fn(), deleteComposite: vi.fn() };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`);
    await screen.findByText('PP1'); fireEvent.click(screen.getByRole('button', { name: /Компоновка/ }));
    expect(screen.getByText('Стойка A')).toBeInTheDocument();
    expect(screen.getByText('2 объекта')).toBeInTheDocument();
    expect(screen.queryByText(compositeId)).not.toBeInTheDocument();
  });

  it('shows a bounded empty composite state', async () => {
    renderPage(); await screen.findByText('PP1'); fireEvent.click(screen.getByRole('button', { name: /Компоновка/ }));
    expect(screen.getByText('Составных блоков пока нет.')).toBeInTheDocument();
  });

  it('writes individual collapse for the active variant and refreshes authoritative state', async () => {
    const compositeId = '00000000-0000-4000-8000-000000000099';
    const composite = { composite_ref: { entity_type: 'MapComposite' as const, entity_id: compositeId }, name: 'Стойка A', physical_object_refs: [savedMap.placements[0].physical_object_ref, savedMap.placements[1].physical_object_ref], presentation: { variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, collapsed: false, x: 0, y: 0, width: 280, height: 180, geometry_persisted: false } };
    const populated = { ...savedMap, composites: [composite] };
    const setCompositePresentation = vi.fn().mockResolvedValue(undefined);
    const loadMap = vi.fn().mockResolvedValue(populated);
    const maps: any = { listMaps: vi.fn().mockResolvedValue([populated]), loadMap, createMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), removePlacement: vi.fn(), setCompositePresentation };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`);
    await screen.findByText('PP1'); fireEvent.click(screen.getByRole('button', { name: /Компоновка/ }));
    fireEvent.click(within(screen.getByText('Стойка A').parentElement!.parentElement!).getByRole('button', { name: 'Свернуть' }));
    await waitFor(() => expect(setCompositePresentation).toHaveBeenCalledWith(mapId, compositeId, variantId, { collapsed: true, x: -33.5, y: -18, width: 280, height: 180 }));
    await waitFor(() => expect(loadMap).toHaveBeenLastCalledWith(mapId, variantId));
  });

  it('persists only effective composite geometry after a collapsed frame drag', async () => {
    const compositeId = '00000000-0000-4000-8000-000000000099';
    const populated = { ...savedMap, composites: [{ composite_ref: { entity_type: 'MapComposite' as const, entity_id: compositeId }, name: 'Стойка A', physical_object_refs: [savedMap.placements[0].physical_object_ref], presentation: { variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, collapsed: true, x: 10, y: 20, width: 280, height: 180, geometry_persisted: true } }] };
    const setCompositePresentation = vi.fn().mockResolvedValue(undefined);
    const movePosition = vi.fn();
    const maps: any = { listMaps: vi.fn().mockResolvedValue([populated]), loadMap: vi.fn().mockResolvedValue(populated), createMap: vi.fn(), addPlacement: vi.fn(), movePosition, removePlacement: vi.fn(), setCompositePresentation };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`);

    fireEvent.click(await screen.findByRole('button', { name: `drag composite ${compositeId}` }));
    await waitFor(() => expect(setCompositePresentation).toHaveBeenCalledWith(mapId, compositeId, variantId, { collapsed: true, x: 44, y: 55, width: 600, height: 240 }));
    expect(movePosition).not.toHaveBeenCalled();
  });

  it('centres first collapse on actual Blueprint member rectangles with their saved display widths', async () => {
    const compositeId = '00000000-0000-4000-8000-000000000099';
    const blueprint = (width: number) => ({ blueprint_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint', entity_id: `bp-${width}` }, version_ref: { ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion', entity_id: `version-${width}` }, body: { kind: 'RECTANGLE' as const, width: 100, height: 50 }, slots: [{ slot_key: 'port', display_name: 'Port', kind: 'CONNECTION_POINT' as const, connection_point_id: `port-${width}`, rendered_position: { x: .5, y: .5 }, external_attachment: { x: .5, y: 0, side: 'TOP' as const } }] });
    const blueprintDocument: any = { ...document, nodes: [{ ...document.nodes[0], attributes: { blueprint_presentation: blueprint(120) } }, { ...document.nodes[1], attributes: { blueprint_presentation: blueprint(300) } }] };
    const placements = [
      { ...savedMap.placements[0], positions: { 'L1/PHYSICAL_OBJECT': { x: 100, y: 200, display_width: 120 } } },
      { ...savedMap.placements[1], positions: { 'L1/PHYSICAL_OBJECT': { x: 500, y: 600, display_width: 300 } } },
    ];
    const populated: any = { ...savedMap, placements, composites: [{ composite_ref: { entity_type: 'MapComposite', entity_id: compositeId }, name: 'Стойка A', physical_object_refs: placements.map((item: any) => item.physical_object_ref), presentation: { variant_ref: { entity_type: 'MapPresentationVariant', entity_id: variantId }, collapsed: false, x: 0, y: 0, width: 280, height: 180, geometry_persisted: false } }] };
    const setCompositePresentation = vi.fn().mockResolvedValue(undefined); const maps: any = { listMaps: vi.fn().mockResolvedValue([populated]), loadMap: vi.fn().mockResolvedValue(populated), createMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), removePlacement: vi.fn(), setCompositePresentation };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(blueprintDocument) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`);
    await screen.findByText('PP1'); fireEvent.click(screen.getByRole('button', { name: /Компоновка/ })); fireEvent.click(within(screen.getByText('Стойка A').parentElement!.parentElement!).getByRole('button', { name: 'Свернуть' }));
    await waitFor(() => expect(setCompositePresentation).toHaveBeenCalledWith(mapId, compositeId, variantId, { collapsed: true, x: 310, y: 385, width: 280, height: 180 }));
  });

  it('keeps confirmed state after rejected individual presentation write', async () => {
    const compositeId = '00000000-0000-4000-8000-000000000099'; const populated = { ...savedMap, composites: [{ composite_ref: { entity_type: 'MapComposite' as const, entity_id: compositeId }, name: 'Стойка A', physical_object_refs: [savedMap.placements[0].physical_object_ref], presentation: { variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, collapsed: false, x: 10, y: 20, width: 280, height: 180, geometry_persisted: true } }] }; const maps: any = { listMaps: vi.fn().mockResolvedValue([populated]), loadMap: vi.fn().mockResolvedValue(populated), createMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), removePlacement: vi.fn(), setCompositePresentation: vi.fn().mockRejectedValue(new Error('fail')) };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`); await screen.findByText('PP1'); fireEvent.click(screen.getByRole('button', { name: /Компоновка/ })); fireEvent.click(within(screen.getByText('Стойка A').parentElement!.parentElement!).getByRole('button', { name: 'Свернуть' })); expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось изменить состояние составного блока.'); expect(screen.getByRole('button', { name: 'Свернуть' })).toBeInTheDocument();
  });

  it('cancels composite deletion without sending DELETE', async () => {
    const compositeId = '00000000-0000-4000-8000-000000000099'; const populated = { ...savedMap, composites: [{ composite_ref: { entity_type: 'MapComposite' as const, entity_id: compositeId }, name: 'Стойка A', physical_object_refs: [savedMap.placements[0].physical_object_ref], presentation: { variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, collapsed: false, x: 0, y: 0, width: 280, height: 180 } }] }; const deleteComposite = vi.fn(); const maps: any = { listMaps: vi.fn().mockResolvedValue([populated]), loadMap: vi.fn().mockResolvedValue(populated), createMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), removePlacement: vi.fn(), deleteComposite };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`); await screen.findByText('PP1'); fireEvent.click(screen.getByRole('button', { name: /Компоновка/ })); fireEvent.click(within(screen.getByText('Стойка A').parentElement!.parentElement!).getByRole('button', { name: 'Удалить' })); const dialog = screen.getByRole('dialog', { name: 'Удалить составной блок' }); expect(dialog).toHaveTextContent('Удалить составной блок «Стойка A»?'); fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' })); expect(deleteComposite).not.toHaveBeenCalled();
  });

  it('deletes a composite once, reloads the active variant, and removes it from the panel', async () => {
    const compositeId = '00000000-0000-4000-8000-000000000099'; const populated = { ...savedMap, composites: [{ composite_ref: { entity_type: 'MapComposite' as const, entity_id: compositeId }, name: 'Стойка A', physical_object_refs: [savedMap.placements[0].physical_object_ref], presentation: { variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, collapsed: false, x: 0, y: 0, width: 280, height: 180 } }] }; const deleteComposite = vi.fn().mockResolvedValue(undefined); const loadMap = vi.fn().mockResolvedValue(populated); const maps: any = { listMaps: vi.fn().mockResolvedValue([populated]), loadMap, createMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), removePlacement: vi.fn(), deleteComposite };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`); await screen.findByText('PP1'); fireEvent.click(screen.getByRole('button', { name: /Компоновка/ })); fireEvent.click(within(screen.getByText('Стойка A').parentElement!.parentElement!).getByRole('button', { name: 'Удалить' })); loadMap.mockResolvedValue(savedMap); fireEvent.click(within(screen.getByRole('dialog', { name: 'Удалить составной блок' })).getByRole('button', { name: 'Удалить' })); await waitFor(() => expect(deleteComposite).toHaveBeenCalledWith(mapId, compositeId)); await waitFor(() => expect(loadMap).toHaveBeenLastCalledWith(mapId, variantId)); expect(deleteComposite).toHaveBeenCalledTimes(1); expect(screen.getByText('Составных блоков пока нет.')).toBeInTheDocument();
  });

  it('keeps the dialog with bounded feedback after a rejected composite delete', async () => {
    const compositeId = '00000000-0000-4000-8000-000000000099'; const populated = { ...savedMap, composites: [{ composite_ref: { entity_type: 'MapComposite' as const, entity_id: compositeId }, name: 'Стойка A', physical_object_refs: [savedMap.placements[0].physical_object_ref], presentation: { variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, collapsed: false, x: 0, y: 0, width: 280, height: 180 } }] }; const maps: any = { listMaps: vi.fn().mockResolvedValue([populated]), loadMap: vi.fn().mockResolvedValue(populated), createMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), removePlacement: vi.fn(), deleteComposite: vi.fn().mockRejectedValue(new Error('raw delete failure')) };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`); await screen.findByText('PP1'); fireEvent.click(screen.getByRole('button', { name: /Компоновка/ })); fireEvent.click(within(screen.getByText('Стойка A').parentElement!.parentElement!).getByRole('button', { name: 'Удалить' })); fireEvent.click(within(screen.getByRole('dialog', { name: 'Удалить составной блок' })).getByRole('button', { name: 'Удалить' })); expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось удалить составной блок.'); expect(screen.queryByText('raw delete failure')).not.toBeInTheDocument();
  });

  it('retries only the active-variant read after acknowledged composite deletion', async () => {
    const compositeId = '00000000-0000-4000-8000-000000000099'; const populated = { ...savedMap, composites: [{ composite_ref: { entity_type: 'MapComposite' as const, entity_id: compositeId }, name: 'Стойка A', physical_object_refs: [savedMap.placements[0].physical_object_ref], presentation: { variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, collapsed: false, x: 0, y: 0, width: 280, height: 180 } }] }; const deleteComposite = vi.fn().mockResolvedValue(undefined); let reads = 0; const loadMap = vi.fn((_: string, variant?: string) => variant === variantId && ++reads === 1 ? Promise.reject(new Error('refresh')) : Promise.resolve(populated)); const maps: any = { listMaps: vi.fn().mockResolvedValue([populated]), loadMap, createMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), removePlacement: vi.fn(), deleteComposite };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`); await screen.findByText('PP1'); fireEvent.click(screen.getByRole('button', { name: /Компоновка/ })); fireEvent.click(within(screen.getByText('Стойка A').parentElement!.parentElement!).getByRole('button', { name: 'Удалить' })); fireEvent.click(within(screen.getByRole('dialog', { name: 'Удалить составной блок' })).getByRole('button', { name: 'Удалить' })); expect(await screen.findByRole('alert')).toHaveTextContent('Составной блок удалён, но карту не удалось обновить.'); fireEvent.click(screen.getByRole('button', { name: 'Повторить обновление' })); await waitFor(() => expect(reads).toBe(2)); expect(deleteComposite).toHaveBeenCalledTimes(1);
  });

  it('blocks existing composite members while retaining selection mode', async () => {
    const compositeId = '00000000-0000-4000-8000-000000000099'; const populated = { ...savedMap, composites: [{ composite_ref: { entity_type: 'MapComposite' as const, entity_id: compositeId }, name: 'Стойка A', physical_object_refs: [savedMap.placements[0].physical_object_ref], presentation: { variant_ref: { entity_type: 'MapPresentationVariant' as const, entity_id: variantId }, collapsed: false, x: 0, y: 0, width: 280, height: 180 } }] }; const createComposite = vi.fn(); const maps: any = { listMaps: vi.fn().mockResolvedValue([populated]), loadMap: vi.fn().mockResolvedValue(populated), createMap: vi.fn(), addPlacement: vi.fn(), movePosition: vi.fn(), removePlacement: vi.fn(), createComposite };
    renderMapPage({ dataSource: { loadProjection: vi.fn().mockResolvedValue(document) }, savedMapDataSource: maps }, `/map?map=${mapId}&view=physical`); await begin(); fireEvent.click(screen.getByRole('button', { name: 'PP1' })); expect(screen.getByRole('alert')).toHaveTextContent('составной блок «Стойка A»'); expect(screen.getByText('Выбрано: 0')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'SW1' })); expect(screen.getByText('Выбрано: 1')).toBeInTheDocument(); expect(createComposite).not.toHaveBeenCalled();
  });
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

  it('cancels membership selection with Escape and restores ordinary node selection', async () => {
    renderPage(); await begin();
    fireEvent.click(screen.getByRole('button', { name: 'PP1' }));
    expect(screen.getByText('Выбрано: 1')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/Выбрано:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PP1' }));
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
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
