import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, localeStorageKey } from '../i18n';
import type { ObjectBlueprintDataSource } from '../topology/objectBlueprintTypes';
import { NewInfrastructureObjectPage } from './NewInfrastructureObjectPage';

const dataSource = (loadObjectBlueprints: ObjectBlueprintDataSource['loadObjectBlueprints']): ObjectBlueprintDataSource => ({
  loadObjectBlueprints,
  loadObjectBlueprintVersion: vi.fn(),
  createObjectBlueprint: vi.fn(),
});

describe('NewInfrastructureObjectPage', () => {
  afterEach(() => localStorage.clear());

  it('uses English blueprint-library UI and hides datasource diagnostics', async () => {
    localStorage.setItem(localeStorageKey, 'en');
    render(
      <I18nProvider><MemoryRouter><NewInfrastructureObjectPage objectBlueprintDataSource={dataSource(vi.fn().mockRejectedValue(new Error('backend unavailable')))} /></MemoryRouter></I18nProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load blueprints.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('backend unavailable');
    expect(screen.getByLabelText('Object blueprints')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('Шаблоны объектов')).not.toBeInTheDocument();
  });

  it('renders a dedicated compact picker and opens the dialog for the selected blueprint', async () => {
    const blueprintRef = (entity_id: string) => ({ ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprint' as const, entity_id });
    const versionRef = (entity_id: string) => ({ ref_type: 'LIBRARY_RECORD' as const, entity_type: 'ObjectBlueprintVersion' as const, entity_id });
    render(
      <I18nProvider><MemoryRouter><NewInfrastructureObjectPage objectBlueprintDataSource={dataSource(vi.fn().mockResolvedValue({
        schema_version: '1.0' as const,
        blueprints: [
          { blueprint_ref: blueprintRef('blueprint-1'), version_ref: versionRef('version-1'), name: 'PC-1-ETH', version_number: 1, default_physical_object_class: 'workstation', body: { kind: 'RECTANGLE' as const, width: 120, height: 40 }, slot_count: 1, internal_link_count: 0, version_count: 1 },
          { blueprint_ref: blueprintRef('blueprint-2'), version_ref: versionRef('version-4'), name: 'Switch-24', version_number: 4, default_physical_object_class: 'switch', body: { kind: 'RECTANGLE' as const, width: 240, height: 40 }, slot_count: 24, internal_link_count: 12, version_count: 4 },
        ],
      }))} /></MemoryRouter></I18nProvider>,
    );

    const picker = await screen.findByLabelText('Шаблоны объектов');
    const items = picker.querySelectorAll('.create-blueprint-picker__item');
    expect(items).toHaveLength(2);
    expect(picker.querySelectorAll('.blueprint-card')).toHaveLength(0);
    expect(items[0]).toHaveTextContent('PC-1-ETH');
    expect(items[0]).toHaveTextContent('Версия: v1 · workstation');
    expect(items[0]).toHaveTextContent('Портов: 1 · внутренних связей: 0');
    expect(items[1]).toHaveTextContent('Switch-24');
    expect(items[1]).toHaveTextContent('Версия: v4 · switch');
    expect(items[1]).toHaveTextContent('Портов: 24 · внутренних связей: 12');

    const selectActions = screen.getAllByRole('button', { name: 'Выбрать шаблон' });
    expect(selectActions).toHaveLength(2);
    fireEvent.click(selectActions[1]);
    expect(await screen.findByRole('heading', { name: 'Создать объект из «Switch-24»' })).toBeInTheDocument();
    expect(screen.getByText('Версия: v4')).toBeInTheDocument();
  });
});
