import type { PhysicalObjectDeleteDataSource } from './physicalObjectDeleteTypes';

const DEFAULT_ENDPOINT = '/api/v1/topology/physical-objects';

export class ApiPhysicalObjectDeleteDataSource implements PhysicalObjectDeleteDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async deletePhysicalObject(physicalObjectId: string): Promise<void> {
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(physicalObjectId)}`, { method: 'DELETE' });
    if (response.ok) return;
    let message = `HTTP ${response.status} while deleting PhysicalObject.`;
    try {
      const body: unknown = await response.json();
      if (typeof body === 'object' && body !== null && 'error' in body) {
        const error = (body as { error?: { code?: unknown; message?: unknown } }).error;
        if (typeof error?.code === 'string' && typeof error.message === 'string') message = `${error.code}: ${error.message}`;
      }
    } catch { /* retain HTTP fallback */ }
    throw new Error(message);
  }
}
