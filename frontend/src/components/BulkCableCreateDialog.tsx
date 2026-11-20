import { CableSpecificationFields } from "./CableSpecificationFields";
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { BulkPhysicalConnectionError } from '../topology/apiPhysicalEndpointConnectionWriteDataSource';
import type { CableLabelDataSource, CableLabelTemplate } from '../topology/cableLabelTypes';
import type { CableSpecification, CreateBulkPhysicalConnectionsRequest, PhysicalEndpointConnectionWriteDataSource } from '../topology/physicalEndpointConnectionWriteTypes';
import { compatibilityReasons, type PhysicalCompatibilityPreview } from '../topology/physicalCompatibility';
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
type Side = { panel: string | undefined; sort: Sort; selected: string[] };
type Pair = { source: string; target: string };
type Labels = { label: string; historical: boolean }[];
const emptySide: Side = { panel: undefined, sort: 'ascending', selected: [] };
const maxBatch = 256;
const pointId = (point: ConnectionPointDetails) => point.connection_point_ref.entity_id;
const endpoint = (connection_point_id: string) => ({ kind: 'CONNECTION_POINT' as const, connection_point_id, member_index: 1 as const });

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
  const rows = points.filter(point => group(point) === panel.key).map(point => ({
    point, id: pointId(point), label: displayPointLabel(point, t('physical.port')),
    available: isAvailablePhysicalPort(point),
  })).sort((a, b) => {
    const direction = side.sort === 'ascending' ? 1 : -1;
    return direction * collator.compare(a.label, b.label) || a.id.localeCompare(b.id);
  });
  const labels = new Map(rows.map(row => [
    row.id, [document?.physical_object.label, panel.label, row.label].join(' / '),
  ]));
  return { options, panel, rows, labels, selected: rows.filter(row => row.available && side.selected.includes(row.id)) };
}

