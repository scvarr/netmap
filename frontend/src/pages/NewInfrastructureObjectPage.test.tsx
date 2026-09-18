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

  it('renders a compact blueprint table and opens the dialog for the selected blueprint', async () => {
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

    const table = await screen.findByRole('table');
    expect(screen.getByRole('columnheader', { name: 'Название' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Тип объекта' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Текущая версия' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Порты' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Внутренние связи' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Действия' })).toBeInTheDocument();
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(document.querySelector('.create-blueprint-picker')).not.toBeInTheDocument();
    expect(document.querySelector('.create-blueprint-picker__item')).not.toBeInTheDocument();
    expect(table.querySelectorAll('.blueprint-card')).toHaveLength(0);
    const rows = table.querySelectorAll('tbody tr');
    expect([...rows[0].querySelectorAll('th, td')].slice(0, 5).map((cell) => cell.textContent)).toEqual(['PC-1-ETH', 'workstation', 'v1', '1', '0']);
    expect([...rows[1].querySelectorAll('th, td')].slice(0, 5).map((cell) => cell.textContent)).toEqual(['Switch-24', 'switch', 'v4', '24', '12']);

    const selectActions = screen.getAllByRole('button', { name: 'Выбрать шаблон' });
    expect(selectActions).toHaveLength(2);
    fireEvent.click(selectActions[1]);
    expect(await screen.findByRole('heading', { name: 'Создать объект из «Switch-24»' })).toBeInTheDocument();
    expect(screen.getByText('Версия: v4')).toBeInTheDocument();
  });
});
