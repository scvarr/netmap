export type BlueprintSlotKind = 'CONNECTION_POINT' | 'NETWORK_PORT';

export interface PresentationPanel {
  panel_key: string;
  panel_number: number;
  display_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LibraryRef {
  ref_type: 'LIBRARY_RECORD';
  entity_type: 'BaseTemplate' | 'BaseTemplateRevision';
  entity_id: string;
}

export interface BlueprintBody {
  kind: 'RECTANGLE';
  width: number;
  height: number;
  fill_color?: string | null;
}

export interface BlueprintSlot {
  key: string;
  display_name: string;
  kind: BlueprintSlotKind;
  panel_key: string;
  rendered_position: { x: number; y: number };
}

export interface BaseInternalLink {
  from_slot_key: string;
  to_slot_key: string;
}

export interface CreateBaseTemplateRequest {
  name: string;
  default_physical_object_class?: string;
  body: BlueprintBody;
  panels: PresentationPanel[];
  slots: BlueprintSlot[];
  internal_links: BaseInternalLink[];
  bays?: import('./hardwareModules').ModuleBay[];
}

export interface BaseTemplateListItem {
  blueprint_ref: LibraryRef;
  name: string;
  version_ref: LibraryRef;
  version_number: number;
  default_physical_object_class?: string | null;
  body: BlueprintBody;
  slot_count: number;
  internal_link_count: number;
  version_count: number;
}

export interface BaseTemplateListDocument {
  schema_version: '2.0';
  blueprints: BaseTemplateListItem[];
}

export interface BaseTemplateRevisionDocument {
  schema_version: '2.0';
  blueprint_ref: LibraryRef;
  name: string;
  version_ref: LibraryRef;
  version_number: number;
  next_panel_number: number;
  default_physical_object_class?: string | null;
  body: BlueprintBody;
  panels: PresentationPanel[];
  slots: BlueprintSlot[];
  internal_links: BaseInternalLink[];
  bays?: import('./hardwareModules').ModuleBay[];
}

export interface BaseTemplateCreationDocument {
  schema_version: '2.0';
  blueprint_ref: LibraryRef;
  version_ref: LibraryRef;
}

export interface CanonicalObjectConfigurationRef {
  ref_type: 'CANONICAL_FACT';
  entity_type: 'PhysicalObject' | 'ConnectionPoint' | 'NetworkInterface';
  entity_id: string;
}

export interface BaseTemplateInstantiationDocument {
  schema_version: '2.0';
  blueprint_ref: LibraryRef;
  version_ref: LibraryRef;
  physical_object_ref: CanonicalObjectConfigurationRef & { entity_type: 'PhysicalObject' };
  slots: Array<{ slot_key: string; connection_point_ref: CanonicalObjectConfigurationRef & { entity_type: 'ConnectionPoint' }; network_interface_ref?: (CanonicalObjectConfigurationRef & { entity_type: 'NetworkInterface' }) | null }>;
}

export interface BaseTemplateDataSource {
  loadBaseTemplates(): Promise<BaseTemplateListDocument>;
  loadBaseTemplateRevision(blueprintId: string, versionId: string): Promise<BaseTemplateRevisionDocument>;
  createBaseTemplate(request: CreateBaseTemplateRequest): Promise<BaseTemplateCreationDocument>;
  deleteBaseTemplate?(blueprintId: string): Promise<void>;
  createPhysicalObject?(baseTemplateId: string, request: { display_name: string; location_id?: string }): Promise<BaseTemplateInstantiationDocument>;
}
