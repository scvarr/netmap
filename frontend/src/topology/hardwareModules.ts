import type { BlueprintSlotKind, TemplateImpactReason } from './baseTemplateTypes';

export interface ModuleBay {
  bay_key: string; display_name: string; compatibility: string; panel_key: string;
  x: number; y: number; width: number; height: number;
}
export interface ModuleEndpoint { key: string; display_name: string; kind: BlueprintSlotKind }
export interface ModuleGeometry { width: number; height: number; fill_color: string; endpoints: Record<string, { x: number; y: number }> }
export const initialModuleGeometry = (): ModuleGeometry => ({ width: 240, height: 80, fill_color: "#64748b", endpoints: {} });
export interface ModuleTemplateInput { geometry: ModuleGeometry; name: string; compatibility: string; endpoints: ModuleEndpoint[] }
export interface ModuleTemplate extends ModuleTemplateInput { template_id: string; revision_id: string; publication_state?: ModuleDraftDocument["publication_state"] }
export interface ModuleDraftDocument {
  template_id: string; source_revision_id: string; generation: number; definition: ModuleTemplateInput;
  publication_state?: { revision_id: string; version_number: number; outdated_count: number; awaiting_update_count: number; requires_intervention_count: number; installations: NonNullable<ModuleDraftDocument["review"]>["result"]["installations"] };
  review: null | {
    published_revision_id?: string | null; candidate_id: string; draft_generation: number; definition: ModuleTemplateInput; current: boolean; created_at: string;
    result: { changes: ModuleStructuralChange[]; installations: Array<{
      installation_id: string; physical_object_id: string; display_name: string; source_revision_id: string; bay_key: string;
      classification: 'potentially_safe' | 'requires_intervention'; reasons: TemplateImpactReason[]; changes: ModuleStructuralChange[];
    }> };
  };
}
export interface ModuleStructuralChange {
  section: 'properties' | 'endpoints' | 'geometry'; key: string; operation: 'added' | 'removed' | 'changed';
  before: ModuleGeometry | string | (ModuleEndpoint & { order_index: number }) | null;
  after: ModuleGeometry | string | (ModuleEndpoint & { order_index: number }) | null;
}
export interface ModuleReconciliationResult {
  revision_id: string; version_number: number;
  installations: Array<{ installation_id: string; physical_object_id?: string; display_name?: string | null; bay_key?: string; source_revision_id?: string; context_at_batch_start?: boolean; status: 'updated' | 'already_current' | 'requires_intervention'; reasons: TemplateImpactReason[] }>;
}
export interface ModuleReviewDataSource {
  reconcileInstallations?(id: string): Promise<ModuleReconciliationResult>;
  publishCandidate(id: string, candidateId: string): Promise<{ revision_id: string; version_number: number }>;
  loadDraft(id: string): Promise<ModuleDraftDocument>;
  saveDraft(id: string, definition: ModuleTemplateInput, generation: number): Promise<ModuleDraftDocument>;
  checkDraft(id: string, generation: number): Promise<ModuleDraftDocument>;
}
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
  deleteModule(templateId: string): Promise<void>;
  uninstallModule(objectId: string, installationId: string): Promise<HardwareConfiguration>;
  loadConfiguration(objectId: string): Promise<HardwareConfiguration>;
  installModule(objectId: string, input: { module_template_id: string; bay_key: string; orientation: 'HORIZONTAL' | 'VERTICAL' }): Promise<HardwareConfiguration>;
}
async function request<T>(url: string, input?: unknown, method: 'GET' | 'POST' | 'DELETE' | 'PUT' = input === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(url, { method, ...(input === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }) });
  if (response.status === 204) return undefined as T;
  const document = await response.json();
  if (!response.ok) throw new Error(document.error?.message ?? `HTTP ${response.status}`);
  return document as T;
}
export const hardwareModuleDataSource: HardwareModuleDataSource = {
  listModules: () => request('/api/v1/library/module-templates'),
  createModule: input => request('/api/v1/library/module-templates', input),
  deleteModule: id => request(`/api/v1/library/module-templates/${encodeURIComponent(id)}`, undefined, 'DELETE'),
  uninstallModule: (id, installationId) => request(`/api/v1/topology/physical-objects/${encodeURIComponent(id)}/module-installations/${encodeURIComponent(installationId)}`, undefined, 'DELETE'),
  loadConfiguration: id => request(`/api/v1/topology/physical-objects/${encodeURIComponent(id)}/configuration`),
  installModule: (id, input) => request(`/api/v1/topology/physical-objects/${encodeURIComponent(id)}/module-installations`, input),
};
export const moduleReviewDataSource: ModuleReviewDataSource = {
  reconcileInstallations: id => request('/api/v1/library/module-templates/' + encodeURIComponent(id) + '/reconcile', undefined, 'POST'),
  publishCandidate: (id, candidate) => request(`/api/v1/library/module-templates/${encodeURIComponent(id)}/candidates/${encodeURIComponent(candidate)}/publish`, undefined, "POST"),
  loadDraft: id => request(`/api/v1/library/module-templates/${encodeURIComponent(id)}/draft`),
  saveDraft: (id, input, generation) => request(`/api/v1/library/module-templates/${encodeURIComponent(id)}/draft?expected_generation=${generation}`, input, 'PUT'),
  checkDraft: (id, generation) => request(`/api/v1/library/module-templates/${encodeURIComponent(id)}/draft/check?expected_generation=${generation}`, undefined, 'POST'),
};
