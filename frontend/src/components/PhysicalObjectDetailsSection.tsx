import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ConnectionPointDetails,
  PhysicalObjectDetailsDataSource,
  PhysicalObjectDetailsDocument,
} from '../topology/physicalObjectDetailsTypes';
import type { DeviceDetailsDataSource } from '../topology/deviceDetailsTypes';
import type { PhysicalEndpointConnectionWriteDataSource } from '../topology/physicalEndpointConnectionWriteTypes';
import type { PhysicalObjectClassWriteDataSource } from '../topology/physicalObjectClassWriteTypes';
import type { ProjectionSourceRef, TopologyProjectionNode } from '../topology/types';
import { physicalClassPresentation } from '../topology/presentation';
import { ConnectPhysicalEndpoint } from './ConnectPhysicalEndpoint';
import type { ConnectionPointWriteDataSource } from '../topology/connectionPointWriteTypes';
import { CreateConnectionPoint } from './CreateConnectionPoint';
import { BlueprintUpgradeApiError, type BlueprintUpgradeAnalysisDocument, type BlueprintUpgradeDataSource } from '../topology/blueprintUpgradeTypes';
import { useI18n } from '../i18n';
import type { ObjectBlueprintDataSource } from '../topology/objectBlueprintTypes';

interface PhysicalObjectDetailsSectionProps {
  node: TopologyProjectionNode;
  dataSource: PhysicalObjectDetailsDataSource;
  topologyNodes?: TopologyProjectionNode[];
  deviceDetailsDataSource?: DeviceDetailsDataSource;
  writeDataSource?: PhysicalEndpointConnectionWriteDataSource;
  classWriteDataSource?: PhysicalObjectClassWriteDataSource;
  connectionPointWriteDataSource?: ConnectionPointWriteDataSource;
  onConnected?: () => void;
  onClassUpdated?: () => void;
  onConnectionPointCreated?: () => void;
  onDocumentChange?: (document: PhysicalObjectDetailsDocument) => void;
  blueprintUpgradeDataSource?: BlueprintUpgradeDataSource;
  objectBlueprintDataSource?: ObjectBlueprintDataSource;
}

type DetailsState =
  | { kind: 'loading' }
  | { kind: 'loaded'; document: PhysicalObjectDetailsDocument }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable'; message: string };

const shortId = (value: string) => value.replace(/[{}]/g, '').slice(0, 8);

const physicalObjectIdentity = (node: TopologyProjectionNode): string | null => {
  const refs = node.source_refs.filter((ref) => (
    ref.ref_type === 'CANONICAL_FACT' && ref.entity_type === 'PhysicalObject'
  ));
  return refs.length === 1 ? refs[0].entity_id : null;
};

const displayPointLabel = (point: ConnectionPointDetails, fallback: string): string => {
  const technical = /^ConnectionPoint\s+(.+)$/i.exec(point.label.trim());
  if (point.label_source !== 'TECHNICAL_FALLBACK' && !technical) return point.label;
  return `${fallback} ${shortId(technical?.[1] ?? point.connection_point_ref.entity_id)}`;
};

const pointLabelCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const isTechnicalPointLabel = (point: ConnectionPointDetails): boolean => (
  point.label_source === 'TECHNICAL_FALLBACK'
  || /^ConnectionPoint\s+/i.test(point.label)
  || /^Точка\s+/i.test(point.label)
);

const sortedConnectionPoints = (points: ConnectionPointDetails[], fallback: string): ConnectionPointDetails[] => (
  points
    .map((point, index) => ({ point, index }))
    .sort((left, right) => (
      Number(isTechnicalPointLabel(left.point)) - Number(isTechnicalPointLabel(right.point))
      || pointLabelCollator.compare(displayPointLabel(left.point, fallback), displayPointLabel(right.point, fallback))
      || left.index - right.index
    ))
    .map(({ point }) => point)
);

const SourceRefs = ({ refs }: { refs: ProjectionSourceRef[] }) => (
  <ul className="source-refs">
    {refs.map((ref) => (
      <li key={`${ref.ref_type}-${ref.entity_type}-${ref.entity_id}`}>
        <span>{ref.entity_type}</span>
        <code>{ref.entity_id}</code>
        <small>{ref.ref_type}</small>
      </li>
    ))}
  </ul>
);

