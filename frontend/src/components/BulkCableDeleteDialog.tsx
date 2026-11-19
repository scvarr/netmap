import { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { CableDeleteRequestError } from '../topology/apiCableDeleteDataSource';
import { physicalObjectIdForNode } from '../topology/projection';
import type { CableDeleteCandidate, CableDeleteDataSource, CableDeletePair } from '../topology/cableDeleteTypes';
import type { TopologyProjectionNode } from '../topology/types';

interface Props {
  sourceId: string;
  nodes: TopologyProjectionNode[];
  preview: NonNullable<CableDeleteDataSource['previewBulkDelete']>;
  remove: NonNullable<CableDeleteDataSource['bulkDelete']>;
  refresh: () => Promise<void>;
  close: () => void;
}

const maxBatch = 256;

export function BulkCableDeleteDialog({ sourceId, nodes, preview, remove, refresh, close }: Props) {
  const { t, collator } = useI18n();
  const [targetId, setTargetId] = useState('');
  const [rows, setRows] = useState<CableDeleteCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<'choose' | 'select' | 'confirm' | 'refresh-failed'>('choose');
  const [sort, setSort] = useState<'source' | 'label'>('source');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const objects = new Map(nodes.flatMap(node => {
    const id = physicalObjectIdForNode(node);
    return id ? [[id, node] as const] : [];
  }));
  const pair: CableDeletePair = { source_object_id: sourceId, target_object_id: targetId };
  const sortedRows = [...(rows ?? [])].sort((a, b) =>
    collator.compare(sort === 'source' ? a.source_point_label : a.display_label, sort === 'source' ? b.source_point_label : b.display_label)
    || a.expected.cable_id.localeCompare(b.expected.cable_id));
  const chosen = sortedRows.filter(row => selected.has(row.expected.cable_id));
  const connectionCount = new Set(chosen.map(row => row.expected.connection_id)).size;

  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await action(); }
    finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const loadRows = () => run(async () => {
    setError(null);
    try {
      setRows((await preview(pair)).cables);
      setSelected(new Set());
      setStage('select');
    } catch {
      setError(t('map.bulkDelete.previewFailed'));
    }
  });

  const refreshAfterDelete = async () => {
    try { await refresh(); close(); }
    catch { setStage('refresh-failed'); }
  };

  const submit = () => run(async () => {
    setError(null);
    try { await remove(pair, chosen.map(row => row.expected)); }
    catch (reason) {
      if (reason instanceof CableDeleteRequestError && reason.status === 409) {
        setRows(null);
        setSelected(new Set());
        setStage('choose');
        setError(t('map.bulkDelete.conflict'));
      } else {
        setError(t('map.bulkDelete.error'));
      }
      return;
    }
    await refreshAfterDelete();
  });

  const endpoint = (row: CableDeleteCandidate, source: boolean) => {
    const pointA = source === row.source_is_point_a;
    const pointId = pointA ? row.expected.point_a_id : row.expected.point_b_id;
    const blueprint = objects.get(source ? sourceId : targetId)?.attributes.blueprint_presentation;
    const slots = blueprint?.slots.filter(slot => slot.connection_point_id === pointId);
    const face = slots?.length === 1 ? blueprint?.panels.find(panel => panel.panel_key === slots[0].panel_key)?.face : undefined;
    const label = source ? row.source_point_label : row.target_point_label;
    return <>{label}{face && <> · {t(face === 'FRONT' ? 'face.front' : 'face.rear')}</>}</>;
  };

  const confirming = stage === 'confirm';
  return <section className="map-dialog" role="dialog" aria-modal="true" aria-label={t('map.bulkDelete.title')} aria-busy={busy}>
    <div className="map-dialog__surface map-dialog__surface--bulk-delete">
      <h2>{t('map.bulkDelete.title')}</h2>
      {stage === 'refresh-failed' ? <>
        <p role="alert">{t('map.bulkDelete.refreshFailed')}</p>
        <button type="button" disabled={busy} onClick={() => void run(refreshAfterDelete)}>{t('map.retryRefresh')}</button>
      </> : <>
        <p>{objects.get(sourceId)?.label}{stage !== 'choose' && <> ↔ {objects.get(targetId)?.label}</>}</p>
        {stage === 'choose' && <label>{t('map.bulkDelete.target')}
          <select autoFocus value={targetId} disabled={busy} onChange={event => { setTargetId(event.target.value); setError(null); }}>
            <option value="">{t('map.bulkDelete.choose')}</option>
            {[...objects].filter(([id]) => id !== sourceId).sort(([idA, a], [idB, b]) => collator.compare(a.label, b.label) || idA.localeCompare(idB))
              .map(([id, node]) => <option key={id} value={id}>{node.label}</option>)}
          </select>
        </label>}
        {stage === 'select' && !sortedRows.length && <p role="status">{t('map.bulkDelete.empty')}</p>}
        {stage === 'select' && sortedRows.length > 0 && <div className="map-dialog__actions">
          <button type="button" onClick={() => setSelected(new Set(sortedRows.map(row => row.expected.cable_id)))}>{t('map.bulkDelete.selectAll')}</button>
          <button type="button" disabled={!chosen.length} onClick={() => setSelected(new Set())}>{t('map.bulkDelete.clear')}</button>
        </div>}
        {chosen.length > maxBatch && <p role="alert">{t('map.bulkDelete.limit', { count: maxBatch })}</p>}
        {confirming && <p role="status">{t('map.bulkDelete.summary', { cables: chosen.length, connections: connectionCount })}</p>}
        {stage !== 'choose' && sortedRows.length > 0 && <div className="catalog-table-wrap map-dialog-table">
          <table className="catalog-table">
            <thead><tr>
              {!confirming && <th scope="col">{t('map.bulkDelete.selected')}</th>}
              <th scope="col" aria-sort={sort === 'label' ? 'ascending' : 'none'}>
                <button type="button" disabled={busy} onClick={() => setSort('label')}>{t('map.bulkDelete.cable')}</button>
              </th>
              <th scope="col" aria-sort={sort === 'source' ? 'ascending' : 'none'}>
                <button type="button" disabled={busy} onClick={() => setSort('source')}>{t('map.bulkDelete.source')}</button>
              </th>
              <th scope="col">{t('map.bulkDelete.destination')}</th>
            </tr></thead>
            <tbody>{(confirming ? chosen : sortedRows).map(row => {
              const id = row.expected.cable_id;
              return <tr key={id}>
                {!confirming && <td><input type="checkbox" aria-label={`${row.display_label} · ${row.source_point_label} ↔ ${row.target_point_label}`}
                  checked={selected.has(id)} onChange={event => {
                    const checked = event.target.checked;
                    setSelected(current => {
                      const next = new Set(current);
                      if (checked) next.add(id);
                      else next.delete(id);
                      return next;
                    });
                  }} /></td>}
                <td>{row.display_label}</td><td>{endpoint(row, true)}</td><td>{endpoint(row, false)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        {error && <p role="alert">{error}</p>}
        <div className="map-dialog__actions">
          <button type="button" disabled={busy} onClick={close}>{t('map.cancel')}</button>
          {stage === 'choose' && <button type="button" disabled={busy || !targetId} onClick={() => void loadRows()}>{t('map.bulkDelete.load')}</button>}
          {stage === 'select' && <>
            <button type="button" onClick={() => { setRows(null); setSelected(new Set()); setStage('choose'); }}>{t('map.back')}</button>
            <button type="button" disabled={!chosen.length || chosen.length > maxBatch} onClick={() => setStage('confirm')}>{t('map.bulkDelete.review')}</button>
          </>}
          {confirming && <>
            <button type="button" disabled={busy} onClick={() => { setError(null); setStage('select'); }}>{t('map.back')}</button>
            <button type="button" disabled={busy} onClick={() => void submit()}>{t('map.bulkDelete.confirm')}</button>
          </>}
        </div>
      </>}
    </div>
  </section>;
}
