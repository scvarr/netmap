import type { PhysicalObjectDeleteDataSource } from './physicalObjectDeleteTypes';

const DEFAULT_ENDPOINT = '/api/v1/topology/physical-objects';

const blockerLabels: Record<string, string> = {
  EXTERNAL_PHYSICAL_CONNECTION: 'внешние физические соединения',
  L3_BINDING: 'привязки L3',
  EXTERNAL_NETWORK_INTERFACE_REALIZATION: 'внешние реализации интерфейсов',
  EXTERNAL_INTERFACE_PHYSICAL_BINDING: 'внешние физические привязки интерфейсов',
  EXTERNAL_BLUEPRINT_INSTANCE_SLOT: 'внешние слоты Blueprint',
  AMBIGUOUS_CABLE_STRUCTURE: 'неоднозначная структура кабеля',
};

const blockerMessage = (blockers: Record<string, number>) => `Удаление невозможно: ${Object.entries(blockers).map(([kind, count]) => `${blockerLabels[kind] ?? `зависимость ${kind}`} (${count})`).join(', ')}.`;

export class PhysicalObjectDeletionError extends Error {
  constructor(readonly blockers: Record<string, number>) {
    super(blockerMessage(blockers));
    this.name = 'PhysicalObjectDeletionError';
  }
}

export class ApiPhysicalObjectDeleteDataSource implements PhysicalObjectDeleteDataSource {
  constructor(private readonly endpoint = DEFAULT_ENDPOINT) {}

  async deletePhysicalObject(physicalObjectId: string): Promise<void> {
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(physicalObjectId)}`, { method: 'DELETE' });
    if (response.ok) return;
    let message = `HTTP ${response.status} while deleting PhysicalObject.`;
    let deletionError: PhysicalObjectDeletionError | null = null;
    try {
      const body: unknown = await response.json();
      if (typeof body === 'object' && body !== null && 'error' in body) {
        const error = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error;
        const details = typeof error?.details === 'object' && error.details !== null ? error.details as Record<string, unknown> : null;
        const blockers = details && typeof details.reason === 'string' && details.reason === 'PHYSICAL_OBJECT_IN_USE' && typeof details.blockers === 'object' && details.blockers !== null
          ? Object.fromEntries(Object.entries(details.blockers as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isInteger(entry[1]) && entry[1] > 0))
          : null;
        if (blockers && Object.keys(blockers).length) deletionError = new PhysicalObjectDeletionError(blockers);
        if (typeof error?.code === 'string' && typeof error.message === 'string') message = `${error.code}: ${error.message}`;
      }
    } catch { /* retain HTTP fallback */ }
    throw deletionError ?? new Error(message);
  }
}