function PortTable({ title, id, document, side, list, change, retry }: {
  title: string;
  id: string;
  document: ReturnType<typeof usePortDetails>;
  side: Side;
  list: ReturnType<typeof portList>;
  change: (patch: Partial<Side>) => void;
  retry: () => void;
}) {
  const { t } = useI18n();
  if (!id) return null;
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
        <label>{t('endpointWorkspace.sort')}
          <select value={side.sort} onChange={event => change({ sort: event.target.value as Sort })}>
            <option value="ascending">{t('map.bulk.ascending')}</option>
            <option value="descending">{t('map.bulk.descending')}</option>
          </select>
        </label>
      </div>
      {list.rows.length ? <>
        <div className="map-dialog__actions bulk-create-controls">
          <button type="button" disabled={!list.rows.some(row => row.available)}
            onClick={() => change({ selected: list.rows.filter(row => row.available).map(row => row.id) })}>
            {t('map.bulk.selectFree')}
          </button>
          <button type="button" disabled={!list.selected.length} onClick={() => change({ selected: [] })}>{t('blueprint.links.clearSelection')}</button>
        </div>
        <p>{t('map.bulk.selected', { count: list.selected.length })}</p>
        <div className="catalog-table-wrap map-dialog-table bulk-create-ports">
          <table className="catalog-table">
            <thead><tr>
              <th scope="col">{t('map.bulkDelete.selected')}</th>
              <th scope="col" aria-sort={side.sort}>{t('physical.port')}</th>
              <th scope="col">{t('physical.status')}</th>
              <th scope="col">{t('physical.externalConnection')}</th>
            </tr></thead>
            <tbody>{list.rows.map(row => <tr key={row.id}>
              <td><input type="checkbox" aria-label={row.label} disabled={!row.available}
                checked={row.available && side.selected.includes(row.id)}
                onChange={event => change({
                  selected: event.target.checked ? [...side.selected, row.id] : side.selected.filter(id => id !== row.id),
                })} /></td>
              <td><RuntimePortLabel point={row.point} label={row.label} /></td>
              <td>{t(row.point.external_connection_count ? 'physical.connected' : row.available ? 'physical.free' : 'map.bulk.unavailable')}</td>
              <td>{row.point.external_physical_attachments?.length
                ? row.point.external_physical_attachments.map((attachment, index) =>
                  <div key={`${attachment.connection_ref.entity_id}/${index}`}>{attachmentLabel(attachment, t)}</div>)
                : '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </> : <p role="status">{t('physical.noPoints')}</p>}
    </>}
  </section>;
}

export function BulkCableCreateDialog({ sourceId, nodes, details, writer, labelCatalog, refresh, close }: Props) {
  const i18n = useI18n();
  const { t, collator } = i18n;
  const [targetId, setTargetId] = useState('');
  const [targetVersion, setTargetVersion] = useState(0);
  const [source, setSource] = useState(emptySide);
  const [target, setTarget] = useState(emptySide);
  const [revision, setRevision] = useState(0);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [cableSpec, setCableSpec] = useState<CableSpecification>({ cable_type_id: "" });
  const [stage, setStage] = useState<'edit' | 'preview' | 'refresh-failed'>('edit');
  const [templates, setTemplates] = useState<CableLabelTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [labels, setLabels] = useState<Labels>([]);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [compatibilityReview, setCompatibilityReview] = useState<{
    requestKey: string; preview: PhysicalCompatibilityPreview; accepted: boolean;
  }>();
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const sourceDetails = usePortDetails(details, sourceId, revision);
  const targetDetails = usePortDetails(details, targetId, revision + targetVersion);
  const left = portList(sourceDetails, source, i18n);
  const right = portList(targetDetails, target, i18n);
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
    setError(null);
    setStage('edit');
    setRevision(value => value + 1);
  };
  const match = () => setPairs(left.selected.map((row, index) => ({ source: row.id, target: right.selected[index].id })));
  const changeTarget = (sourceId: string, targetId: string) => {
    const previous = pairs.find(pair => pair.source === sourceId)?.target;
    if (previous === undefined) return;
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
    setConfirmed([]);
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
    setConfirmed([]);
    if (!id || !writer.previewBulkCableLabels) return;
    try { setLabels((await writer.previewBulkCableLabels(id, pairs.length)).labels); }
    catch { setError(t('map.bulk.previewFailed')); }
  };
  const refreshAfterCreate = async () => {
    try { await refresh(); close(); }
    catch { setStage('refresh-failed'); }
  };
  const ready = Boolean(cableSpec.cable_type_id) && pairs.length > 0 && !conflict && (!templateId || labels.length === pairs.length)
    && labels.every(label => !label.historical || confirmed.includes(label.label));
  const request: CreateBulkPhysicalConnectionsRequest = {
    ...cableSpec,
    pairs: pairs.map(pair => ({ source: endpoint(pair.source), target: endpoint(pair.target) })),
    template_id: templateId || null,
    expected_generated_labels: labels.map(label => label.label),
    confirmed_historical_labels: confirmed,
  };
  const requestKey = JSON.stringify(request);
  const review = compatibilityReview?.requestKey === requestKey ? compatibilityReview : undefined;
  const canCreate = ready && review?.preview.verdict !== 'DENY' && (review?.preview.verdict !== 'UNKNOWN' || review.accepted);
  const submit = () => run(async () => {
    if (stage !== 'preview' || !canCreate || !writer.createBulkPhysicalConnections) return;
    setError(null);
    setSubmitting(true);
    try {
      let operation = request;
      if (writer.previewBulkPhysicalConnections) {
        const preview = review?.preview ?? await writer.previewBulkPhysicalConnections(request);
        if (preview.verdict === 'DENY' || (preview.verdict === 'UNKNOWN' && !review?.accepted)) {
          setCompatibilityReview({ requestKey, preview, accepted: false });
          return;
        }
        if (!preview.token) throw new Error('Missing physical compatibility token');
        operation = { ...request, compatibility: { token: preview.token, accept_unknown: preview.verdict === 'UNKNOWN' } };
      }
      await writer.createBulkPhysicalConnections(operation);
      await refreshAfterCreate();
    } catch (reason) {
      setCompatibilityReview(undefined);
      if (reason instanceof BulkPhysicalConnectionError && templateId &&
        (reason.reason === 'BULK_LABEL_PREVIEW_STALE' || reason.reason === 'HISTORICAL_CABLE_LABEL_REUSE_REQUIRED')) {
        setError(t('map.bulk.stale'));
        await previewLabels(templateId);
      } else if (reason instanceof BulkPhysicalConnectionError && [400, 404, 409, 422].includes(reason.status)) {
        setConflict(true);
        setError(t('map.bulk.conflict'));
      } else {
        setError(t('map.connectFailed'));
      }
      return;
    } finally {
      setSubmitting(false);
    }
  });

  const editing = stage === 'edit';
  const unequal = left.selected.length !== right.selected.length;
  const overLimit = left.selected.length > maxBatch || right.selected.length > maxBatch;
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
        {editing && <>
          <label className="physical-panel-picker">{t('connect.targetObject')}
            <select autoFocus value={targetId} onChange={event => {
              setTargetId(event.target.value);
              setTargetVersion(version => version + 1);
              setTarget({ ...emptySide, sort: target.sort });
              setPairs([]);
            }}>
              <option value="">{t(destinations.length ? 'connect.selectObject' : 'map.bulk.noTargets')}</option>
              {destinations.map(object => <option key={object.id} value={object.id}>{object.label}</option>)}
            </select>
          </label>
          <div className="endpoint-workspace__columns">
            <PortTable title={t('map.bulk.source')} id={sourceId} document={sourceDetails} side={source} list={left}
              change={patch => changeSide('source', patch)} retry={reload} />
            <PortTable title={t('map.bulk.destination')} id={targetId} document={targetDetails} side={target} list={right}
              change={patch => changeSide('target', patch)} retry={reload} />
          </div>
          {unequal && <p role="status">{t('map.bulk.unequal')}</p>}
          {overLimit && <p role="status">{t('map.bulk.limit', { count: maxBatch })}</p>}
          <div className="map-dialog__actions">
            <button type="button" disabled={unequal || overLimit || !left.selected.length} onClick={match}>{t('map.bulk.match')}</button>
          </div>
        </>}
        {pairs.length > 0 && <>
          <h3>{t(editing ? 'map.bulk.pairs' : 'map.bulk.preview', { count: pairs.length })}</h3>
          {editing && <p>{t('map.bulk.adjust')}</p>}
          <div className="catalog-table-wrap map-dialog-table bulk-create-pairs">
            <table className="catalog-table">
              <thead><tr>
                <th scope="col">{t('map.bulk.source')}</th>
                <th scope="col">{t('map.bulk.destination')}</th>
                <th scope="col">{t(editing ? 'physical.actions' : 'physical.cable')}</th>
              </tr></thead>
              <tbody>{pairs.map((pair, index) => <tr key={pair.source}>
                <td>{left.labels.get(pair.source)}</td>
                <td>{editing
                  ? <select aria-label={t('map.bulk.destinationFor', { name: left.labels.get(pair.source) ?? '' })}
                      value={pair.target} onChange={event => changeTarget(pair.source, event.target.value)}>
                    {right.rows.filter(row => row.available).map(row => <option key={row.id} value={row.id}>
                      {right.labels.get(row.id)}
                    </option>)}
                  </select>
                  : right.labels.get(pair.target)}</td>
                <td>{editing
                  ? <button type="button" onClick={() => setPairs(current => current.filter(item => item.source !== pair.source))}>
                    {t('map.bulk.exclude')}
                  </button>
                  : labels[index]?.label ?? (templateId ? '—' : t('map.bulk.noNames'))}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </>}
        {!editing && <CableSpecificationFields value={cableSpec}
          onChange={value => { setCompatibilityReview(undefined); setCableSpec(value); }} disabled={busy || conflict} />}
        {!editing && labelCatalog && writer.previewBulkCableLabels && <>
          <label className="physical-panel-picker">{t('map.bulk.naming')}
            <select value={templateId} disabled={busy || conflict} onChange={event => {
              const id = event.target.value;
              void run(async () => { setError(null); setCompatibilityReview(undefined); await previewLabels(id); });
            }}>
              <option value="">{t('map.bulk.noNames')}</option>
              {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>
          {labels.filter(item => item.historical).map(item => <label key={item.label}>
            <span><input type="checkbox" disabled={busy || conflict} checked={confirmed.includes(item.label)} onChange={event => {
              setCompatibilityReview(undefined);
              setConfirmed(event.target.checked ? [...confirmed, item.label] : confirmed.filter(id => id !== item.label));
            }} /> {t('map.bulk.confirmHistorical', { name: item.label })}</span>
          </label>)}
        </>}
        {!editing && review && <>
          <div role="alert">
            <p>{t(review.preview.verdict === 'DENY' ? 'compatibility.denied' : 'compatibility.unknown')}</p>
            <div className="catalog-table-wrap map-dialog-table bulk-create-pairs">
              <ul>{compatibilityReasons(review.preview, t).map(line => <li key={line}>{line}</li>)}</ul>
            </div>
          </div>
          {review.preview.verdict === 'UNKNOWN' && <label>
            <input type="checkbox" disabled={busy} checked={review.accepted}
              onChange={event => setCompatibilityReview({ ...review, accepted: event.target.checked })} />
            {t('compatibility.accept')}
          </label>}
        </>}
        {busy && <p role="status">{t(submitting ? 'connect.connecting' : 'object.loading')}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="map-dialog__actions">
          <button type="button" disabled={busy} onClick={close}>{t('map.cancel')}</button>
          {editing
            ? <button type="button" disabled={!pairs.length || busy} onClick={() => void openPreview()}>{t('map.bulk.review')}</button>
            : conflict
              ? <button type="button" disabled={busy} onClick={reload}>{t('map.retryRefresh')}</button>
              : <>
                <button type="button" disabled={busy} onClick={() => { setError(null); setStage('edit'); }}>{t('map.back')}</button>
                <button type="button" disabled={busy || !canCreate} onClick={() => void submit()}>{t('map.bulk.create')}</button>
              </>}
        </div>
      </>}
    </div>
  </section>;
}
