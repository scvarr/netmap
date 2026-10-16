import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import type { HardwareConfiguration, HardwareModuleDataSource } from '../topology/hardwareModules';
import { ModuleInstallationSection } from './ModuleInstallationSection';

const module = { template_id: 'template', revision_id: 'revision', name: 'FC25Gb-2', compatibility: 'OCP3', endpoints: [] };
const free: HardwareConfiguration = { configuration_id: 'config', bays: [{ bay_key: 'bay-key', display_name: 'PCIe1', compatibility: 'OCP3', panel_key: 'back', x: .1, y: .1, width: .3, height: .3, installation: null }] };
const occupied: HardwareConfiguration = { ...free, bays: [{ ...free.bays[0], installation: {
  id: 'stable-installation-id', name: module.name, module_template_id: 'template', module_revision_id: 'revision', orientation: 'HORIZONTAL', endpoints: [{
    key: 'endpoint', kind: 'NETWORK_PORT', installation_id: 'stable-installation-id', panel_key: 'back', panel_display_name: 'Back', bay_key: 'bay-key', bay_display_name: 'PCIe1',
    local_display_name: 'feth1', contextual_display_name: 'Back / PCIe1 / feth1', connection_point_id: 'point', network_interface_id: 'interface', x: .2, y: .2,
  }],
} }] };
const source = (): HardwareModuleDataSource => ({ listModules: vi.fn().mockResolvedValue({ modules: [module] }), loadConfiguration: vi.fn().mockResolvedValue(occupied), createModule: vi.fn(), deleteModule: vi.fn(), installModule: vi.fn().mockResolvedValue(occupied), uninstallModule: vi.fn().mockResolvedValue(free) });
function show(dataSource: HardwareModuleDataSource, onInstalled = vi.fn()) {
  render(<I18nProvider><ModuleInstallationSection objectId="object" dataSource={dataSource} onInstalled={onInstalled} /></I18nProvider>);
  return onInstalled;
}
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('ModuleInstallationSection uninstall', () => {
  it('offers styled removal for an occupied bay and requires a module/bay confirmation', async () => {
    const data = source(); const refresh = show(data);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const remove = await screen.findByRole('button', { name: 'Удалить модуль' });
    expect(remove).toHaveClass('text-action');
    await userEvent.click(remove);
    expect(confirm).toHaveBeenCalledWith('Удалить модуль «FC25Gb-2» из отсека «PCIe1»?');
    expect(data.uninstallModule).not.toHaveBeenCalled();
    expect(screen.getByText('Back / PCIe1 / feth1')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('keeps occupied state until server success, then frees the bay and refreshes the card', async () => {
    const data = source(); let complete!: (value: HardwareConfiguration) => void;
    data.uninstallModule = vi.fn().mockReturnValue(new Promise<HardwareConfiguration>(resolve => { complete = resolve; }));
    const refresh = show(data); vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить модуль' }));
    expect(data.uninstallModule).toHaveBeenCalledWith('object', 'stable-installation-id');
    expect(screen.getByText('Back / PCIe1 / feth1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить модуль' })).toBeDisabled();
    expect(screen.queryByLabelText('Выберите совместимый модуль')).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    complete(free);
    expect(await screen.findByText('OCP3 · Свободен')).toBeInTheDocument();
    expect(screen.queryByText('Back / PCIe1 / feth1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить модуль' })).not.toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await userEvent.selectOptions(screen.getByLabelText('Выберите совместимый модуль'), 'template');
    await userEvent.click(screen.getByRole('button', { name: 'Установить модуль' }));
    expect(data.installModule).toHaveBeenCalledWith('object', { bay_key: 'bay-key', module_template_id: 'template', orientation: 'HORIZONTAL' });
    expect(await screen.findByText('Back / PCIe1 / feth1')).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });
  it('keeps installation and endpoints visible after a domain refusal', async () => {
    const data = source(); data.uninstallModule = vi.fn().mockRejectedValue(new Error('ModuleInstallation endpoints are in use (409)'));
    const refresh = show(data); vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить модуль' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ModuleInstallation endpoints are in use (409)');
    expect(screen.getByText('OCP3 · Занят: FC25Gb-2')).toBeInTheDocument();
    expect(screen.getByText('Back / PCIe1 / feth1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить модуль' })).toBeEnabled();
    expect(screen.queryByLabelText('Выберите совместимый модуль')).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('never offers uninstall for a free bay', async () => {
    const data = source(); data.loadConfiguration = vi.fn().mockResolvedValue(free); show(data);
    expect(await screen.findByText('OCP3 · Свободен')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить модуль' })).not.toBeInTheDocument();
  });
});