const KNOWN_CLASSES = new Set(['workstation', 'switch', 'cable', 'outlet', 'patch_panel']);

interface PhysicalObjectClassEditorProps {
  physicalObjectId: string;
  currentClass?: string;
  dataSource: PhysicalObjectClassWriteDataSource;
  onUpdated: (document: PhysicalObjectDetailsDocument) => void;
}

const PhysicalObjectClassEditor = ({
  physicalObjectId,
  currentClass,
  dataSource,
  onUpdated,
}: PhysicalObjectClassEditorProps) => {
  const { t } = useI18n();
  const initialPreset = currentClass && KNOWN_CLASSES.has(currentClass) ? currentClass : '__custom__';
  const [preset, setPreset] = useState(initialPreset);
  const [customValue, setCustomValue] = useState(
    currentClass && !KNOWN_CLASSES.has(currentClass) ? currentClass : '',
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = preset === '__custom__' ? customValue.trim() : preset;
  const unchanged = value === (currentClass ?? '');

  const submit = async () => {
    if (!value || pending || unchanged) return;
    setPending(true);
    setError(null);
    try {
      onUpdated(await dataSource.setPhysicalObjectClass(physicalObjectId, value));
    } catch {
      setError(t('physical.classSaveFailed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="physical-class-editor" aria-label={t('physical.classEditor')}>
      <h3>{t('physical.classEditor')}</h3>
      <p className="physical-class-editor__current">
        {physicalClassPresentation(currentClass).label}
        {currentClass && !KNOWN_CLASSES.has(currentClass) ? ` · ${currentClass}` : ''}
      </p>
      <label>
        <span>{t('physical.classification')}</span>
        <select
          value={preset}
          onChange={(event) => setPreset(event.target.value)}
          disabled={pending}
        >
          <option value="workstation">{t('physical.class.workstation')}</option><option value="switch">{t('physical.class.switch')}</option><option value="cable">{t('physical.class.cable')}</option><option value="outlet">{t('physical.class.outlet')}</option><option value="patch_panel">{t('physical.class.patchPanel')}</option><option value="__custom__">{t('physical.other')}</option>
        </select>
      </label>
      {preset === '__custom__' && (
        <label>
          <span>{t('physical.value')}</span>
          <input
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            disabled={pending}
            placeholder={t('physical.valueExample')}
          />
        </label>
      )}
      {error && <p className="physical-class-editor__error" role="alert">{error}</p>}
      <button type="button" onClick={() => void submit()} disabled={!value || pending || unchanged}>
        {pending ? t('physical.saving') : t('physical.saveClass')}
      </button>
    </section>
  );
};

interface PortRowProps {
  point: ConnectionPointDetails;
  topologyNodes: TopologyProjectionNode[];
  physicalDetailsDataSource: PhysicalObjectDetailsDataSource;
  deviceDetailsDataSource?: DeviceDetailsDataSource;
  writeDataSource?: PhysicalEndpointConnectionWriteDataSource;
  onConnected: () => void;
}

const attachmentLabel = (point: ConnectionPointDetails, t: ReturnType<typeof useI18n>['t']): string => {
  const attachments = point.external_physical_attachments ?? [];
  if (!attachments.length) return '—';
  return attachments.map((attachment) => {
    const remote = [attachment.remote_physical_object_label, attachment.remote_connection_point_label].filter(Boolean).join(' · ');
    return attachment.kind === 'CABLE'
      ? `${remote || t('physical.remoteEndpoint')}${attachment.cable_label ? ` · ${attachment.cable_label}` : ''}`
      : remote || t('physical.connection');
  }).join('; ');
};

const statusLabel = (point: ConnectionPointDetails, t: ReturnType<typeof useI18n>['t']): string => {
  if (point.cardinality !== 1) return t('physical.connections', { count: point.incident_connection_count, external: point.external_connection_count ?? 0 });
  return (point.external_physical_attachments ?? []).length ? t('physical.connected') : t('physical.free');
};

const interfaceLabel = (point: ConnectionPointDetails): string => (
  (point.direct_interface_bindings ?? []).map((binding) => binding.label).join(', ') || '—'
);

const canConnect = (point: ConnectionPointDetails): boolean => (
  point.cardinality === 1 && !(point.external_physical_attachments ?? []).length
);

interface PortActionProps extends Omit<PortRowProps, 'point'> { point: ConnectionPointDetails; }

const DisconnectPhysicalConnection = ({ point, writeDataSource, onDisconnected }: Pick<PortActionProps, 'point' | 'writeDataSource'> & { onDisconnected: () => void }) => {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachment = point.cardinality === 1 ? point.external_physical_attachments?.[0] : undefined;
  if (!attachment || !writeDataSource?.deleteExternalPhysicalConnection) return null;
  const disconnect = async () => {
    if (pending || !window.confirm(t('physical.disconnectConfirm', { name: displayPointLabel(point, t('physical.point', { id: '' }).trim()) }))) return;
    setPending(true);
    setError(null);
    try {
      await writeDataSource.deleteExternalPhysicalConnection!(attachment.connection_ref.entity_id);
      onDisconnected();
    } catch {
      setError(t('physical.disconnectFailed'));
    } finally {
      setPending(false);
    }
  };
  return <><button type="button" className="port-icon-action port-icon-action--danger" aria-label={t('physical.disconnect')} title={t('physical.disconnect')} disabled={pending} onClick={() => void disconnect()}>×</button>{error && <p className="port-action-error" role="alert">{error}</p>}</>;
};

const PortActions = ({ point, topologyNodes, physicalDetailsDataSource, deviceDetailsDataSource, writeDataSource, onConnected }: PortActionProps) => <>
  {canConnect(point) && deviceDetailsDataSource && writeDataSource && (
    <ConnectPhysicalEndpoint sourcePoint={point} topologyNodes={topologyNodes} physicalDetailsDataSource={physicalDetailsDataSource} deviceDetailsDataSource={deviceDetailsDataSource} writeDataSource={writeDataSource} onConnected={onConnected} />
  )}
  <DisconnectPhysicalConnection point={point} writeDataSource={writeDataSource} onDisconnected={onConnected} />
</>;

const PortRow = ({
  point,
  topologyNodes,
  physicalDetailsDataSource,
  deviceDetailsDataSource,
  writeDataSource,
  onConnected,
}: PortRowProps) => {
  const { t } = useI18n(); return <tr>
    <th scope="row">{displayPointLabel(point, t('physical.point', { id: '' }).trim())}</th>
    <td>{statusLabel(point, t)}</td><td>{attachmentLabel(point, t)}</td><td>{interfaceLabel(point)}</td>
    <td><PortActions point={point} topologyNodes={topologyNodes} physicalDetailsDataSource={physicalDetailsDataSource} deviceDetailsDataSource={deviceDetailsDataSource} writeDataSource={writeDataSource} onConnected={onConnected} /></td>
  </tr>;
};

const pairedChannels = (points: ConnectionPointDetails[]): Array<[ConnectionPointDetails, ConnectionPointDetails]> | null => {
  if (!points.length || points.some((point) => (
    (point.internal_physical_counterparts ?? []).length !== 1
    || (point.direct_interface_bindings ?? []).length > 0
    || point.blueprint_slot?.kind === 'NETWORK_PORT'
  ))) return null;
  const byId = new Map(points.map((point) => [point.connection_point_ref.entity_id, point]));
  const seen = new Set<string>(); const pairs: Array<[ConnectionPointDetails, ConnectionPointDetails]> = [];
  for (const point of points) {
    if (seen.has(point.connection_point_ref.entity_id)) continue;
    const peerId = point.internal_physical_counterparts?.[0].connection_point_ref.entity_id;
    const peer = peerId ? byId.get(peerId) : undefined;
    if (!peerId || !peer || peer.internal_physical_counterparts?.[0].connection_point_ref.entity_id !== point.connection_point_ref.entity_id) return null;
    seen.add(point.connection_point_ref.entity_id); seen.add(peerId); pairs.push([point, peer]);
  }
  return seen.size === points.length ? pairs : null;
};

const changeText = (change: { code: string; slot_key?: string; slot_keys?: string[] }, t: ReturnType<typeof useI18n>['t']) => {
  const slot = change.slot_key ?? change.slot_keys?.join(' ↔ ') ?? '';
  const key = `upgrade.${change.code}` as Parameters<typeof t>[0];
  return t(key, { slot });
};

const BlueprintUpgrade = ({ physicalObjectId, provenance, dataSource, objectBlueprintDataSource, refresh }: { physicalObjectId: string; provenance: NonNullable<PhysicalObjectDetailsDocument['blueprint_provenance']>; dataSource?: BlueprintUpgradeDataSource; objectBlueprintDataSource?: ObjectBlueprintDataSource; refresh: () => Promise<void> }) => {
  const { t } = useI18n(); const [analysis, setAnalysis] = useState<BlueprintUpgradeAnalysisDocument | null>(null); const [availability, setAvailability] = useState<'loading' | 'outdated' | 'up-to-date' | 'unavailable'>('loading'); const [targetVersion, setTargetVersion] = useState<number | null>(null); const [loading, setLoading] = useState(false); const [applying, setApplying] = useState(false); const [error, setError] = useState<string | null>(null); const [refreshFailed, setRefreshFailed] = useState(false); const [succeeded, setSucceeded] = useState(false);
  useEffect(() => { let current = true; if (!objectBlueprintDataSource) { setAvailability('unavailable'); return undefined; } void objectBlueprintDataSource.loadObjectBlueprints().then((document) => { const item = document.blueprints.find((entry) => entry.blueprint_ref.entity_id === provenance.blueprint_ref.entity_id); if (!current) return; if (!item) setAvailability('unavailable'); else { setTargetVersion(item.version_number); setAvailability(item.version_ref.entity_id === provenance.version_ref.entity_id ? 'up-to-date' : 'outdated'); } }, () => current && setAvailability('unavailable')); return () => { current = false; }; }, [objectBlueprintDataSource, provenance.blueprint_ref.entity_id, provenance.version_ref.entity_id]);
  if (!dataSource || availability === 'unavailable' || availability === 'loading') return null;
  const run = async () => { setLoading(true); setError(null); try { setAnalysis(await dataSource.analyzeBlueprintUpgrade(physicalObjectId)); } catch { setError(t('upgrade.failed')); } finally { setLoading(false); } };
  const apply = async () => {
    if (!analysis?.target_version_ref?.entity_id || applying) return;
    setApplying(true); setError(null); setRefreshFailed(false);
    try { await dataSource.applyBlueprintUpgrade?.(physicalObjectId, analysis.target_version_ref.entity_id); setSucceeded(true); try { await refresh(); } catch { setRefreshFailed(true); } }
    catch (reason) { setError(reason instanceof BlueprintUpgradeApiError && reason.status === 409 && reason.code === 'MODEL_ERROR' ? t('upgrade.conflict') : t('upgrade.applyFailed')); setAnalysis(null); }
    finally { setApplying(false); }
  };
  return <section className="blueprint-upgrade" aria-label={t('upgrade.title')}>
    {availability === 'outdated' && <p>{t('upgrade.outdated', { current: provenance.version_number, target: targetVersion ?? '?' })}</p>}
    {availability === 'up-to-date' && <p>{t('upgrade.upToDate')}</p>}
    {analysis?.status === 'MODEL_INCONSISTENT' && <p role="alert">{t('upgrade.inconsistent')}</p>}
    {availability === 'outdated' && <button type="button" onClick={() => void run()} disabled={loading}>{loading ? t('upgrade.analyzing') : t('upgrade.dryRun')}</button>}
    {error && <p role="alert">{error}</p>}
    {analysis && analysis.compatible_changes.length > 0 && <><h4>{t('upgrade.compatible')}</h4><ul>{analysis.compatible_changes.map((change, index) => <li key={`${change.code}-${change.slot_key ?? index}`}>{changeText(change, t)}</li>)}</ul></>}
    {analysis && analysis.blockers.length > 0 && <><h4>{t('upgrade.blockers')}</h4><ul>{analysis.blockers.map((change, index) => <li key={`${change.code}-${change.slot_key ?? index}`}>{changeText(change, t)}</li>)}</ul></>}
    {analysis?.status === 'OUTDATED' && analysis.blockers.length === 0 && analysis.target_version_ref && dataSource.applyBlueprintUpgrade && !succeeded && <button type="button" onClick={() => void apply()} disabled={applying}>{applying ? t('upgrade.applying') : t('upgrade.apply', { target: analysis.target_version_number ?? '?' })}</button>}
    {succeeded && <p>{t('upgrade.success')}</p>}
    {refreshFailed && <p role="alert">{t('upgrade.refreshFailed')} <button type="button" onClick={() => void refresh().then(() => setRefreshFailed(false), () => setRefreshFailed(true))}>{t('upgrade.retryRefresh')}</button></p>}
  </section>;
};

export function PhysicalObjectDetailsSection({
  node,
  dataSource,
  topologyNodes = [],
  deviceDetailsDataSource,
  writeDataSource,
  classWriteDataSource,
  connectionPointWriteDataSource,
  onConnected = () => undefined,
  onClassUpdated = () => undefined,
  onConnectionPointCreated = () => undefined,
  onDocumentChange = () => undefined,
  blueprintUpgradeDataSource,
  objectBlueprintDataSource,
}: PhysicalObjectDetailsSectionProps) {
  const { t } = useI18n();
  const physicalObjectId = physicalObjectIdentity(node);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<DetailsState>(() => (
    physicalObjectId
      ? { kind: 'loading' }
      : { kind: 'unavailable', message: t('physical.noCanonicalRef') }
  ));
  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;

  useEffect(() => {
    if (!physicalObjectId) {
      setState({
        kind: 'unavailable',
        message: t('physical.noCanonicalRef'),
      });
      return undefined;
    }
    let current = true;
    setState({ kind: 'loading' });
    void dataSource.loadPhysicalObjectDetails(physicalObjectId).then(
      (document) => {
        if (current) {
          setState({ kind: 'loaded', document });
          onDocumentChangeRef.current(document);
        }
      },
      (reason: unknown) => {
        if (current) {
          setState({
            kind: 'error',
            message: t('physical.loadFailed'),
          });
        }
      },
    );
    return () => { current = false; };
  }, [dataSource, physicalObjectId, retryKey, t]);

  return (
    <section className="physical-object-details" aria-labelledby="connection-points-heading">
      {state.kind === 'loading' && <p className="device-details-state">{t('physical.loading')}</p>}
      {state.kind === 'unavailable' && <p className="device-details-state">{state.message}</p>}
      {state.kind === 'error' && (
        <div className="device-details-state device-details-state--error">
          <p>{state.message}</p>
          <button onClick={() => setRetryKey((key) => key + 1)}>{t('action.retry')}</button>
        </div>
      )}
      {state.kind === 'loaded' && (
        <>
          <div className="physical-object-details__summary">
            <span>{t('physical.portCount', { count: state.document.connection_points.length })}</span>
            {state.document.connection_points.length > 0 && state.document.connection_points.every((point) => point.cardinality === 1 && Array.isArray(point.external_physical_attachments)) && (() => {
              const connected = state.document.connection_points.filter((point) => point.external_physical_attachments!.length > 0).length;
              return <><span>{t('physical.connectedCount', { count: connected })}</span><span>{t('physical.freeCount', { count: state.document.connection_points.length - connected })}</span></>;
            })()}
            <span>{t('physical.interfaceCount', { count: state.document.owned_interface_count })}</span>
          </div>
          {classWriteDataSource && physicalObjectId && (
            <PhysicalObjectClassEditor
              key={state.document.physical_object.class ?? 'unclassified'}
              physicalObjectId={physicalObjectId}
              currentClass={state.document.physical_object.class}
              dataSource={classWriteDataSource}
              onUpdated={(document) => {
                setState({ kind: 'loaded', document });
                onDocumentChange(document);
                onClassUpdated();
              }}
            />
          )}
          {state.document.blueprint_provenance && (
            <><p className="blueprint-provenance">{t('physical.fromBlueprint', { version: state.document.blueprint_provenance.version_number })} <Link to={`/library/object-blueprints/${state.document.blueprint_provenance.blueprint_ref.entity_id}/versions/${state.document.blueprint_provenance.version_ref.entity_id}/edit`}>{t('physical.openBlueprint')}</Link></p>{physicalObjectId && <BlueprintUpgrade physicalObjectId={physicalObjectId} provenance={state.document.blueprint_provenance} dataSource={blueprintUpgradeDataSource} objectBlueprintDataSource={objectBlueprintDataSource} refresh={async () => { const document = await dataSource.loadPhysicalObjectDetails(physicalObjectId); setState({ kind: 'loaded', document }); onDocumentChange(document); }} />}</>
          )}
          <h3 id="connection-points-heading">{t('physical.ports')} <span>{state.document.connection_points.length}</span></h3>
          {!state.document.blueprint_provenance && connectionPointWriteDataSource && physicalObjectId && (
            <div className="manual-point-action"><strong>{t('physical.manualStructure')}</strong><CreateConnectionPoint physicalObjectId={physicalObjectId} dataSource={connectionPointWriteDataSource} onCreated={(document) => { setState({ kind: 'loaded', document }); onDocumentChange(document); onConnectionPointCreated(); }} /></div>
          )}
          {state.document.connection_points.length ? (() => {
            const points = sortedConnectionPoints(state.document.connection_points, t('physical.point', { id: '' }).trim()); const channels = pairedChannels(points);
            if (channels) return <div className="ports-table-wrap"><h4>{t('physical.channels')}</h4><table className="ports-table"><thead><tr><th>{t('physical.channel')}</th><th>{t('physical.port')} A</th><th>{t('physical.connectionA')}</th><th>{t('physical.actionsA')}</th><th>{t('physical.port')} B</th><th>{t('physical.connectionB')}</th><th>{t('physical.actionsB')}</th></tr></thead><tbody>{channels.map(([left, right], index) => <tr key={left.connection_point_ref.entity_id}><th scope="row">{index + 1}</th><td>{displayPointLabel(left, t('physical.point', { id: '' }).trim())}</td><td>{attachmentLabel(left, t)}</td><td><PortActions point={left} topologyNodes={topologyNodes} physicalDetailsDataSource={dataSource} deviceDetailsDataSource={deviceDetailsDataSource} writeDataSource={writeDataSource} onConnected={() => { setRetryKey((key) => key + 1); onConnected(); }} /></td><td>{displayPointLabel(right, t('physical.point', { id: '' }).trim())}</td><td>{attachmentLabel(right, t)}</td><td><PortActions point={right} topologyNodes={topologyNodes} physicalDetailsDataSource={dataSource} deviceDetailsDataSource={deviceDetailsDataSource} writeDataSource={writeDataSource} onConnected={() => { setRetryKey((key) => key + 1); onConnected(); }} /></td></tr>)}</tbody></table></div>;
            return <div className="ports-table-wrap"><table className="ports-table"><thead><tr><th>{t('physical.port')}</th><th>{t('physical.status')}</th><th>{t('physical.connectedTo')}</th><th>{t('physical.interface')}</th><th>{t('physical.actions')}</th></tr></thead><tbody>{points.map((point) => <PortRow key={point.connection_point_ref.entity_id} point={point} topologyNodes={topologyNodes} physicalDetailsDataSource={dataSource} deviceDetailsDataSource={deviceDetailsDataSource} writeDataSource={writeDataSource} onConnected={() => { setRetryKey((key) => key + 1); onConnected(); }} />)}</tbody></table></div>;
          })() : <p className="device-details-state">{t('physical.noPoints')}</p>}
          <details className="technical-details physical-object-details__technical">
            <summary>{t('physical.objectTechnical')}</summary>
            <SourceRefs refs={[state.document.physical_object.source_ref]} />
          </details>
        </>
      )}
    </section>
  );
}
