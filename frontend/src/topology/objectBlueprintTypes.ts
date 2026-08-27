export type BlueprintSlotKind = 'CONNECTION_POINT' | 'NETWORK_PORT';
export type BlueprintFace = 'FRONT' | 'REAR';
export interface BlueprintPortBlockPlacement { x: number; y: number; width: number; height: number; }

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
  face?: BlueprintFace;
  rendered_position: { x: number; y: number };
}

export interface BlueprintInternalLink {
  from_slot_key: string;
  to_slot_key: string;
}

export interface PortBlockVersionLibraryRef { ref_type: 'LIBRARY_RECORD'; entity_type: 'PortBlockVersion'; entity_id: string; }
export interface PortBlockLibraryRef { ref_type: 'LIBRARY_RECORD'; entity_type: 'PortBlock'; entity_id: string; }
export interface BlueprintComposition { instances: Array<{ instance_key: string; port_block_ref: PortBlockLibraryRef; port_block_version_ref: PortBlockVersionLibraryRef; face?: BlueprintFace; placement?: BlueprintPortBlockPlacement | null }>; }

export interface CreateObjectBlueprintRequest {
  name: string;
  default_physical_object_class?: string;
  body: BlueprintBody;
  composition: { instances: Array<{ instance_key: string; port_block_version_ref: PortBlockVersionLibraryRef; face: BlueprintFace; placement: BlueprintPortBlockPlacement }> };
  internal_links: BlueprintInternalLink[];
}

export interface CreateObjectBlueprintVersionRequest extends Omit<CreateObjectBlueprintRequest, 'name'> {
  blueprint_name?: string;
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
  composition?: BlueprintComposition | null;
}

export interface ObjectBlueprintCreationDocument {
  schema_version: '1.0';
  blueprint_ref: LibraryRef;
  version_ref: LibraryRef;
}

export interface CanonicalBlueprintInstanceRef {
  ref_type: 'CANONICAL_FACT';
  entity_type: 'PhysicalObject' | 'ConnectionPoint' | 'NetworkInterface';
  entity_id: string;
}

export interface ObjectBlueprintInstantiationDocument {
  schema_version: '1.0';
  blueprint_ref: LibraryRef;
  version_ref: LibraryRef;
  physical_object_ref: CanonicalBlueprintInstanceRef & { entity_type: 'PhysicalObject' };
  slots: Array<{ slot_key: string; connection_point_ref: CanonicalBlueprintInstanceRef & { entity_type: 'ConnectionPoint' }; network_interface_ref?: (CanonicalBlueprintInstanceRef & { entity_type: 'NetworkInterface' }) | null }>;
}

export interface ObjectBlueprintDataSource {
  loadObjectBlueprints(): Promise<ObjectBlueprintListDocument>;
  loadObjectBlueprintVersion(blueprintId: string, versionId: string): Promise<ObjectBlueprintVersionDocument>;
  createObjectBlueprint(request: CreateObjectBlueprintRequest): Promise<ObjectBlueprintCreationDocument>;
  createObjectBlueprintVersion?(blueprintId: string, request: CreateObjectBlueprintVersionRequest): Promise<ObjectBlueprintCreationDocument>;
  deleteObjectBlueprint?(blueprintId: string): Promise<void>;
  instantiateObjectBlueprint?(blueprintId: string, versionId: string, request: { display_name: string }): Promise<ObjectBlueprintInstantiationDocument>;
}
