import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  DeviceDetailsDataSource,
  DeviceDetailsDocument,
  DeviceInterfaceDetails,
} from '../topology/deviceDetailsTypes';
import type { PhysicalLinkWriteDataSource } from '../topology/physicalLinkWriteTypes';
import { CableNamingFields } from './CableNamingFields';
import type { CableLabelDataSource, CableNamingInput } from '../topology/cableLabelTypes';

export interface PhysicalLinkTargetDevice {
  physicalObjectId: string;
  label: string;
}

interface ConnectPhysicalInterfaceProps {
  sourceInterface: DeviceInterfaceDetails;
  targetDevices: PhysicalLinkTargetDevice[];
  detailsDataSource: DeviceDetailsDataSource;
  writeDataSource: PhysicalLinkWriteDataSource;
  onConnected: () => void;
  cableLabelDataSource?: CableLabelDataSource;
}

type TargetState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; document: DeviceDetailsDocument }
  | { kind: 'error'; message: string };

export function ConnectPhysicalInterface({
  sourceInterface,
  targetDevices,
  detailsDataSource,
  writeDataSource,
  onConnected,
  cableLabelDataSource,
}: ConnectPhysicalInterfaceProps) {
  const [open, setOpen] = useState(false);
  const [targetDeviceId, setTargetDeviceId] = useState('');
  const [targetInterfaceId, setTargetInterfaceId] = useState('');
  const [targetState, setTargetState] = useState<TargetState>({ kind: 'idle' });
  const [targetRetryKey, setTargetRetryKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cableNaming, setCableNaming] = useState<CableNamingInput>({});

  useEffect(() => {
    setTargetInterfaceId('');
    if (!targetDeviceId) {
      setTargetState({ kind: 'idle' });
      return undefined;
    }
    let current = true;
    setTargetState({ kind: 'loading' });
    void detailsDataSource.loadDeviceDetails(targetDeviceId).then(
      (document) => { if (current) setTargetState({ kind: 'loaded', document }); },
      (reason: unknown) => {
        if (current) {
          setTargetState({
            kind: 'error',
            message: reason instanceof Error ? reason.message : 'Неизвестная ошибка',
          });
        }
      },
    );
    return () => { current = false; };
  }, [detailsDataSource, targetDeviceId, targetRetryKey]);

  const targetInterfaces = useMemo(() => (
    targetState.kind === 'loaded'
      ? targetState.document.interfaces.filter((item) => (
        item.interface_ref.entity_id !== sourceInterface.interface_ref.entity_id
        && item.direct_physical_bindings.length === 0
      ))
      : []
  ), [sourceInterface.interface_ref.entity_id, targetState]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!targetInterfaceId || submitting || (cableNaming.generate_cable_label && !cableNaming.cable_label_template_id)) return;
    setSubmitting(true);
    setError(null);
    try {
      await writeDataSource.createPhysicalLink({
        source_interface_id: sourceInterface.interface_ref.entity_id,
        target_interface_id: targetInterfaceId,
        ...cableNaming,
      });
      setOpen(false);
      setTargetDeviceId('');
      setTargetInterfaceId('');
      onConnected();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="connect-interface">
      <button
        type="button"
        className="connect-interface__trigger"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setError(null);
        }}
      >
        Подключить
      </button>
      {open && (
        <form className="connect-interface__form" onSubmit={submit} noValidate>
          <strong>Физическое подключение</strong>
          <label>
            <span>Куда: устройство</span>
            <select
              value={targetDeviceId}
              onChange={(event) => setTargetDeviceId(event.target.value)}
              disabled={submitting}
            >
              <option value="">Выберите устройство</option>
              {targetDevices.map((device) => (
                <option key={device.physicalObjectId} value={device.physicalObjectId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Куда: интерфейс</span>
            <select
              value={targetInterfaceId}
              onChange={(event) => setTargetInterfaceId(event.target.value)}
              disabled={submitting || targetState.kind !== 'loaded'}
            >
              <option value="">Выберите интерфейс</option>
              {targetInterfaces.map((item) => (
                <option key={item.interface_ref.entity_id} value={item.interface_ref.entity_id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {targetState.kind === 'loading' && <p className="muted">Загружаем интерфейсы…</p>}
          {targetState.kind === 'loaded' && targetInterfaces.length === 0 && (
            <p className="muted">У устройства нет свободных интерфейсов.</p>
          )}
          {targetState.kind === 'error' && (
            <div className="connect-interface__target-error">
              <p>Не удалось загрузить интерфейсы. {targetState.message}</p>
              <button type="button" onClick={() => setTargetRetryKey((key) => key + 1)}>
                Повторить загрузку
              </button>
            </div>
          )}
          {error && (
            <p className="connect-interface__error" role="alert">
              Не удалось подключить интерфейс. {error}
            </p>
          )}
          <CableNamingFields dataSource={cableLabelDataSource} disabled={submitting} value={cableNaming} onChange={setCableNaming} />
          <div className="connect-interface__actions">
            <button type="button" onClick={() => setOpen(false)} disabled={submitting}>
              Отмена
            </button>
            <button type="submit" disabled={!targetInterfaceId || submitting || (cableNaming.generate_cable_label === true && !cableNaming.cable_label_template_id)}>
              {submitting ? 'Подключаем…' : error ? 'Повторить' : 'Подключить'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
