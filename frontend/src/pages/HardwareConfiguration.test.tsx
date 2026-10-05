import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '../i18n';
import { BaseTemplateLibraryPage } from './BaseTemplateLibraryPage';
import { NewInfrastructureObjectPage } from './NewInfrastructureObjectPage';
import { NewModuleTemplatePage } from './NewModuleTemplatePage';
import { NewBaseTemplatePage } from './NewBaseTemplatePage';
import { ModuleInstallationSection } from '../components/ModuleInstallationSection';
import type { BaseTemplateDataSource } from '../topology/baseTemplateTypes';
import type { HardwareModuleDataSource, HardwareConfiguration } from '../topology/hardwareModules';

const ref = (entity_type: 'BaseTemplate' | 'BaseTemplateRevision', entity_id: string) => ({ ref_type: 'LIBRARY_RECORD' as const, entity_type, entity_id });
const base = { blueprint_ref: ref('BaseTemplate', 'base'), version_ref: ref('BaseTemplateRevision', 'rev'), name: 'Server base', version_number: 1, version_count: 1, slot_count: 1, internal_link_count: 0, body: { kind: 'RECTANGLE' as const, width: 160, height: 60 } };
const panel = { panel_key: 'panel', panel_number: 1, display_name: 'Panel', x: 0, y: 0, width: 160, height: 60 };
const module = { template_id: 'module', revision_id: 'module-rev', name: 'OCP NIC', compatibility: 'OCP3', endpoints: [{ key: 'p1', display_name: 'P1', kind: 'NETWORK_PORT' as const }, { key: 'p2', display_name: 'P2', kind: 'NETWORK_PORT' as const }] };
const config: HardwareConfiguration = { configuration_id: 'config', bays: [{ bay_key: 'bay', display_name: 'OCP bay', compatibility: 'OCP3', panel_key: 'panel', x: .1, y: .1, width: .8, height: .8, installation: null }] };
const bases = (): BaseTemplateDataSource => ({ loadBaseTemplates: vi.fn().mockResolvedValue({ schema_version: '2.0', blueprints: [base] }), loadBaseTemplateRevision: vi.fn().mockResolvedValue({ ...base, schema_version: '2.0', next_panel_number: 2, panels: [panel], slots: [], internal_links: [], bays: config.bays }), createBaseTemplate: vi.fn().mockResolvedValue({ schema_version: '2.0', blueprint_ref: base.blueprint_ref, version_ref: base.version_ref }), createPhysicalObject: vi.fn().mockResolvedValue({ physical_object_ref: { entity_id: 'object' } }) });
const modules = (): HardwareModuleDataSource => ({ listModules: vi.fn().mockResolvedValue({ modules: [module, { ...module, template_id: 'wrong', name: 'Other NIC', compatibility: 'ocp3' }] }), createModule: vi.fn().mockResolvedValue(module), loadConfiguration: vi.fn().mockResolvedValue(config), installModule: vi.fn().mockResolvedValue({ ...config, bays: [{ ...config.bays[0], installation: { id: 'installation', name: module.name, orientation: 'VERTICAL', module_template_id: module.template_id, module_revision_id: module.revision_id, endpoints: [] } }] }) });
function show(element: React.ReactNode) { return render(<I18nProvider><MemoryRouter><Routes><Route path="/" element={element} /><Route path="/infrastructure/objects/object" element={<h1>Created object</h1>} /><Route path="/library/base-templates" element={<h1>Saved library</h1>} /></Routes></MemoryRouter></I18nProvider>); }
beforeEach(() => localStorage.clear());

