import type { LocationDataSource, LocationDocument, PhysicalObjectLocationDocument } from './locationTypes';

const DEFAULT_ENDPOINT = '/api/v1';
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const malformed = (message: string): never => { throw new Error(`Malformed Location response: ${message}`); };
const string = (value: unknown, path: string): string => { if (typeof value !== 'string' || value.length === 0) malformed(`${path} must be a non-empty string.`); return value as string; };
const locationRef = (value: unknown, path: string) => {
  if (!isObject(value) || value.ref_type !== 'CANONICAL_FACT' || value.entity_type !== 'Location') malformed(`${path} must be a Location canonical reference.`);
  const reference = value as Record<string, unknown>;
  return { ref_type: 'CANONICAL_FACT' as const, entity_type: 'Location' as const, entity_id: string(reference.entity_id, `${path}.entity_id`) };
};

export const parseLocationDocument = (value: unknown): LocationDocument => {
  if (!isObject(value)) malformed('document must be an object.');
  const document = value as Record<string, unknown>; const type = document.type;
  if (type !== null && type !== undefined && typeof type !== 'string') malformed('document.type must be a string or null.');
  const parent = document.parent_location_ref;
  if (parent !== null && parent !== undefined && !isObject(parent)) malformed('document.parent_location_ref must be a reference or null.');
  return { location_ref: locationRef(document.location_ref, 'document.location_ref'), name: string(document.name, 'document.name'), type: (type ?? null) as string | null, parent_location_ref: parent ? locationRef(parent, 'document.parent_location_ref') : null };
};

export const parseLocationList = (value: unknown): LocationDocument[] => {
  if (!isObject(value) || !Array.isArray(value.locations)) malformed('document.locations must be an array.');
  return ((value as Record<string, unknown>).locations as unknown[]).map(parseLocationDocument);
};

export const parsePhysicalObjectLocationDocument = (value: unknown): PhysicalObjectLocationDocument => {
  if (!isObject(value) || !isObject(value.physical_object_ref)) malformed('document.physical_object_ref must be an object.');
  const document = value as Record<string, unknown>; const objectRef = document.physical_object_ref as Record<string, unknown>;
  if (objectRef.ref_type !== 'CANONICAL_FACT' || objectRef.entity_type !== 'PhysicalObject') malformed('document.physical_object_ref must be a PhysicalObject canonical reference.');
  const location = document.location_ref;
  if (location !== null && location !== undefined && !isObject(location)) malformed('document.location_ref must be a reference or null.');
  return { physical_object_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: string(objectRef.entity_id, 'document.physical_object_ref.entity_id') }, location_ref: location ? locationRef(location, 'document.location_ref') : null };
};

const error = (body: unknown, status: number) => isObject(body) && isObject(body.error) && typeof body.error.message === 'string' ? body.error.message : `Location request failed with status ${status}.`;

export class ApiLocationDataSource implements LocationDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}
  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.endpoint}${path}`, init);
    if (response.status === 204) return undefined;
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(error(body, response.status));
    return body;
  }
  async loadLocations() { return parseLocationList(await this.request('/locations')); }
  async createLocation(request: { name: string; type: string | null; parent_location_id: string | null }) { return parseLocationDocument(await this.request('/locations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })); }
  async updateLocation(locationId: string, request: { name: string; type: string | null }) { return parseLocationDocument(await this.request(`/locations/${encodeURIComponent(locationId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })); }
  async reparentLocation(locationId: string, parentLocationId: string | null) { return parseLocationDocument(await this.request(`/locations/${encodeURIComponent(locationId)}/parent`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent_location_id: parentLocationId }) })); }
  async deleteLocation(locationId: string) { await this.request(`/locations/${encodeURIComponent(locationId)}`, { method: 'DELETE' }); }
  async loadPhysicalObjectLocation(physicalObjectId: string) { return parsePhysicalObjectLocationDocument(await this.request(`/topology/physical-objects/${encodeURIComponent(physicalObjectId)}/location`)); }
  async setPhysicalObjectLocation(physicalObjectId: string, locationId: string | null) { return parsePhysicalObjectLocationDocument(await this.request(`/topology/physical-objects/${encodeURIComponent(physicalObjectId)}/location`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location_id: locationId }) })); }
}
