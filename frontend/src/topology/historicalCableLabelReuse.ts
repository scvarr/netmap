export class HistoricalCableLabelReuseRequiredError extends Error {
  constructor(readonly candidate: string) { super('Historical Cable label reuse requires confirmation'); }
}

export class HistoricalCableLabelReuseConfirmationStaleError extends Error {
  constructor() { super('Historical Cable label reuse confirmation is stale'); }
}

export const isHistoricalCableLabelReuseRequired = (value: unknown): value is HistoricalCableLabelReuseRequiredError => value instanceof HistoricalCableLabelReuseRequiredError;
export const isHistoricalCableLabelReuseConfirmationStale = (value: unknown): value is HistoricalCableLabelReuseConfirmationStaleError => value instanceof HistoricalCableLabelReuseConfirmationStaleError;

export const historicalCableLabelError = (value: unknown): Error => {
  if (typeof value === 'object' && value !== null && 'error' in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === 'object' && error !== null) {
      const body = error as { code?: unknown; message?: unknown; details?: unknown };
      if (body.code === 'HISTORICAL_CABLE_LABEL_REUSE_REQUIRED' && typeof body.details === 'object' && body.details !== null && typeof (body.details as { candidate?: unknown }).candidate === 'string') return new HistoricalCableLabelReuseRequiredError((body.details as { candidate: string }).candidate);
      if (body.code === 'HISTORICAL_CABLE_LABEL_REUSE_CONFIRMATION_STALE') return new HistoricalCableLabelReuseConfirmationStaleError();
      if (typeof body.message === 'string') return new Error(body.message);
    }
  }
  return new Error('Historical Cable label response is invalid');
};