describe('09.6-A user path', () => {
  it('uses server-derived contextual names in the installed module endpoint list', async () => {
    const source = modules();
    source.loadConfiguration = vi.fn().mockResolvedValue({ ...config, bays: [1, 2].map(index => ({
      ...config.bays[0], bay_key: `bay-${index}`, display_name: `PCIe${index}`,
      installation: { id: `installation-${index}`, module_template_id: 'module', module_revision_id: 'module-rev', name: 'NIC', orientation: 'HORIZONTAL', endpoints: [1, 2].map(port => ({ key: `p${port}`, kind: 'NETWORK_PORT', local_display_name: `feth${port}`, contextual_display_name: `Back / PCIe${index} / feth${port}`, connection_point_id: `point-${index}-${port}`, network_interface_id: `ni-${index}-${port}`, x: .3, y: .5 })) },
    })) });
    show(<ModuleInstallationSection objectId="object" dataSource={source} onInstalled={vi.fn()} />);
    for (const index of [1, 2]) for (const port of [1, 2]) expect(await screen.findByText(`Back / PCIe${index} / feth${port}`)).toBeInTheDocument();
    expect(screen.queryByText('feth1')).not.toBeInTheDocument();
  });
  it('shows separate base and module roles with both creation actions and no published editing', async () => {
    show(<BaseTemplateLibraryPage dataSource={bases()} moduleDataSource={modules()} />);
    expect(await screen.findByRole('rowheader', { name: 'Server base' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'OCP NIC' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Создать базовый шаблон' })).toHaveAttribute('href', '/library/base-templates/new');
    expect(screen.getByRole('link', { name: 'Создать шаблон модуля' })).toHaveAttribute('href', '/library/module-templates/new');
    expect(screen.queryByRole('link', { name: 'Редактировать' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Создать шаблон модуля' })).toHaveClass('secondary-action');
    expect(screen.getByRole('link', { name: 'Создать объект' })).toHaveClass('secondary-action');
  });
  it('creates an object using only the root base selection and navigates to its card', async () => {
    const source = bases(); show(<NewInfrastructureObjectPage baseTemplateDataSource={source} />);
    await screen.findByRole('rowheader', { name: 'Server base' });
    expect(screen.queryByRole('button', { name: 'Создать вручную' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать шаблон' }));
    await userEvent.type(screen.getByLabelText('Имя экземпляра'), 'Server');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(source.createPhysicalObject).toHaveBeenCalledWith('base', { display_name: 'Server' });
    expect(await screen.findByRole('heading', { name: 'Created object' })).toBeInTheDocument();
  });
  it('creates module definitions in their displayed order with opaque keys', async () => {
    const source = modules(); show(<NewModuleTemplatePage dataSource={source} />);
    await userEvent.type(screen.getByLabelText('Название'), 'NIC');
    await userEvent.type(screen.getByLabelText('Совместимость'), 'OCP3');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить конечную точку' }));
    await userEvent.click(screen.getByRole('button', { name: 'Добавить конечную точку' }));
    expect(screen.getByLabelText('Совместимость').closest('form')).toHaveClass('blueprint-editor-controls');
    expect(screen.getByRole('button', { name: 'Добавить конечную точку' })).toHaveClass('secondary-action');
    expect(screen.getByRole('button', { name: 'Создать шаблон' })).toHaveClass('primary-action');
    const fields = screen.getAllByRole('group');
    await userEvent.type(within(fields[0]).getByLabelText('Название'), 'P1');
    await userEvent.type(within(fields[1]).getByLabelText('Название'), 'P2');
    await userEvent.click(screen.getByRole('button', { name: 'Создать шаблон' }));
    expect(source.createModule).toHaveBeenCalledWith({ name: 'NIC', compatibility: 'OCP3', endpoints: [{ key: expect.any(String), display_name: 'P1', kind: 'NETWORK_PORT' }, { key: expect.any(String), display_name: 'P2', kind: 'NETWORK_PORT' }] });
    expect(await screen.findByRole('heading', { name: 'Saved library' })).toBeInTheDocument();
  });
  it('installs only an exactly compatible module, sends orientation, and refreshes physical details', async () => {
    const source = modules(); const refresh = vi.fn(); show(<ModuleInstallationSection objectId="object" dataSource={source} onInstalled={refresh} />);
    expect(await screen.findByText('OCP3 · Свободен')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Other NIC' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ориентация').closest('.blueprint-editor-controls')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Установить модуль' })).toHaveClass('primary-action');
    await userEvent.selectOptions(screen.getByLabelText('Выберите совместимый модуль'), 'module');
    await userEvent.selectOptions(screen.getByLabelText('Ориентация'), 'VERTICAL');
    await userEvent.click(screen.getByRole('button', { name: 'Установить модуль' }));
    await waitFor(() => expect(source.installModule).toHaveBeenCalledWith('object', { module_template_id: 'module', bay_key: 'bay', orientation: 'VERTICAL' }));
    expect(await screen.findByText('OCP3 · Занят: OCP NIC')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Установить модуль' })).not.toBeInTheDocument();
  });
  it('edits bay numeric geometry and saves it with the existing panel model', async () => {
    const source = bases(); show(<NewBaseTemplatePage dataSource={source} />);
    await userEvent.type(screen.getByLabelText('Название шаблона'), 'Server base');
    await userEvent.click(screen.getByRole('button', { name: 'Добавить отсек' }));
    const bay = screen.getByRole('region', { name: 'Отсеки модулей' });
    await userEvent.clear(within(bay).getByLabelText('Название')); await userEvent.type(within(bay).getByLabelText('Название'), 'OCP bay');
    await userEvent.type(within(bay).getByLabelText('Совместимость'), 'OCP3');
    await userEvent.clear(within(bay).getByLabelText('x')); await userEvent.type(within(bay).getByLabelText('x'), '0.2');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить шаблон' }));
    await waitFor(() => expect(source.createBaseTemplate).toHaveBeenCalledWith(expect.objectContaining({ bays: [expect.objectContaining({ bay_key: expect.any(String), display_name: 'OCP bay', compatibility: 'OCP3', x: .2, width: .3 })] })));
  });
});
