import { render, screen } from '@testing-library/react';
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
});
