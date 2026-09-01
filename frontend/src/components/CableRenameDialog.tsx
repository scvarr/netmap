import { useState } from 'react';
import { useI18n } from '../i18n';
import type { CableLabelDataSource, CableNamingInput } from '../topology/cableLabelTypes';
import { CableNamingFields } from './CableNamingFields';
import { HistoricalCableLabelReuseDialog } from './HistoricalCableLabelReuseDialog';
import { isHistoricalCableLabelReuseConfirmationStale, isHistoricalCableLabelReuseRequired } from '../topology/historicalCableLabelReuse';

export function CableRenameDialog({ cableId, userLabel, fallback, dataSource, refresh, onClose }: { cableId: string; userLabel: string | null; fallback: string; dataSource: CableLabelDataSource; refresh: () => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const [naming, setNaming] = useState<CableNamingInput>({ cable_label: userLabel, cable_label_template_id: null, generate_cable_label: false });
  const [pending, setPending] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historicalCandidate, setHistoricalCandidate] = useState<string | null>(null);
  const manual = naming.generate_cable_label !== true;
  const normalized = (naming.cable_label ?? '').trim();
  const unchanged = manual && normalized === (userLabel ?? '') && !(!userLabel && fallback);
  const write = async (confirmedHistoricalLabel?: string) => {
    if (pending || (manual && unchanged) || (!manual && !naming.cable_label_template_id)) return;
    setPending(true); setError(null);
    try {
      if (manual) {
        if (confirmedHistoricalLabel) await dataSource.setCableLabel(cableId, normalized || null, confirmedHistoricalLabel);
        else await dataSource.setCableLabel(cableId, normalized || null);
      } else if (confirmedHistoricalLabel) await dataSource.generateCableLabel(cableId, naming.cable_label_template_id!, confirmedHistoricalLabel);
      else await dataSource.generateCableLabel(cableId, naming.cable_label_template_id!);
      try { await refresh(); onClose(); }
      catch { setRefreshFailed(true); setError(t('catalog.renameRefreshError')); }
    } catch (reason) {
      if (isHistoricalCableLabelReuseRequired(reason)) setHistoricalCandidate(reason.candidate);
      else if (confirmedHistoricalLabel && isHistoricalCableLabelReuseConfirmationStale(reason)) { setHistoricalCandidate(null); queueMicrotask(() => void write()); }
      else setError(reason instanceof Error ? reason.message : t('catalog.renameCable'));
    } finally { setPending(false); }
  };
  const retryRefresh = async () => { setPending(true); try { await refresh(); onClose(); } catch { setError(t('catalog.renameRefreshError')); } finally { setPending(false); } };
  return <><div className="catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title"><form className="catalog-dialog__surface" onSubmit={(event) => { event.preventDefault(); void write(); }}>
    <h2 id="rename-title">{t('catalog.renameCable')}</h2>
    <CableNamingFields dataSource={dataSource} disabled={pending || refreshFailed} value={naming} onChange={setNaming} variant="rename" />
    {manual && fallback && !userLabel && <small>{t('catalog.cableFallbackHint', { name: fallback })}</small>}
    {error && <p className="catalog-dialog__error" role="alert">{error}</p>}
    <div className="catalog-dialog__actions"><button type="button" onClick={onClose} disabled={pending}>{t('map.cancel')}</button>{refreshFailed ? <button type="button" onClick={() => void retryRefresh()} disabled={pending}>{t('catalog.retryRefresh')}</button> : <button type="submit" disabled={pending || unchanged || (!manual && !naming.cable_label_template_id)}>{manual ? t('catalog.save') : t('cableNaming.generate')}</button>}</div>
  </form></div>{historicalCandidate && <HistoricalCableLabelReuseDialog candidate={historicalCandidate} pending={pending} onCancel={() => setHistoricalCandidate(null)} onConfirm={() => void write(historicalCandidate)} />}</>;
}
