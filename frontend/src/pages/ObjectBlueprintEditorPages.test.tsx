import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import type { ObjectBlueprintVersionDocument } from '../topology/objectBlueprintTypes';
import { EditObjectBlueprintPage } from './EditObjectBlueprintPage';
import { NewObjectBlueprintPage } from './NewObjectBlueprintPage';

const version: ObjectBlueprintVersionDocument = {
  schema_version: '2.0',
  blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprint', entity_id: 'bp' },
  version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'ObjectBlueprintVersion', entity_id: 'v1' },
  version_number: 1, next_panel_number: 2, name: 'Device',
  body: { kind: 'RECTANGLE', width: 160, height: 60 },
  panels: [{ panel_key: 'panel-1', panel_number: 1, display_name: 'Панель 1', x: 0, y: 0, width: 160, height: 60 }],
  slots: [], internal_links: [],
};

describe('Blueprint authoring page shell', () => {
  const dataSource = {
    loadObjectBlueprints: vi.fn(), createObjectBlueprint: vi.fn(),
    loadObjectBlueprintVersion: vi.fn().mockResolvedValue(version),
  };

  it('uses the editor-specific shell on create', () => {
    const { container } = render(<I18nProvider><MemoryRouter><NewObjectBlueprintPage dataSource={dataSource} /></MemoryRouter></I18nProvider>);
    expect(container.querySelector('main.page-shell.blueprint-editor-page')).toBeInTheDocument();
    expect(container.querySelector('.blueprint-composer--authoring-workspace .blueprint-composer__workspace')).toBeInTheDocument();
  });

  it('uses the same shell on edit after loading the authoring canvas', async () => {
    const { container } = render(<I18nProvider><MemoryRouter initialEntries={['/library/object-blueprints/bp/versions/v1/edit']}>
      <Routes><Route path="/library/object-blueprints/:blueprintId/versions/:versionId/edit" element={<EditObjectBlueprintPage dataSource={dataSource} />} /></Routes>
    </MemoryRouter></I18nProvider>);
    await screen.findByRole('img', { name: 'Предпросмотр схемы' });
    expect(container.querySelector('main.page-shell.blueprint-editor-page')).toBeInTheDocument();
    expect(container.querySelector('.blueprint-composer--authoring-workspace .blueprint-composer__workspace')).toBeInTheDocument();
  });
});
