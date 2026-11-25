import type { BlueprintSlot, BlueprintSlotKind, TemplateImpactReason } from './baseTemplateTypes';

export type MountKind = 'MODULE_PORT' | 'MODULE_BAY';
export type ModuleMount =
  | { mount_kind: 'MODULE_PORT'; module_port_type_id: string; module_bay_type_id?: null }
  | { mount_kind: 'MODULE_BAY'; module_bay_type_id: string; module_port_type_id?: null };

export const isMountKind = (value: unknown): value is MountKind => value === 'MODULE_PORT' || value === 'MODULE_BAY';
export const mountTypeId = (mount: ModuleMount) =>
  mount.mount_kind === 'MODULE_PORT' ? mount.module_port_type_id : mount.module_bay_type_id;

export type SelectedMount = ModuleMount & { module_port_type_id: string | null; module_bay_type_id: string | null };

export function moduleMount(kind: MountKind, id: string): SelectedMount {
  return kind === 'MODULE_PORT'
    ? { mount_kind: kind, module_port_type_id: id, module_bay_type_id: null }
    : { mount_kind: kind, module_bay_type_id: id, module_port_type_id: null };
}

export function parseMount(value: Record<string, unknown>): ModuleMount {
  const { mount_kind, module_port_type_id, module_bay_type_id } = value;
  if (mount_kind === 'MODULE_PORT' && typeof module_port_type_id === 'string' && module_bay_type_id == null) {
    return moduleMount(mount_kind, module_port_type_id);
  }
  if (mount_kind === 'MODULE_BAY' && typeof module_bay_type_id === 'string' && module_port_type_id == null) {
    return moduleMount(mount_kind, module_bay_type_id);
  }
  throw new Error('Invalid module mount');
}

export type PlacedModuleBay = ModuleMount & {
  kind?: "PLACED";
  bay_key: string; display_name: string; panel_key: string;
  hardware_interface_key?: string;
  x: number; y: number; width?: number | null; height?: number | null;
};
export type LogicalModuleBay = ModuleMount & {
  kind: "LOGICAL";
  bay_key: string; display_name: string; panel_key: string;
  hardware_interface_key?: string;
  x?: null; y?: null; width?: null; height?: null;
};
export type ModuleBay = PlacedModuleBay | LogicalModuleBay;
export const isPlacedBay = (bay: ModuleBay): bay is PlacedModuleBay => bay.kind !== "LOGICAL";
export interface ModuleEndpoint { key: string; display_name: string; kind: BlueprintSlotKind; port_type_id: string }
export type ModulePlaceDefinition = ModuleMount & {
  key: string; display_name: string;
  hardware_interface_key?: string;
  x: number; y: number; width?: number | null; height?: number | null;
};
export type ModulePortMarker = { key: string; display_name: string; kind: MountKind; port_type_id?: never };
export const isModulePlaceMarker = (marker: ModuleEndpoint | ModulePortMarker): marker is ModulePortMarker => isMountKind(marker.kind);
export type BlueprintMarker = BlueprintSlot | (ModulePortMarker & Pick<BlueprintSlot, 'panel_key' | 'rendered_position'>);

export function modulePortPosition({ x, y, width, height }: Pick<PlacedModuleBay, 'x' | 'y' | 'width' | 'height'>) {
  return { x: x + (width ?? 0) / 2, y: y + (height ?? 0) / 2 };
}

export function positionModulePort<T extends Pick<PlacedModuleBay, 'x' | 'y' | 'width' | 'height'>>(
  port: T, position: { x: number; y: number },
) {
  const current = modulePortPosition(port);
  if (Math.abs(current.x - position.x) < 1e-12 && Math.abs(current.y - position.y) < 1e-12) return port;
  const { width: _width, height: _height, ...definition } = port;
  return { ...definition, ...position } as T;
}

