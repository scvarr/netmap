import type { CableDeleteCandidate, CableDeleteDataSource, CableDeleteExpectation, CableDeletePair } from './cableDeleteTypes';

export class CableDeleteRequestError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status} during bulk Cable deletion.`);
  }
}

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

  async previewBulkDelete(pair: CableDeletePair): Promise<{ cables: CableDeleteCandidate[] }> {
    const response = await fetch(`${this.endpoint}/bulk-delete-preview?${new URLSearchParams({ ...pair })}`);
    if (!response.ok) throw new CableDeleteRequestError(response.status);
    return response.json();
  }

  async bulkDelete(pair: CableDeletePair, cables: CableDeleteExpectation[]): Promise<void> {
    const response = await fetch(`${this.endpoint}/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...pair, cables }),
    });
    if (!response.ok) throw new CableDeleteRequestError(response.status);
  }
}
