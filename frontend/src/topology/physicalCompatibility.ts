import type { useI18n } from '../i18n';

export interface PhysicalCompatibilityConfirmation {
  token: string;
  accept_unknown: boolean;
}

type Verdict = 'ALLOW' | 'DENY' | 'UNKNOWN';
const reasonKeys = {
  MEDIUM_MISMATCH: 'compatibility.medium',
  PROFILE_MISMATCH: 'compatibility.profile',
  TERMINATION_MISMATCH: 'compatibility.termination',
  PORT_TYPE_UNRESOLVED: 'compatibility.portType',
  CABLE_CONNECTOR_UNSPECIFIED: 'compatibility.cableConnector',
  PORT_CONNECTOR_UNSPECIFIED: 'compatibility.portConnector',
  FIBER_MODE_UNDOCUMENTED: 'compatibility.fiberMode',
  COMPATIBLE: 'compatibility.compatible',
} as const;

export interface PhysicalCompatibilityPreview {
  verdict: Verdict;
  token: string | null;
  ends: { pair: number; side: 'A' | 'B'; verdict: Verdict; reasons: (keyof typeof reasonKeys)[] }[];
}

export class PhysicalCompatibilityError extends Error {}

export function compatibilityReasons(preview: PhysicalCompatibilityPreview, t: ReturnType<typeof useI18n>['t']): string[] {
  return preview.ends.filter(end => end.verdict !== 'ALLOW').map(end => t('compatibility.end', {
    pair: end.pair, side: end.side, reasons: end.reasons.map(reason => t(reasonKeys[reason])).join(', '),
  }));
}

export function compatibilityMessage(preview: PhysicalCompatibilityPreview, t: ReturnType<typeof useI18n>['t']): string {
  return [t(preview.verdict === 'DENY' ? 'compatibility.denied' : 'compatibility.unknown'), ...compatibilityReasons(preview, t)].join('\n');
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
  if (!['ALLOW', 'DENY', 'UNKNOWN'].includes(preview?.verdict) || !Array.isArray(preview.ends)
      || (preview.verdict !== 'DENY' && typeof preview.token !== 'string')) {
    throw new Error('Malformed physical compatibility preview');
  }
  return preview;
}