export function moduleBayMarkers(bays: ModuleBay[]) {
  return bays.filter(isPlacedBay).map(bay => ({
    key: bay.bay_key, display_name: bay.display_name, kind: bay.mount_kind,
    panel_key: bay.panel_key, rendered_position: modulePortPosition(bay),
  }));
}
export interface ModuleGeometry { width: number; height: number; fill_color: string; endpoints: Record<string, { x: number; y: number }> }
export const initialModuleGeometry = (): ModuleGeometry => ({ width: 240, height: 80, fill_color: "#64748b", endpoints: {} });
export interface TransceiverSpecifications {
  manufacturer?: string;
  part_number?: string;
  description?: string;
  speed_mbps?: number;
  reach_m?: number;
  tx_wavelength_nm?: number;
  rx_wavelength_nm?: number;
  fiber_type?: string;
  notes?: string;
}
export type ModuleTemplateInput = ModuleMount & {
  geometry: ModuleGeometry; name: string; endpoints: ModuleEndpoint[];
  module_places?: ModulePlaceDefinition[]; transceiver?: TransceiverSpecifications;
  internal_links?: {
    from_endpoint_key: string;
    to_endpoint_key: string;
    member_mappings: { from_member_index: number; to_member_index: number }[];
  }[];
};
export type ModuleTemplate = ModuleTemplateInput & { template_id: string; revision_id: string; publication_state?: ModuleDraftDocument["publication_state"] };
export type ModuleSourceWiring = Pick<ModuleTemplateInput, 'endpoints'> & {
  internal_links: NonNullable<ModuleTemplateInput['internal_links']>;
  draft_incompatible: boolean;
};
export interface ModuleDraftDocument {
  source_wiring: ModuleSourceWiring | null;
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
  section: 'properties' | 'endpoints' | 'module_places' | 'geometry'; key: string; operation: 'added' | 'removed' | 'changed';
  before: ModuleGeometry | ModulePlaceDefinition | ModuleMount | TransceiverSpecifications | string | (ModuleEndpoint & { order_index: number }) | null;
  after: ModuleGeometry | ModulePlaceDefinition | ModuleMount | TransceiverSpecifications | string | (ModuleEndpoint & { order_index: number }) | null;
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
  restoreDraftSource?(id: string, generation: number): Promise<ModuleDraftDocument>;
  checkDraft(id: string, generation: number): Promise<ModuleDraftDocument>;
}
export type InstalledModulePlace = PlacedModuleBay & {
  network_interface_id?: string;
  installation_id: string | null;
  global_position: Pick<PlacedModuleBay, 'panel_key' | 'x' | 'y' | 'width' | 'height'>;
};
export interface ModuleInstallation {
  id: string; module_template_id: string; module_revision_id: string; name: string;
  layout: { panel_key: string; x: number; y: number; width: number; height: number };
  initial_layout?: ModuleInstallation["layout"];
  parent_installation_id?: string | null;
  module_places?: InstalledModulePlace[];
  fill_color: string;
  orientation: 'HORIZONTAL' | 'VERTICAL';
  endpoints: Array<Omit<ModuleEndpoint, 'display_name'> & {
    installation_id: string; definition_id: string; cardinality: number; members: string[];
    panel_key: string; panel_display_name: string;
    bay_key: string; bay_display_name: string;
    local_display_name: string; contextual_display_name: string;
    connection_point_id: string; network_interface_id: string | null; x: number; y: number;
  }>;
}
export interface HardwareConfiguration { configuration_id: string | null; base_revision_id?: string; panels?: Array<{ panel_key: string; display_name: string; width: number; height: number }>; bays: Array<ModuleBay & { installation: ModuleInstallation | null; network_interface_id?: string }>; nested_installations?: ModuleInstallation[] }
export interface ReplaceTransceiverInput {
  configuration_id: string; base_revision_id: string; bay_key: string;
  parent_installation_id: string | null; parent_revision_id: string | null;
  source_revision_id: string; source_point_id: string; interface_id: string;
  module_template_id: string; target_revision_id: string;
  cable_assignments?: { cable_id: string; member_index: number }[];
  compatibility?: import('./physicalCompatibility').PhysicalCompatibilityConfirmation;
}
export interface TransceiverReplacementPreview {
  compatibility: import('./physicalCompatibility').PhysicalCompatibilityPreview;
  cables: BlockingModuleCable[];
}
export interface HardwareModuleDataSource {
  saveLayout?(objectId: string, installationId: string, input: unknown): Promise<HardwareConfiguration>;
  listModules(): Promise<{ modules: ModuleTemplate[] }>;
  createModule(input: ModuleTemplateInput): Promise<ModuleTemplate>;
  deleteModule(templateId: string): Promise<void>;
  uninstallModule(objectId: string, installationId: string): Promise<HardwareConfiguration>;
  replaceTransceiver(objectId: string, installationId: string, input: ReplaceTransceiverInput): Promise<HardwareConfiguration>;
  previewTransceiverReplacement(objectId: string, installationId: string, input: ReplaceTransceiverInput): Promise<TransceiverReplacementPreview>;
  loadConfiguration(objectId: string): Promise<HardwareConfiguration>;
  installModule(objectId: string, input: { module_template_id: string; bay_key: string; parent_installation_id?: string; orientation: 'HORIZONTAL' | 'VERTICAL' }): Promise<HardwareConfiguration>;
}
export interface BlockingModuleCableEndpoint {
  point_id: string;
  object_id: string;
  object_label: string | null;
  point_label: string | null;
  panel: { panel_key: string; name: string; face: 'FRONT' | 'REAR' | null; number: number } | null;
  location_path: { location_id: string; name: string }[];
  cardinality: number;
  member_index: number | null;
  members: { index: number; designation: string }[];
}

