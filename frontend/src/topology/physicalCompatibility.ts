import type { useI18n } from '../i18n';

export interface PhysicalCompatibilityConfirmation {
  token: string;
  accept_unknown: boolean;
}

export type Verdict = 'ALLOW' | 'DENY' | 'UNKNOWN';
export const compatibilityReasonKeys = {
  MEDIUM_MISMATCH: 'compatibility.medium',
  PORT_TYPES_NOT_ALLOWED: 'compatibility.portTypesDenied',
  PORT_COMPATIBILITY_UNDEFINED: 'compatibility.portRuleUndefined',
  PORT_A_TYPE_UNRESOLVED: 'compatibility.portAType',
  PORT_B_TYPE_UNRESOLVED: 'compatibility.portBType',
  FIBER_MODE_MISMATCH: 'compatibility.fiberMismatch',
  FIBER_MODE_UNDOCUMENTED: 'compatibility.fiberMode',
  COMPATIBLE: 'compatibility.compatible',
} as const;

export interface PhysicalCompatibilityPreview {
  verdict: Verdict;
  token: string | null;
  pairs: { pair: number; verdict: Verdict; reasons: (keyof typeof compatibilityReasonKeys)[] }[];
}

export class PhysicalCompatibilityError extends Error {}

export function compatibilityReasons(preview: PhysicalCompatibilityPreview, t: ReturnType<typeof useI18n>['t']): string[] {
  return preview.pairs.map(pair => t('compatibility.pair', {
    pair: pair.pair, verdict: pair.verdict, reasons: pair.reasons.map(reason => t(compatibilityReasonKeys[reason])).join(', '),
  }));
}

export function compatibilityMessage(preview: PhysicalCompatibilityPreview, t: ReturnType<typeof useI18n>['t']): string {
  const headline = { ALLOW: 'compatibility.allowed', DENY: 'compatibility.denied', UNKNOWN: 'compatibility.unknown' } as const;
  return [t(headline[preview.verdict]), ...compatibilityReasons(preview, t)].join('\n');
}

export function confirmPhysicalCompatibility(
  preview: PhysicalCompatibilityPreview,
  t: ReturnType<typeof useI18n>['t'],
): PhysicalCompatibilityConfirmation | null {
  const { verdict, token } = preview;
  if (verdict === 'ALLOW' && token) return { token, accept_unknown: false };
  if (verdict === 'DENY') {
    throw new PhysicalCompatibilityError(compatibilityMessage(preview, t));
  }
  return token && window.confirm(compatibilityMessage(preview, t))
    ? { token, accept_unknown: true }
    : null;
}

export async function requestPhysicalCompatibility(
  url: string, request: object, readError: (response: Response) => Promise<Error>,
): Promise<PhysicalCompatibilityPreview> {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  if (!response.ok) throw await readError(response);
  const preview: PhysicalCompatibilityPreview = await response.json();
  if (!['ALLOW', 'DENY', 'UNKNOWN'].includes(preview?.verdict) || !Array.isArray(preview.pairs)
      || (preview.verdict !== 'DENY' && typeof preview.token !== 'string')) {
    throw new Error('Malformed physical compatibility preview');
  }
  return preview;
}
