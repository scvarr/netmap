import { parsePhysicalObjectDetailsDocument } from './apiPhysicalObjectDetailsDataSource';
import type { PhysicalObjectClassWriteDataSource } from './physicalObjectClassWriteTypes';
import type { PhysicalObjectDetailsDocument } from './physicalObjectDetailsTypes';

const DEFAULT_ENDPOINT = '/api/v1/topology/physical-objects';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const errorMessage = (body: unknown, status: number): string => {
  if (isObject(body) && isObject(body.error) && typeof body.error.message === 'string') {
    return body.error.message;
  }
  return `Physical object class update failed with status ${status}.`;
};

export class ApiPhysicalObjectClassWriteDataSource implements PhysicalObjectClassWriteDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async setPhysicalObjectClass(
    physicalObjectId: string,
    value: string,
  ): Promise<PhysicalObjectDetailsDocument> {
    const response = await fetch(
      `${this.endpoint}/${encodeURIComponent(physicalObjectId)}/class`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      },
    );
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    return parsePhysicalObjectDetailsDocument(body);
  }
}
