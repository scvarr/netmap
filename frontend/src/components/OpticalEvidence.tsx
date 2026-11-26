import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { memberAddressKey, type MemberAddress } from '../topology/exactMemberTrace';
import { resolveTraceMemberNames } from '../topology/traceAddresses';
import type { CatalogInventoryEquipmentItem } from '../topology/catalogInventoryTypes';
import type { PhysicalObjectDetailsDataSource } from '../topology/physicalObjectDetailsTypes';
import type { TopologyDataSource, TopologyProjectionDocument } from '../topology/types';
import { readOpticalDiagnostic, readOpticalPaths, type OpticalFact } from '../topology/opticalDiagnostic';
import { compatibilityMessage, type PhysicalCompatibilityPreview } from '../topology/physicalCompatibility';
import type { useCompatibilityPreview } from './useCompatibilityPreview';

type Address = (point: MemberAddress) => string;

export function ConnectionPreview({ review }: { review: ReturnType<typeof useCompatibilityPreview> }) {
  const { t } = useI18n();
  if (review.waiting) return <p role="status">{t('compatibility.checking')}</p>;
  if (review.failed) return <div role="alert">{t('optical.readFailed')}{' '}
    <button type="button" onClick={review.retry}>{t('action.retry')}</button>
  </div>;
  if (!review.preview) return null;
  return <>
    <p role={review.preview.verdict === 'DENY' ? 'alert' : 'status'}>{compatibilityMessage(review.preview, t)}</p>
    <OpticalPreview preview={review.preview} />
  </>;
}

export function OpticalEvidence({ value, address, trace = false }: { value: unknown; address?: Address; trace?: boolean }) {
  const { t } = useI18n();
  const diagnostic = readOpticalDiagnostic(value);
  if (!diagnostic) return <p>{t('optical.title')} · {t('optical.missing')}</p>;
  const pointLabel = address ?? ((point: MemberAddress) =>
    t('trace.addressUnavailable', { point: point.point_id, index: point.member_index }));
  const factLabel = (fact: OpticalFact) => [
    t(`optical.${fact.source}`),
    fact.value === 'NO_FIBER' || fact.value === 'COPPER' ? t(`optical.${fact.value}`) : fact.value ?? t('optical.UNKNOWN'),
    ...fact.points.map(pointLabel),
    ...(fact.proposed_endings ?? []).map(end => `${end.side} · ${end.interface_id} · #${end.member_index}`),
  ].join(' · ');
  const { status, facts, conflicts, reason, termination } = diagnostic;
  return <section aria-label={t('optical.title')}>
    <p><strong>{t('optical.title')} · {t(`optical.${status}`)}</strong></p>
    {reason && <p>{t(`optical.${reason}`)}{termination && ` · ${termination.node_id}`}</p>}
    {conflicts.length > 0 && <ul>{conflicts.map(({ kind, left_fact, right_fact, unknown_facts }, index) => {
      const transition = kind === 'LOCAL' ? [
        facts[left_fact].points.at(-1), facts[right_fact].points[0],
      ].filter((point): point is MemberAddress => Boolean(point)) : [];
      const transitionLabels = [...new Set(transition.map(pointLabel))];
      return <li key={index}><strong>{t(`optical.${kind}`)}</strong>
        {transitionLabels.length > 0 && <div>{transitionLabels.join(' → ')}</div>}
        <div>{factLabel(facts[left_fact])} ↔ {factLabel(facts[right_fact])}</div>
        {unknown_facts.length > 0 && <><span>{t('optical.unknownBetween')}</span>
          <ul>{unknown_facts.map(fact => <li key={fact}>{factLabel(facts[fact])}</li>)}</ul></>}
      </li>;
    })}</ul>}
    {facts.filter(fact => fact.unknown_reason || fact.model_error).map((fact, index) => <p key={index}>
      {factLabel(fact)}{fact.unknown_reason && ` · ${t(`optical.${fact.unknown_reason}`)}`}
      {fact.model_error && ` · ${t('optical.invalid')} · ${fact.model_error.reason} · ${fact.model_error.detail}`}
      {fact.ending_media?.map(end => ` · ${end.side} ${t('optical.COPPER')} / ${end.port_type_id} / ${end.revision_id} / ${end.mapping_id ?? ''}`)}
    </p>)}
    {trace && status === 'CONFLICT' && <p className="muted">{t('optical.geometry')}</p>}
    {facts.length > 0 && <details><summary>{t('optical.facts')}</summary>
      <ol>{facts.map((fact, index) => <li key={index}>
        {factLabel(fact)}
        {fact.provenance && ` · ${t('optical.revision')} ${[
          fact.provenance.revision_id, fact.provenance.internal_link_id, ...fact.provenance.mapping_ids,
        ].filter(Boolean).join(' / ')}`}
        {fact.canonical_refs.map(ref => ` · ${ref.entity_type} ${ref.entity_id}`)}
      </li>)}</ol>
    </details>}
  </section>;
}

export function OpticalPaths({ value, address }: { value: unknown; address?: Address }) {
  return <>{readOpticalPaths(value).map((item, index) =>
    <OpticalEvidence key={index} value={item} address={address} trace />)}</>;
}

export function TraceOpticalEvidence({ value, equipment, details, projection, projectionSource }: {
  value: unknown;
  equipment: CatalogInventoryEquipmentItem[] | null;
  details?: PhysicalObjectDetailsDataSource;
  projection?: TopologyProjectionDocument | null;
  projectionSource?: TopologyDataSource;
}) {
  const { t } = useI18n();
  const [resolved, setResolved] = useState<{ value: unknown; names: Map<string, string> }>();
  useEffect(() => {
    const diagnostic = readOpticalDiagnostic(value);
    if (!details || !diagnostic) return;
    const controller = new AbortController();
    const points = diagnostic.facts.flatMap(fact => fact.points);
    void resolveTraceMemberNames(points, equipment ?? [], details, projection, projectionSource, controller.signal)
      .then(names => { if (!controller.signal.aborted) setResolved({ value, names }); });
    return () => controller.abort();
  }, [value, details, equipment, projection, projectionSource]);
  return <OpticalEvidence value={value} trace address={point =>
    (resolved && resolved.value === value ? resolved.names.get(memberAddressKey(point)) : undefined)
    ?? t('trace.addressUnavailable', { point: point.point_id, index: point.member_index })} />;
}

export function OpticalPreview({ preview, pairLabel, address }: {
  preview: PhysicalCompatibilityPreview;
  pairLabel?: (pair: number) => string | undefined;
  address?: Address;
}) {
  const { t } = useI18n();
  const pairs = preview.pairs.map(pair => ({ pair: pair.pair, value: readOpticalDiagnostic(pair.optical_diagnostic) }))
    .filter(pair => pair.value?.status !== 'NOT_APPLICABLE');
  const conflicts = pairs.filter(pair => pair.value?.status === 'CONFLICT').length;
  return <>
    {preview.pairs.length > 1 && conflicts > 0 && <p role="status">{t('optical.conflictCount', { count: conflicts })}</p>}
    {pairs.map(({ pair, value }) => <div key={pair}>
      {preview.pairs.length > 1 && <strong>{pairLabel?.(pair) ?? t('optical.pair', { pair })}</strong>}
      <OpticalEvidence value={value} address={address} />
    </div>)}
  </>;
}
