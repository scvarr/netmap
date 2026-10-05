import type { BlueprintSlotKind } from './baseTemplateTypes';

export interface ModuleBay {
  bay_key: string; display_name: string; compatibility: string; panel_key: string;
  x: number; y: number; width: number; height: number;
}
export interface ModuleEndpoint { key: string; display_name: string; kind: BlueprintSlotKind }
export interface ModuleTemplateInput { name: string; compatibility: string; endpoints: ModuleEndpoint[] }
export interface ModuleTemplate extends ModuleTemplateInput { template_id: string; revision_id: string }
export interface ModuleInstallation {
  id: string; module_template_id: string; module_revision_id: string; name: string;
  orientation: 'HORIZONTAL' | 'VERTICAL';
  endpoints: Array<Omit<ModuleEndpoint, 'display_name'> & {
    installation_id: string; panel_key: string; panel_display_name: string;
    bay_key: string; bay_display_name: string;
    local_display_name: string; contextual_display_name: string;
    connection_point_id: string; network_interface_id: string | null; x: number; y: number;
  }>;
}
export interface HardwareConfiguration { configuration_id: string | null; bays: Array<ModuleBay & { installation: ModuleInstallation | null }> }
export interface HardwareModuleDataSource {
  listModules(): Promise<{ modules: ModuleTemplate[] }>;
  createModule(input: ModuleTemplateInput): Promise<ModuleTemplate>;
  loadConfiguration(objectId: string): Promise<HardwareConfiguration>;
  installModule(objectId: string, input: { module_template_id: string; bay_key: string; orientation: 'HORIZONTAL' | 'VERTICAL' }): Promise<HardwareConfiguration>;
}
async function request<T>(url: string, input?: unknown): Promise<T> {
  const response = await fetch(url, input === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const document = await response.json();
  if (!response.ok) throw new Error(document.error?.message ?? `HTTP ${response.status}`);
  return document as T;
}
export const hardwareModuleDataSource: HardwareModuleDataSource = {
  listModules: () => request('/api/v1/library/module-templates'),
  createModule: input => request('/api/v1/library/module-templates', input),
  loadConfiguration: id => request(`/api/v1/topology/physical-objects/${encodeURIComponent(id)}/configuration`),
  installModule: (id, input) => request(`/api/v1/topology/physical-objects/${encodeURIComponent(id)}/module-installations`, input),
};
