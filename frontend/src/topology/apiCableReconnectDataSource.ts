export type CableEnd = 'A' | 'B';

export interface CableReconnectSnapshot {
  expected: {
    connection_id: string;
    connection_member_id: string;
    point_a_id: string;
    point_b_id: string;
    label: string | null;
  };
  object_a_id: string;
  object_b_id: string;
  display_label: string;
}

export interface CableReconnectDataSource {
  preview(cableId: string): Promise<CableReconnectSnapshot>;
  reconnect(cableId: string, expected: CableReconnectSnapshot['expected'], side: CableEnd, newPointId: string): Promise<void>;
}

export class CableReconnectError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status} during Cable reconnect`);
  }
}

export class ApiCableReconnectDataSource implements CableReconnectDataSource {
  constructor(private readonly endpoint = '/api/v1/cables') {}

  private async request(cableId: string, init?: RequestInit) {
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(cableId)}/reconnect`, init);
    if (!response.ok) throw new CableReconnectError(response.status);
    return response;
  }

  async preview(cableId: string): Promise<CableReconnectSnapshot> {
    return (await this.request(cableId)).json();
  }

  async reconnect(cableId: string, expected: CableReconnectSnapshot['expected'], side: CableEnd, newPointId: string) {
    await this.request(cableId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected, side, new_point_id: newPointId }),
    });
  }
}
