import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { ConnectionPreview } from './OpticalEvidence';
import { useCompatibilityPreview } from './useCompatibilityPreview';
import { usePhysicalCompatibilityConfirmation } from './PhysicalCompatibilityDialog';
import type {
  DeviceDetailsDataSource,
  DeviceDetailsDocument,
  DeviceInterfaceDetails,
} from '../topology/deviceDetailsTypes';
import type { CreatePhysicalLinkRequest, PhysicalLinkWriteDataSource } from '../topology/physicalLinkWriteTypes';
import { FiberTypeSelect } from './FiberTypeSelect';
import type { FiberType } from '../topology/fiberTypes';
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [targetDeviceId, setTargetDeviceId] = useState('');
  const [targetInterfaceId, setTargetInterfaceId] = useState('');
  const [targetState, setTargetState] = useState<TargetState>({ kind: 'idle' });
  const [targetRetryKey, setTargetRetryKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { confirm, confirmationDialog } = usePhysicalCompatibilityConfirmation();
  const [error, setError] = useState<string | null>(null);
  const [fiberType, setFiberType] = useState<FiberType | null>(null);
  const [cableNaming, setCableNaming] = useState<CableNamingInput>({ cable_label: null, cable_label_template_id: null, generate_cable_label: false });

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

  const input: CreatePhysicalLinkRequest = {
    source_interface_id: sourceInterface.interface_ref.entity_id,
    target_interface_id: targetInterfaceId,
    ...cableNaming, ...(fiberType && { fiber_type: fiberType }),
  };
  const ready = targetInterfaces.some(item => item.interface_ref.entity_id === targetInterfaceId)
    && (!cableNaming.generate_cable_label || Boolean(cableNaming.cable_label_template_id));
  const review = useCompatibilityPreview(
    open && ready && writeDataSource.previewPhysicalLink ? JSON.stringify(input) : null,
    writeDataSource, () => writeDataSource.previewPhysicalLink!(input),
  );
  const canWrite = ready && (!writeDataSource.previewPhysicalLink || Boolean(review.preview && review.preview.verdict !== 'DENY'));
  const submit = async () => {
    if (!canWrite || busy) return;
    setBusy(true);
    setError(null);
    const current = review.capture();
    try {
      const request = { ...input };
      if (review.preview) {
        const compatibility = await confirm(review.preview);
        if (!compatibility || !current()) return;
        request.compatibility = compatibility;
      }
      setSubmitting(true);
      await writeDataSource.createPhysicalLink(request);
      setFiberType(null);
      setOpen(false);
      setTargetDeviceId('');
      setTargetInterfaceId('');
      onConnected();
    } catch (reason) {
      if (!current()) return;
      if (review.preview) review.retry();
      setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
    } finally {
      setSubmitting(false);
      setBusy(false);
    }
  };

  return (
    <div className="connect-interface">
      <button
        type="button"
        className="connect-interface__trigger"
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          setOpen((value) => !value);
          setError(null);
        }}
      >
        Подключить
      </button>
      {open && (
        <form className="connect-interface__form" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
          <strong>Физическое подключение</strong>
          <label>
            <span>Куда: устройство</span>
            <select
              value={targetDeviceId}
              onChange={(event) => setTargetDeviceId(event.target.value)}
              disabled={busy}
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
              disabled={busy || targetState.kind !== 'loaded'}
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
          <label>{t('fiber.type')} <FiberTypeSelect value={fiberType} onChange={setFiberType} disabled={busy} /></label>
          <CableNamingFields dataSource={cableLabelDataSource} disabled={busy} value={cableNaming} onChange={setCableNaming} />
          <ConnectionPreview review={review} />
          <div className="connect-interface__actions">
            <button type="button" onClick={() => setOpen(false)} disabled={busy}>
              Отмена
            </button>
            <button type="submit" disabled={!canWrite || busy}>
              {submitting ? 'Подключаем…' : busy ? t('compatibility.checking') : error ? 'Повторить' : 'Подключить'}
            </button>
          </div>
        </form>
      )}
      {confirmationDialog}
    </div>
  );
}