export interface BlockingModuleCable {
  cable_id: string;
  label: string | null;
  connection_id: string;
  connection_member_id: string | null;
  local: BlockingModuleCableEndpoint;
  remote: BlockingModuleCableEndpoint;
}

export class HardwareModuleError extends Error {
  constructor(message: string, readonly reason?: string, readonly blockingCables: BlockingModuleCable[] = [],
    readonly blockers: Record<string, number> = {}) {
    super(message);
  }
}

async function request<T>(url: string, input?: unknown, method: 'GET' | 'POST' | 'DELETE' | 'PUT' = input === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(url, { method, ...(input === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }) });
  if (response.status === 204) return undefined as T;
  const document = await response.json();
  if (!response.ok) throw new HardwareModuleError(document.error?.message ?? `HTTP ${response.status}`,
    document.error?.details?.reason ?? document.error?.code, document.error?.details?.blocking_cables,
    document.error?.details?.blockers);
  return document as T;
}
export const hardwareModuleDataSource: HardwareModuleDataSource = {
  saveLayout: (id, installationId, input) => request(`/api/v1/topology/physical-objects/${encodeURIComponent(id)}/module-installations/${encodeURIComponent(installationId)}/layout`, input, "PUT"),
  listModules: () => request('/api/v1/library/module-templates'),
  createModule: input => request('/api/v1/library/module-templates', input),
  deleteModule: id => request(`/api/v1/library/module-templates/${encodeURIComponent(id)}`, undefined, 'DELETE'),
  uninstallModule: (id, installationId) => request(`/api/v1/topology/physical-objects/${encodeURIComponent(id)}/module-installations/${encodeURIComponent(installationId)}`, undefined, 'DELETE'),
  replaceTransceiver: (id, installationId, input) => request(`/api/v1/topology/physical-objects/${encodeURIComponent(id)}/module-installations/${encodeURIComponent(installationId)}/replacement`, input),
  previewTransceiverReplacement: (id, installationId, input) => request(`/api/v1/topology/physical-objects/${encodeURIComponent(id)}/module-installations/${encodeURIComponent(installationId)}/replacement?preview=true`, input),
  loadConfiguration: id => request(`/api/v1/topology/physical-objects/${encodeURIComponent(id)}/configuration`),
  installModule: (id, input) => request(`/api/v1/topology/physical-objects/${encodeURIComponent(id)}/module-installations`, input),
};
export const moduleReviewDataSource: ModuleReviewDataSource = {
  reconcileInstallations: id => request('/api/v1/library/module-templates/' + encodeURIComponent(id) + '/reconcile', undefined, 'POST'),
  publishCandidate: (id, candidate) => request(`/api/v1/library/module-templates/${encodeURIComponent(id)}/candidates/${encodeURIComponent(candidate)}/publish`, undefined, "POST"),
  loadDraft: id => request(`/api/v1/library/module-templates/${encodeURIComponent(id)}/draft`),
  saveDraft: (id, input, generation) => request(`/api/v1/library/module-templates/${encodeURIComponent(id)}/draft?expected_generation=${generation}`, input, 'PUT'),
  restoreDraftSource: (id, generation) => request(`/api/v1/library/module-templates/${encodeURIComponent(id)}/draft/restore-source?expected_generation=${generation}`, undefined, 'POST'),
  checkDraft: (id, generation) => request(`/api/v1/library/module-templates/${encodeURIComponent(id)}/draft/check?expected_generation=${generation}`, undefined, 'POST'),
};

// Allocate only missing keys; retain all authored positions exactly.
export function moduleEndpointPositions(endpoints: ReadonlyArray<{ key: string }>, positions: ModuleGeometry['endpoints']): ModuleGeometry['endpoints'] {
 const result: ModuleGeometry['endpoints'] = {};
 for (const e of endpoints) if (positions[e.key]) result[e.key] = positions[e.key];
 for (const e of endpoints) {
  if (result[e.key]) continue;
  let found = false;
  for (let level = 1; !found; level++) {
   const n = 2 ** level;
   for (let y = 1; y < n && !found; y++) for (let x = 1; x < n && !found; x++) {
    const point = { x: x / n, y: y / n };
    if (Object.values(result).every(p => Math.hypot(p.x-point.x,p.y-point.y) > Math.min(.08, 1/n))) { result[e.key] = point; found = true; }
   }
  }
 }
 return result;
}
