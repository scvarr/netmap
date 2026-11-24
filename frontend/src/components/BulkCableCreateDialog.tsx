import { usePhysicalCompatibilityConfirmation } from './PhysicalCompatibilityDialog';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { BulkPhysicalConnectionError } from '../topology/apiPhysicalEndpointConnectionWriteDataSource';
import type { CableLabelDataSource, CableLabelTemplate } from '../topology/cableLabelTypes';
import type { CreateBulkPhysicalConnectionsRequest, PhysicalEndpointConnectionWriteDataSource } from '../topology/physicalEndpointConnectionWriteTypes';
import { compatibilityReasonKeys, type PhysicalCompatibilityPreview } from '../topology/physicalCompatibility';
import type { ConnectionPointDetails, PhysicalObjectDetailsDataSource, PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import { isAvailablePhysicalPort } from '../topology/physicalPortAvailability';
import { physicalObjectIdForNode } from '../topology/projection';
import type { TopologyProjectionNode } from '../topology/types';
import { attachmentLabel, displayPointLabel } from './PhysicalObjectDetailsSection';
import { RuntimePortLabel } from './RuntimePortTypes';

interface Props {
  sourceId: string;
  nodes: TopologyProjectionNode[];
  details: PhysicalObjectDetailsDataSource;
  writer: PhysicalEndpointConnectionWriteDataSource;
  labelCatalog?: CableLabelDataSource;
  refresh: () => Promise<void>;
  close: () => void;
}

type Sort = 'ascending' | 'descending';
type Mode = 'positions' | 'free';
type Side = { panel: string | undefined; sort: Sort; memberSort: Sort; selected: string[] };
type Channel = {
  id: string;
  point: ConnectionPointDetails;
  member: number;
  label: string;
  occupied: boolean;
};
type Pair = { source: string; target: string };
const emptySide: Side = { panel: undefined, sort: 'ascending', memberSort: 'ascending', selected: [] };
const maxBatch = 256;
const pointId = (point: ConnectionPointDetails) => point.connection_point_ref.entity_id;
const channelId = (point: string, index: number) => `${point}/${index}`;
const endpoint = (channel: Channel) => ({
  kind: 'CONNECTION_POINT' as const,
  connection_point_id: pointId(channel.point),
  member_index: channel.member,
});

function usePortDetails(details: PhysicalObjectDetailsDataSource, id: string, revision: number) {
  const [result, setResult] = useState<{ id: string; revision: number; document: PhysicalObjectDetailsDocument | null }>();
  useEffect(() => {
    if (!id) return;
    let active = true;
    const finish = (document: PhysicalObjectDetailsDocument | null) => {
      if (active) setResult({ id, revision, document });
    };
    void details.loadPhysicalObjectDetails(id).then(finish, () => finish(null));
    return () => { active = false; };
  }, [details, id, revision]);
  return result?.id === id && result.revision === revision ? result.document : undefined;
}

function portList(document: PhysicalObjectDetailsDocument | null | undefined, side: Side, { t, collator }: ReturnType<typeof useI18n>) {
  const panels = [...(document?.panels ?? [])].sort((a, b) => a.panel_number - b.panel_number);
  const keys = new Set(panels.map(panel => panel.panel_key));
  const group = (point: ConnectionPointDetails) => {
    const key = point.panel_context?.panel_key ?? '';
    return keys.has(key) ? key : '';
  };
  const points = document?.connection_points ?? [];
  const options = panels.map(panel => {
    const label = [panel.display_name, panel.face && t(panel.face === 'FRONT' ? 'face.front' : 'face.rear')].filter(Boolean).join(' · ');
    const duplicate = panels.some(peer => peer.panel_key !== panel.panel_key && peer.display_name === panel.display_name && peer.face === panel.face);
    return { key: panel.panel_key, label: duplicate ? `${label} · #${panel.panel_number}` : label };
  });
  if (!options.length || points.some(point => !group(point))) options.push({ key: '', label: t('physical.unassignedPanel') });
  const panel = options.find(item => item.key === side.panel) ?? options[0];
  const groups = points.filter(point => group(point) === panel.key).map(point => ({
    point, id: pointId(point), label: displayPointLabel(point, t('physical.port')),
  })).sort((a, b) => {
    const direction = side.sort === 'ascending' ? 1 : -1;
    return direction * (collator.compare(a.label, b.label) || a.id.localeCompare(b.id));
  }).map(group => {
    const { point, id, label } = group;
    const members = point.members ?? Array.from({ length: point.cardinality }, (_, offset) => ({
      index: offset + 1, designation: String(offset + 1),
      occupied: point.cardinality === 1
        ? !isAvailablePhysicalPort(point)
        : point.external_physical_attachments?.some(link => link.local_member_index === offset + 1) ?? false,
    }));
    const channels: Channel[] = members.map(member => ({
      id: channelId(id, member.index), point, member: member.index, occupied: member.occupied,
      label: point.cardinality === 1 ? label : `${label} · ${member.designation}`,
    }));
    return { ...group, channels: side.memberSort === 'descending' ? channels.reverse() : channels };
  });
  const rows = groups.flatMap(group => group.channels);
  const byId = new Map(rows.map(row => [row.id, row]));
  const labels = new Map(rows.map(row => [
    row.id, [document?.physical_object.label, panel.label,
      row.point.cardinality === 1 && row.point.members?.length
        ? `${row.label} · ${row.point.members[0].designation}` : row.label,
    ].join(' / '),
  ]));
  const selectedIds = new Set(side.selected);
  return { options, panel, groups, rows, labels, byId, selectedIds };
}

type PortList = ReturnType<typeof portList>;

function RangeSelection({ list, mode, count, select }: {
  list: PortList;
  mode: Mode;
  count?: number;
  select: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const [unit, setUnit] = useState<'channels' | 'points'>('channels');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const entries = unit === 'channels'
    ? list.rows.map(row => ({ id: row.id, label: row.label, channels: [row] }))
    : list.groups;
  const first = entries.findIndex(entry => entry.id === start);
  const last = entries.findIndex(entry => entry.id === end);
  const available = (rows: Channel[]) => rows.filter(row => mode === 'positions' || !row.occupied);
  const fromStart = count !== undefined && unit === 'channels' && !end;
  const rows = first < 0 ? [] : fromStart
    ? available(list.rows.slice(first)).slice(0, count)
    : last < first ? [] : available(entries.slice(first, last + 1).flatMap(entry => entry.channels));
  const incomplete = fromStart && first >= 0 && count > rows.length;
  const emptyRange = first >= 0 && last >= first && rows.length === 0;
  return <div className="map-dialog__actions bulk-create-controls">
    <label>{t('map.bulk.range')}
      <select value={unit} onChange={event => {
        setUnit(event.target.value === 'points' ? 'points' : 'channels');
        setStart('');
        setEnd('');
      }}>
        <option value="channels">{t('map.bulk.rangeChannels')}</option>
        <option value="points">{t('map.bulk.rangePoints')}</option>
      </select>
    </label>
    <label>{t('map.bulk.rangeStart')}
      <select value={start} onChange={event => setStart(event.target.value)}>
        <option value="">—</option>
        {entries.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
    </label>
    <label>{t('map.bulk.rangeEnd')}
      <select value={end} onChange={event => setEnd(event.target.value)}>
        <option value="">{count !== undefined && unit === 'channels' ? t('map.bulk.bySourceCount') : '—'}</option>
        {entries.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
    </label>
    <button type="button" disabled={!rows.length || incomplete} onClick={() => select(rows.map(row => row.id))}>
      {t('map.bulk.applyRange')}
    </button>
    {(incomplete || emptyRange) && <span role="status">{t('map.bulk.notEnoughChannels')}</span>}
    {first >= 0 && last >= 0 && last < first && <span role="status">{t('map.bulk.reversedRange')}</span>}
  </div>;
}

function PortTable({ title, id, document, side, list, mode, count, change, retry }: {
  title: string;
  id: string;
  document: ReturnType<typeof usePortDetails>;
  side: Side;
  list: PortList;
  mode: Mode;
  count?: number;
  change: (patch: Partial<Side>) => void;
  retry: () => void;
}) {
  const { t } = useI18n();
  if (!id) return null;
  const setSelected = (rows: Channel[], checked: boolean) => {
    const next = new Set(side.selected);
    for (const row of rows) {
      if (checked) next.add(row.id);
      else next.delete(row.id);
    }
    change({ selected: [...next] });
  };
  const allPositions = mode === 'positions' && list.rows.some(row => row.occupied);
  const selectedFree = list.rows.filter(row => !row.occupied && list.selectedIds.has(row.id)).length;
  return <section aria-label={title}>
    <h3>{title}{document && ` · ${document.physical_object.label}`}</h3>
    {document === undefined && <p role="status">{t('physical.loading')}</p>}
    {document === null && <>
      <p role="alert">{t('map.bulk.loadFailed')}</p>
      <button type="button" onClick={retry}>{t('action.retry')}</button>
    </>}
    {document && <>
      <div className="map-dialog__actions bulk-create-controls">
        <label>{t('physical.panel')}
          <select value={list.panel.key} onChange={event => change({ panel: event.target.value, selected: [] })}>
            {list.options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>
        <label>{t('map.bulk.pointOrder')}
          <select value={side.sort} onChange={event => change({ sort: event.target.value as Sort })}>
            <option value="ascending">{t('map.bulk.ascending')}</option>
            <option value="descending">{t('map.bulk.descending')}</option>
          </select>
        </label>
        {list.groups.some(group => group.point.cardinality > 1) && <label>{t('map.bulk.memberOrder')}
          <select value={side.memberSort} onChange={event => change({ memberSort: event.target.value as Sort })}>
            <option value="ascending">{t('map.bulk.ascending')}</option>
            <option value="descending">{t('map.bulk.descending')}</option>
          </select>
        </label>}
      </div>
      {list.rows.length ? <>
        <RangeSelection key={JSON.stringify([list.panel.key, side.sort, side.memberSort, mode])}
          list={list} mode={mode} count={count} select={selected => change({ selected })} />
        <div className="map-dialog__actions bulk-create-controls">
          <button type="button" disabled={!allPositions && !list.rows.some(row => !row.occupied)}
            onClick={() => change({ selected: list.rows.filter(row => allPositions || !row.occupied).map(row => row.id) })}>
            {t(allPositions ? 'map.bulk.selectPositions' : 'map.bulk.selectFree')}
          </button>
          <button type="button" disabled={!side.selected.length} onClick={() => change({ selected: [] })}>{t('blueprint.links.clearSelection')}</button>
        </div>
        <p>{t('map.bulk.selected', { count: selectedFree })}
          {mode === 'positions' && side.selected.length > selectedFree &&
            ` · ${t('map.bulk.occupiedPositions', { count: side.selected.length - selectedFree })}`}
        </p>
        <div className="catalog-table-wrap map-dialog-table bulk-create-ports">
          <table className="catalog-table">
            <thead><tr>
              <th scope="col">{t('map.bulkDelete.selected')}</th>
              <th scope="col" aria-sort={side.sort}>{t('physical.port')}</th>
              <th scope="col">{t('physical.status')}</th>
              <th scope="col">{t('physical.externalConnection')}</th>
            </tr></thead>
            {list.groups.map(group => {
              const free = group.channels.filter(row => !row.occupied);
              const selected = free.filter(row => list.selectedIds.has(row.id)).length;
              return <tbody key={group.id}>
                {group.point.cardinality > 1 && <tr>
                  <td><input type="checkbox" aria-label={t('map.bulk.selectGroup', { name: group.label })}
                    disabled={!free.length}
                    checked={free.length > 0 && selected === free.length}
                    ref={input => { if (input) input.indeterminate = selected > 0 && selected < free.length; }}
                    onChange={event => setSelected(mode === 'positions' ? group.channels : free, event.target.checked)} /></td>
                  <th scope="rowgroup" colSpan={3}><RuntimePortLabel point={group.point} label={group.label} /></th>
                </tr>}
                {group.channels.map(row => <tr key={row.id}>
                  <td><input type="checkbox" aria-label={row.label} disabled={row.occupied}
                    checked={list.selectedIds.has(row.id)}
                    onChange={event => setSelected([row], event.target.checked)} /></td>
                  <td><RuntimePortLabel point={row.point} label={row.label} /></td>
                  <td>{t(row.occupied ? 'physical.connected' : 'physical.free')}</td>
                  <td>{row.point.external_physical_attachments?.filter(attachment =>
                    attachment.local_member_index === row.member || row.point.cardinality === 1,
                  ).map((attachment, index) =>
                    <div key={`${attachment.connection_ref.entity_id}/${index}`}>{attachmentLabel(attachment, t)}</div>,
                  )}{!row.occupied && '—'}</td>
                </tr>)}
              </tbody>;
            })}
          </table>
        </div>
      </> : <p role="status">{t('physical.noPoints')}</p>}
    </>}
  </section>;
}

function BulkCompatibilitySummary({ preview }: { preview: PhysicalCompatibilityPreview }) {
  const { t } = useI18n();
  const [pair, setPair] = useState<number>();
  const reasons = new Map<keyof typeof compatibilityReasonKeys, number>();
  for (const result of preview.pairs) {
    if (result.verdict === 'ALLOW') continue;
    for (const reason of result.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return <section className="bulk-create-compatibility" aria-label={t('map.bulk.compatibility')}>
    <p role={preview.verdict === 'DENY' ? 'alert' : 'status'}><strong>
      {t('map.bulk.verdict', { verdict: preview.verdict })}
    </strong></p>
    {reasons.size > 0 &&
      <ul className="bulk-create-reasons">{[...reasons].map(([reason, counts]) => <li key={reason}>
        {t('map.bulk.reasonCount', { reason: t(compatibilityReasonKeys[reason]), pairs: counts })}
      </li>)}</ul>}
      <details>
        <summary>{t('map.bulk.compatibilityDetails')}</summary>
        <label>{t('map.bulk.detailPair')}
          <select value={pair ?? ''} onChange={event => setPair(Number(event.target.value) || undefined)}>
            <option value="">{t('map.bulk.allPairs')}</option>
            {preview.pairs.map(result => <option key={result.pair} value={result.pair}>{result.pair}</option>)}
          </select>
        </label>
        <div className="bulk-create-detail-scroll" role="region" aria-label={t('map.bulk.compatibilityDetails')} tabIndex={0}>
          <ul>{preview.pairs.filter(result => pair === undefined || result.pair === pair).map(result =>
            <li key={result.pair}>{t('compatibility.pair', {
              pair: result.pair, verdict: result.verdict,
              reasons: result.reasons.map(reason => t(compatibilityReasonKeys[reason])).join(', '),
            })}</li>,
          )}</ul>
        </div>
      </details>
  </section>;
}

export function BulkCableCreateDialog({ sourceId, nodes, details, writer, labelCatalog, refresh, close }: Props) {
  const i18n = useI18n();
  const { t, collator } = i18n;
  const [targetId, setTargetId] = useState('');
  const [targetVersion, setTargetVersion] = useState(0);
  const [source, setSource] = useState(emptySide);
  const [target, setTarget] = useState(emptySide);
  const [mode, setMode] = useState<Mode>('positions');
  const [revision, setRevision] = useState(0);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [stage, setStage] = useState<'select' | 'pairs' | 'preview' | 'refresh-failed'>('select');
  const [templates, setTemplates] = useState<CableLabelTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [occupiedSincePreview, setOccupiedSincePreview] = useState<string[]>([]);
  const [compatibilityReview, setCompatibilityReview] = useState<{
    requestKey: string; preview: PhysicalCompatibilityPreview;
  }>();
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const pairTable = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stage === 'pairs' || stage === 'preview') pairTable.current?.focus();
  }, [stage]);
  const sourceDetails = usePortDetails(details, sourceId, revision);
  const targetDetails = usePortDetails(details, targetId, revision + targetVersion);
  const left = portList(sourceDetails, source, i18n);
  const right = portList(targetDetails, target, i18n);
  const sequence = (list: PortList) => list.rows.filter(row =>
    list.selectedIds.has(row.id) && (mode === 'positions' || !row.occupied),
  );
  const sources = sequence(left);
  const targets = sequence(right);
  const channelOccupied = (list: PortList, id: string) =>
    list.byId.get(id)?.occupied || occupiedSincePreview.includes(id);
  const occupied = (pair: Pair) => channelOccupied(left, pair.source) || channelOccupied(right, pair.target);
  const hasOccupied = pairs.some(occupied);
  const destinations = nodes.flatMap(node => {
    const id = physicalObjectIdForNode(node);
    return id && id !== sourceId ? [{ id, label: node.label }] : [];
  }).sort((a, b) => collator.compare(a.label, b.label) || a.id.localeCompare(b.id));

  const changeSide = (side: 'source' | 'target', patch: Partial<Side>) => {
    const setSide = side === 'source' ? setSource : setTarget;
    setSide(current => ({ ...current, ...patch }));
    if (patch.panel !== undefined) setPairs([]);
  };
  const reload = () => {
    setPairs([]);
    setSource(current => ({ ...current, selected: [] }));
    setTarget(current => ({ ...current, selected: [] }));
    setConflict(false);
    setOccupiedSincePreview([]);
    setError(null);
    setCompatibilityReview(undefined);
    setStage('select');
    setRevision(value => value + 1);
  };
  const match = () => {
    setPairs(sources.map((row, index) => ({ source: row.id, target: targets[index].id })));
    setStage('pairs');
  };
  const editPairs = () => {
    setCompatibilityReview(undefined);
    setError(null);
    setStage('pairs');
  };
  const changeTarget = (sourceId: string, targetId: string) => {
    const previous = pairs.find(pair => pair.source === sourceId)?.target;
    const destination = right.byId.get(targetId);
    if (previous === undefined || !destination || destination.occupied) return;
    if (right.byId.get(previous)?.occupied && pairs.some(pair => pair.target === targetId)) return;
    setPairs(current => current.map(pair => {
      if (pair.source === sourceId) return { ...pair, target: targetId };
      return pair.target === targetId ? { ...pair, target: previous } : pair;
    }));
  };
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
  const openPreview = () => run(async () => {
    setTemplateId('');
    setLabels([]);
    setCompatibilityReview(undefined);
    setError(null);
    setStage('preview');
    if (!labelCatalog || !writer.previewBulkCableLabels) return;
    setTemplates([]);
    try { setTemplates((await labelCatalog.loadCableLabelTemplates()).templates); }
    catch { setError(t('map.bulk.templatesFailed')); }
  });
  const previewLabels = async (id: string) => {
    setTemplateId(id);
    setLabels([]);
    if (!id || !writer.previewBulkCableLabels) return;
    try { setLabels((await writer.previewBulkCableLabels(id, pairs.length)).labels); }
    catch { setError(t('map.bulk.previewFailed')); }
  };
  const refreshAfterCreate = async () => {
    try { await refresh(); close(); }
    catch { setStage('refresh-failed'); }
  };
  const multichannel = pairs.some(pair =>
    (left.byId.get(pair.source)?.point.cardinality ?? 1) > 1 ||
    (right.byId.get(pair.target)?.point.cardinality ?? 1) > 1,
  );
  const ready = pairs.length > 0 && !hasOccupied && !conflict &&
    (!multichannel || Boolean(writer.previewBulkPhysicalConnections)) && (!templateId || labels.length === pairs.length);
  const request: CreateBulkPhysicalConnectionsRequest = {
    pairs: pairs.flatMap(pair => {
      const from = left.byId.get(pair.source);
      const to = right.byId.get(pair.target);
      return from && to ? [{ source: endpoint(from), target: endpoint(to) }] : [];
    }),
    template_id: templateId || null,
    expected_generated_labels: labels,
  };
  const requestKey = JSON.stringify(request);
  const review = compatibilityReview?.requestKey === requestKey ? compatibilityReview : undefined;
  const canCreate = ready && request.pairs.length === pairs.length && review?.preview.verdict !== 'DENY';
  const { confirm, confirmationDialog } = usePhysicalCompatibilityConfirmation();
  const submit = () => run(async () => {
    if (stage !== 'preview' || !canCreate || !writer.createBulkPhysicalConnections) return;
    setError(null);
    try {
      let operation = request;
      if (writer.previewBulkPhysicalConnections && !review) {
        const preview = await writer.previewBulkPhysicalConnections(request);
        setCompatibilityReview({ requestKey, preview });
        return;
      }
      if (review) {
        const compatibility = await confirm(review.preview);
        if (!compatibility) return;
        operation = { ...request, compatibility };
      }
      setSubmitting(true);
      await writer.createBulkPhysicalConnections(operation);
      await refreshAfterCreate();
    } catch (reason) {
      setCompatibilityReview(undefined);
      if (reason instanceof BulkPhysicalConnectionError && templateId &&
        reason.reason === 'BULK_LABEL_PREVIEW_STALE') {
        setError(t('map.bulk.stale'));
        await previewLabels(templateId);
      } else if (reason instanceof BulkPhysicalConnectionError &&
        ['PHYSICAL_COMPATIBILITY_STALE', 'PHYSICAL_COMPATIBILITY_DENIED'].includes(reason.reason ?? '')) {
        setError(t('map.bulk.compatibilityStale'));
      } else if (reason instanceof BulkPhysicalConnectionError && [400, 404, 409, 422].includes(reason.status)) {
        setConflict(true);
        setOccupiedSincePreview(reason.members.map(member => channelId(member.connection_point_id, member.member_index)));
        setError(t('map.bulk.conflict'));
      } else {
        setError(t('map.connectFailed'));
      }
      return;
    } finally {
      setSubmitting(false);
    }
  });

  const selecting = stage === 'select';
  const pairing = stage === 'pairs';
  const unequal = sources.length !== targets.length;
  const overLimit = sources.length > maxBatch || targets.length > maxBatch;
  return <section className="map-dialog" role="dialog" aria-modal="true" aria-label={t('map.bulk.action')} aria-busy={busy}
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (!busy && stage !== 'refresh-failed') close();
    }}>
    <div className="map-dialog__surface map-dialog__surface--bulk-create">
      <h2>{t('map.bulk.action')}</h2>
      {stage === 'refresh-failed' ? <>
        <p role="alert">{t('map.bulk.refreshFailed')}</p>
        <button type="button" disabled={busy} onClick={() => void run(refreshAfterCreate)}>{t('map.retryRefresh')}</button>
      </> : <>
        {selecting && <>
          <label className="physical-panel-picker">{t('connect.targetObject')}
            <select autoFocus value={targetId} onChange={event => {
              setTargetId(event.target.value);
              setTargetVersion(version => version + 1);
              setTarget({ ...emptySide, sort: target.sort, memberSort: target.memberSort });
              setPairs([]);
            }}>
              <option value="">{t(destinations.length ? 'connect.selectObject' : 'map.bulk.noTargets')}</option>
              {destinations.map(object => <option key={object.id} value={object.id}>{object.label}</option>)}
            </select>
          </label>
          <label className="physical-panel-picker">{t('map.bulk.matchMode')}
            <select value={mode} onChange={event => {
              setMode(event.target.value === 'free' ? 'free' : 'positions');
              setSource(current => ({ ...current, selected: [] }));
              setTarget(current => ({ ...current, selected: [] }));
            }}>
              <option value="positions">{t('map.bulk.byPositions')}</option>
              <option value="free">{t('map.bulk.byFree')}</option>
            </select>
          </label>
          <p>{t(mode === 'positions' ? 'map.bulk.positionsHelp' : 'map.bulk.freeHelp')}</p>
          <div className="endpoint-workspace__columns">
            <PortTable title={t('map.bulk.source')} id={sourceId} document={sourceDetails} side={source} list={left} mode={mode}
              change={patch => changeSide('source', patch)} retry={reload} />
            <PortTable title={t('map.bulk.destination')} id={targetId} document={targetDetails} side={target} list={right} mode={mode} count={sources.length}
              change={patch => changeSide('target', patch)} retry={reload} />
          </div>
          {unequal && <p role="status">{t('map.bulk.unequal')}</p>}
          {overLimit && <p role="status">{t('map.bulk.limit', { count: maxBatch })}</p>}
        </>}
        {!selecting && <>
          <h3>{t(pairing ? 'map.bulk.pairs' : 'map.bulk.preview', { count: pairs.length })}</h3>
          {pairing && <p>{t('map.bulk.adjust')}</p>}
          {pairing && hasOccupied && <p role="alert">{t('map.bulk.resolveOccupied')}</p>}
          <div className="catalog-table-wrap map-dialog-table bulk-create-pairs" ref={pairTable} tabIndex={0}
            role="region" aria-label={t('map.bulk.pairs', { count: pairs.length })}>
            <table className="catalog-table">
              <thead><tr>
                <th scope="col" className="bulk-create-pair-number">{t('map.bulk.detailPair')}</th>
                <th scope="col">{t('map.bulk.source')}</th>
                <th scope="col">{t('map.bulk.destination')}</th>
                <th scope="col">{t(pairing ? 'physical.actions' : 'physical.cable')}</th>
              </tr></thead>
              <tbody>{pairs.map((pair, index) => <tr key={pair.source}>
                <td>{index + 1}</td>
                <td>{left.labels.get(pair.source)}
                  {channelOccupied(left, pair.source) && <div>{t('map.bulk.occupiedChannel')}</div>}
                </td>
                <td>{pairing
                  ? <select aria-label={t('map.bulk.destinationFor', { name: left.labels.get(pair.source) ?? '' })}
                      value={pair.target} disabled={channelOccupied(left, pair.source)} onChange={event => changeTarget(pair.source, event.target.value)}>
                    {right.byId.get(pair.target)?.occupied && <option value={pair.target} disabled>
                      {right.labels.get(pair.target)} · {t('map.bulk.occupiedChannel')}
                    </option>}
                    {right.rows.filter(row => !row.occupied).map(row => <option key={row.id} value={row.id}
                      disabled={right.byId.get(pair.target)?.occupied && pairs.some(item => item.target === row.id)}>
                      {right.labels.get(row.id)}
                    </option>)}
                  </select>
                  : <>{right.labels.get(pair.target)}
                    {channelOccupied(right, pair.target) && <div>{t('map.bulk.occupiedChannel')}</div>}
                  </>}</td>
                <td>{pairing
                  ? <button type="button" onClick={() => setPairs(current => current.filter(item => item.source !== pair.source))}>
                    {t('map.bulk.exclude')}
                  </button>
                  : labels[index] ?? (templateId ? 'вЂ”' : t('map.bulk.noNames'))}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </>}
        {stage === 'preview' && <>
          <div className="bulk-create-options">
            {labelCatalog && writer.previewBulkCableLabels && <label className="physical-panel-picker">{t('map.bulk.naming')}
              <select value={templateId} disabled={busy || conflict} onChange={event => {
                const id = event.target.value;
                void run(async () => { setError(null); setCompatibilityReview(undefined); await previewLabels(id); });
              }}>
                <option value="">{t('map.bulk.noNames')}</option>
                {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>}
          </div>
          {multichannel && !writer.previewBulkPhysicalConnections && <p role="alert">{t('map.bulk.previewUnavailable')}</p>}
          {review && <BulkCompatibilitySummary key={requestKey} preview={review.preview} />}
        </>}
        {busy && <p role="status">{t(submitting ? 'connect.connecting' : 'object.loading')}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="map-dialog__actions">
          <button type="button" disabled={busy} onClick={close}>{t('map.cancel')}</button>
          {selecting
            ? <button type="button" disabled={unequal || overLimit || !sources.length || busy} onClick={match}>{t('map.bulk.match')}</button>
            : pairing
              ? <>
                <button type="button" onClick={() => setStage('select')}>{t('map.bulk.backToPorts')}</button>
                <button type="button" disabled={!pairs.length || hasOccupied} onClick={() => void openPreview()}>{t('map.bulk.review')}</button>
              </>
            : conflict
              ? <button type="button" disabled={busy} onClick={reload}>{t('map.retryRefresh')}</button>
              : <>
                <button type="button" disabled={busy} onClick={editPairs}>{t('map.back')}</button>
                <button type="button" disabled={busy || !canCreate} onClick={() => void submit()}>
                  {t(writer.previewBulkPhysicalConnections && !review ? 'map.bulk.checkCompatibility' : 'map.bulk.create')}
                </button>
              </>}
        </div>
      </>}
    </div>
    {confirmationDialog}
  </section>;
}
