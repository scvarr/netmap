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

export interface BlueprintAuthoringEndpointGroup {
  group_id: string;
  key_prefix: string;
  display_prefix: string;
  kind: BlueprintSlotKind;
  side: BlueprintAnchorSide;
  count: number;
  starting_number: number;
}

export interface BlueprintAuthoringRecipe {
  endpoint_groups: BlueprintAuthoringEndpointGroup[];
  pair_recipes: { group_a_id: string; group_b_id: string }[];
}

export interface CreateObjectBlueprintRequest {
  name: string;
  default_physical_object_class?: string;
  body: BlueprintBody;
  slots: BlueprintSlot[];
  internal_links: BlueprintInternalLink[];
  authoring_recipe?: BlueprintAuthoringRecipe;
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
  version_count: number;
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
  authoring_recipe?: BlueprintAuthoringRecipe | null;
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
