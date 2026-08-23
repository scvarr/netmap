export type BlueprintSlotKind = 'CONNECTION_POINT' | 'NETWORK_PORT';
export type BlueprintAnchorSide = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';

export interface LibraryRef {
  ref_type: 'LIBRARY_RECORD';
  entity_type: 'ObjectBlueprint' | 'ObjectBlueprintVersion';
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
  anchor: { side: BlueprintAnchorSide; offset: number };
}

export interface BlueprintInternalLink {
  from_slot_key: string;
  to_slot_key: string;
}

export interface CreateObjectBlueprintRequest {
  name: string;
  default_physical_object_class?: string;
  body: BlueprintBody;
  slots: BlueprintSlot[];
  internal_links: BlueprintInternalLink[];
}

export interface ObjectBlueprintListItem {
  blueprint_ref: LibraryRef;
  name: string;
  version_ref: LibraryRef;
  version_number: number;
  default_physical_object_class?: string | null;
  body: BlueprintBody;
  slot_count: number;
  internal_link_count: number;
}

export interface ObjectBlueprintListDocument {
  schema_version: '1.0';
  blueprints: ObjectBlueprintListItem[];
}

export interface ObjectBlueprintVersionDocument {
  schema_version: '1.0';
  blueprint_ref: LibraryRef;
  name: string;
  version_ref: LibraryRef;
  version_number: number;
  default_physical_object_class?: string | null;
  body: BlueprintBody;
  slots: BlueprintSlot[];
  internal_links: BlueprintInternalLink[];
}

export interface ObjectBlueprintCreationDocument {
  schema_version: '1.0';
  blueprint_ref: LibraryRef;
  version_ref: LibraryRef;
}

export interface ObjectBlueprintDataSource {
  loadObjectBlueprints(): Promise<ObjectBlueprintListDocument>;
  loadObjectBlueprintVersion(blueprintId: string, versionId: string): Promise<ObjectBlueprintVersionDocument>;
  createObjectBlueprint(request: CreateObjectBlueprintRequest): Promise<ObjectBlueprintCreationDocument>;
}
