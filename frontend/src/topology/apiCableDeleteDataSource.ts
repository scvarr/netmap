import type { CableDeleteDataSource } from './cableDeleteTypes';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ApiCableDeleteDataSource implements CableDeleteDataSource {
  constructor(private readonly endpoint = '/api/v1/cables') {}

  async deleteCable(cableId: string): Promise<void> {
    if (!UUID.test(cableId)) throw new Error('cableId must be a UUID.');
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(cableId)}`, {
      method: 'DELETE',
    });
    if (response.ok) return;
    throw new Error(`HTTP ${response.status} while deleting Cable.`);
  }
}
