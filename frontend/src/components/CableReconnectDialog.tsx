import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { CableReconnectError, type CableEnd, type CableReconnectDataSource, type CableReconnectSnapshot } from '../topology/apiCableReconnectDataSource';
import type { ConnectionPointDetails, PhysicalObjectDetailsDataSource, PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import { displayPointLabel, sortedConnectionPoints } from './PhysicalObjectDetailsSection';

interface Props {
  cableId: string;
  objects: { id: string; label: string }[];
  details: PhysicalObjectDetailsDataSource;
  writer: CableReconnectDataSource;
  refresh: () => Promise<void>;
  close: () => void;
}

const pointId = (point: ConnectionPointDetails) => point.connection_point_ref.entity_id;
const panelKey = (point: ConnectionPointDetails) => point.panel_context?.panel_key ?? '';

export function CableReconnectDialog({ cableId, objects, details, writer, refresh, close }: Props) {
  const { t } = useI18n();
  const [current, setCurrent] = useState<{ snapshot: CableReconnectSnapshot; ends: [string, string] }>();
  const [side, setSide] = useState<CableEnd>('A');
  const [objectId, setObjectId] = useState('');
  const [target, setTarget] = useState<PhysicalObjectDetailsDocument>();
  const [panel, setPanel] = useState<string>();
  const [port, setPort] = useState('');
  const [step, setStep] = useState<'edit' | 'review' | 'writing' | 'refreshing' | 'refresh-failed' | 'conflict'>('edit');
  const [error, setError] = useState<'load' | 'target' | 'write' | 'unsupported'>();
  const [retry, setRetry] = useState(0);

  const panels = (document: PhysicalObjectDetailsDocument) => {
    const options = (document.panels ?? []).map(item => {
      const face = item.face && t(item.face === 'FRONT' ? 'face.front' : 'face.rear');
      const duplicate = document.panels?.some(other =>
        other.panel_key !== item.panel_key && other.display_name === item.display_name && other.face === item.face);
      return {
        key: item.panel_key,
        label: [item.display_name, face, duplicate && `#${item.panel_number}`].filter(Boolean).join(' · '),
      };
    });
    if (document.connection_points.some(point => !panelKey(point))) {
      options.push({ key: '', label: t('physical.unassignedPanel') });
    }
    return options;
  };

  const endpoint = (document: PhysicalObjectDetailsDocument, point: ConnectionPointDetails) => [
    document.physical_object.label,
    panels(document).find(item => item.key === panelKey(point))?.label ?? point.panel_context?.panel_name ?? t('physical.unassignedPanel'),
    displayPointLabel(point, t('physical.port')),
  ].join(' / ');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const snapshot = await writer.preview(cableId);
        const [a, b] = await Promise.all([
          details.loadPhysicalObjectDetails(snapshot.object_a_id),
          details.loadPhysicalObjectDetails(snapshot.object_b_id),
        ]);
        const pointA = a.connection_points.find(point => pointId(point) === snapshot.expected.point_a_id);
        const pointB = b.connection_points.find(point => pointId(point) === snapshot.expected.point_b_id);
        if (!active) return;
        if (!pointA || !pointB) {
          setStep('conflict');
          return;
        }
        setCurrent({ snapshot, ends: [endpoint(a, pointA), endpoint(b, pointB)] });
      } catch (reason) {
        if (!active) return;
        if (reason instanceof CableReconnectError && reason.status === 409) setStep('conflict');
        else setError(reason instanceof CableReconnectError && reason.status === 422 ? 'unsupported' : 'load');
      }
    };
    void load();
    return () => { active = false; };
  }, [cableId, details, writer, t, retry]);

  useEffect(() => {
    if (!objectId) return;
    let active = true;
    void details.loadPhysicalObjectDetails(objectId).then(
      document => { if (active) setTarget(document); },
      () => { if (active) setError('target'); },
    );
    return () => { active = false; };
  }, [objectId, details, retry]);

  const refreshMap = async () => {
    setStep('refreshing');
    try {
      await refresh();
      close();
    } catch {
      setStep('refresh-failed');
    }
  };

  const reloadConnection = () => {
    setCurrent(undefined);
    setSide('A');
    setObjectId('');
    setTarget(undefined);
    setPanel(undefined);
    setPort('');
    setError(undefined);
    setStep('edit');
    setRetry(value => value + 1);
  };

  const options = target ? panels(target) : [];
  const selectedPanel = panel ?? options[0]?.key;
  const points = sortedConnectionPoints(target?.connection_points.filter(point => panelKey(point) === selectedPanel) ?? []);
  const opposite = side === 'A' ? current?.snapshot.object_b_id : current?.snapshot.object_a_id;
  const available = (point: ConnectionPointDetails) =>
    point.cardinality === 1 && point.external_connection_count === 0 && objectId !== opposite;
  const selected = points.find(point => pointId(point) === port && available(point));
  const busy = step === 'writing' || step === 'refreshing';
  const confirm = async () => {
    if (step !== 'review' || !current || !selected) return;
    setStep('writing');
    setError(undefined);
    try {
      await writer.reconnect(cableId, current.snapshot.expected, side, pointId(selected));
    } catch (reason) {
      if (reason instanceof CableReconnectError && [409, 422].includes(reason.status)) setStep('conflict');
      else {
        setError('write');
        setStep('conflict');
      }
      return;
    }
    await refreshMap();
  };

  const endLabels = [t('catalog.endpointA'), t('catalog.endpointB')];
  const ends = (values: string[]) => <ul>{values.map((value, index) =>
    <li key={endLabels[index]}><strong>{endLabels[index]}</strong> · <span>{value}</span></li>)}</ul>;
  return <section className="map-dialog" role="dialog" aria-modal="true" aria-label={t('map.reconnect.action')} aria-busy={busy}>
    <div className="map-dialog__surface">
      <h2>{t('map.reconnect.action')}</h2>
      {step === 'conflict' && <p role="alert">{t(error === 'write' ? 'map.reconnect.write' : 'map.reconnect.conflict')}</p>}
      {step === 'refresh-failed' && <p role="alert">{t('map.reconnect.savedRefreshFailed')}</p>}
      {step === 'refreshing' && <p role="status">{t('map.refreshing')}</p>}
      {(step === 'edit' || step === 'review' || step === 'writing') && <>
        {error && <p role="alert">{t(error === 'unsupported' ? 'map.reconnect.unsupported' : 'map.reconnect.load')}</p>}
        {!current && !error && <p role="status">{t('connect.loading')}</p>}
        {current && <>
          <h3>{current.snapshot.display_label}</h3>
          <p>{t('map.reconnect.before')}</p>
          {ends(current.ends)}
          {step === 'edit' && <>
            <label className="physical-panel-picker">{t('map.reconnect.side')}
              <select value={side} onChange={event => { setSide(event.target.value === 'B' ? 'B' : 'A'); setPort(''); }}>
                <option value="A">{endLabels[0]}</option><option value="B">{endLabels[1]}</option>
              </select>
            </label>
            <label className="physical-panel-picker">{t('connect.targetObject')}
              <select value={objectId} onChange={event => {
                setObjectId(event.target.value); setTarget(undefined); setPanel(undefined); setPort(''); setError(undefined);
              }}>
                <option value="">{t('connect.selectObject')}</option>
                {objects.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            {objectId && !target && !error && <p role="status">{t('physical.loading')}</p>}
            {target && (options.length ? <>
              <label className="physical-panel-picker">{t('physical.panel')}
                <select value={selectedPanel} onChange={event => { setPanel(event.target.value); setPort(''); }}>
                  {options.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </label>
              <label className="physical-panel-picker">{t('physical.port')}
                <select value={port} onChange={event => setPort(event.target.value)}>
                  <option value="">{t('connect.selectPort')}</option>
                  {points.map(point => <option key={pointId(point)} value={pointId(point)} disabled={!available(point)}>
                    {displayPointLabel(point, t('physical.port'))}
                    {!available(point) && ` · ${t(point.external_connection_count ? 'physical.connected' : 'map.bulk.unavailable')}`}
                  </option>)}
                </select>
              </label>
            </> : <p>{t('physical.noPoints')}</p>)}
          </>}
          {step !== 'edit' && target && selected && <>
            <p>{t('map.reconnect.after')}</p>
            {ends(side === 'A' ? [endpoint(target, selected), current.ends[1]] : [current.ends[0], endpoint(target, selected)])}
          </>}
        </>}
      </>}
      <div className="map-dialog__actions">
        {!busy && step !== 'refresh-failed' && <button type="button" onClick={close}>{t('map.cancel')}</button>}
        {step === 'edit' && (error === 'load' || error === 'target') && <button type="button" onClick={() => {
          setError(undefined); setRetry(value => value + 1);
        }}>{t('action.retry')}</button>}
        {step === 'edit' && current && <button type="button" disabled={!selected} onClick={() => setStep('review')}>{t('map.bulk.review')}</button>}
        {step === 'review' && <>
          <button type="button" onClick={() => setStep('edit')}>{t('map.back')}</button>
          <button type="button" onClick={() => void confirm()}>{t('map.reconnect.confirm')}</button>
        </>}
        {step === 'conflict' &&
          <button type="button" onClick={reloadConnection}>{t('map.reconnect.reload')}</button>}
        {step === 'refresh-failed' &&
          <button type="button" onClick={() => void refreshMap()}>{t('map.retryRefresh')}</button>}
      </div>
    </div>
  </section>;
}
