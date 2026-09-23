export interface LocationRef { ref_type: 'CANONICAL_FACT'; entity_type: 'Location'; entity_id: string }

export interface LocationDocument {
  location_ref: LocationRef;
  name: string;
  type: string | null;
  parent_location_ref: LocationRef | null;
}

export interface PhysicalObjectLocationDocument {
  physical_object_ref: { ref_type: 'CANONICAL_FACT'; entity_type: 'PhysicalObject'; entity_id: string };
  location_ref: LocationRef | null;
}

export interface LocationSeriesRequest {
  parent_location_id: string;
  pattern: string;
  from: number;
  to: number;
  step: number;
  type: string | null;
}

export interface LocationSeriesPreview { names: string[]; conflicts: string[] }

export interface LocationDataSource {
  loadLocations(): Promise<LocationDocument[]>;
  createLocation(request: { name: string; type: string | null; parent_location_id: string | null }): Promise<LocationDocument>;
  previewLocationSeries(request: LocationSeriesRequest): Promise<LocationSeriesPreview>;
  createLocationSeries(request: LocationSeriesRequest): Promise<LocationDocument[]>;
  updateLocation(locationId: string, request: { name: string; type: string | null }): Promise<LocationDocument>;
  reparentLocation(locationId: string, parentLocationId: string | null): Promise<LocationDocument>;
  deleteLocation(locationId: string): Promise<void>;
  loadPhysicalObjectLocation(physicalObjectId: string): Promise<PhysicalObjectLocationDocument>;
  setPhysicalObjectLocation(physicalObjectId: string, locationId: string | null): Promise<PhysicalObjectLocationDocument>;
}
