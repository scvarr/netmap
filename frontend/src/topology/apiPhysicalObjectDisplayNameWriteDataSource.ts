import { parsePhysicalObjectDetailsDocument } from './apiPhysicalObjectDetailsDataSource';
import type { PhysicalObjectDetailsDocument } from './physicalObjectDetailsTypes';
import type { PhysicalObjectDisplayNameWriteDataSource } from './physicalObjectDisplayNameWriteTypes';

const DEFAULT_ENDPOINT = '/api/v1/topology/physical-objects';

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const errorMessage = (body: unknown, status: number): string => {
  if (isObject(body) && isObject(body.error) && typeof body.error.message === 'string') {
    return body.error.message;
  }
  return `Physical object display name update failed with status ${status}.`;
};

export class ApiPhysicalObjectDisplayNameWriteDataSource
implements PhysicalObjectDisplayNameWriteDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async renamePhysicalObject(
    physicalObjectId: string,
    displayName: string,
  ): Promise<PhysicalObjectDetailsDocument> {
    const response = await fetch(
      `${this.endpoint}/${encodeURIComponent(physicalObjectId)}/display-name`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName }),
      },
    );
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    return parsePhysicalObjectDetailsDocument(body);
  }
}
