import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import {
  compatibilityMessage, compatibilityReasons, PhysicalCompatibilityError,
  type PhysicalCompatibilityConfirmation, type PhysicalCompatibilityPreview,
} from '../topology/physicalCompatibility';

type ConfirmationLabel = 'compatibility.confirmCreate' | 'compatibility.confirmReconnect';

function PhysicalCompatibilityDialog({ preview, label, finish, summary }: {
  preview: PhysicalCompatibilityPreview;
  label: ConfirmationLabel;
  summary?: string;
  finish: (accepted: boolean) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const surface = dialog.current!;
    surface.showModal();
    cancelButton.current?.focus();
    return () => surface.close();
  }, []);

  return <dialog ref={dialog} className="physical-compatibility-dialog"
    aria-label={t('compatibility.dialogTitle')} onCancel={event => { event.preventDefault(); finish(false); }}>
    <div className="map-dialog__surface">
      <h2>{t('compatibility.dialogTitle')}</h2>
      {summary && <p>{summary}</p>}
      <p>{t('compatibility.unknown')}</p>
      <ul>{compatibilityReasons(preview, t).map(reason => <li key={reason}>{reason}</li>)}</ul>
      <div className="map-dialog__actions">
        <button ref={cancelButton} type="button" onClick={() => finish(false)}>{t('map.cancel')}</button>
        <button type="button" onClick={() => finish(true)}>{t(label)}</button>
      </div>
    </div>
  </dialog>;
}

export function usePhysicalCompatibilityConfirmation(label: ConfirmationLabel = 'compatibility.confirmCreate') {
  const { t } = useI18n();
  const [preview, setPreview] = useState<{ result: PhysicalCompatibilityPreview; summary?: string }>();
  const answer = useRef<((accepted: boolean) => void) | null>(null);
  useEffect(() => () => {
    answer.current?.(false);
    answer.current = null;
  }, []);

  const finish = useCallback((accepted: boolean) => {
    const resolve = answer.current;
    answer.current = null;
    setPreview(undefined);
    resolve?.(accepted);
  }, []);
  async function confirm(result: PhysicalCompatibilityPreview, summary?: string): Promise<PhysicalCompatibilityConfirmation | null> {
    const { verdict, token } = result;
    if (verdict === 'DENY') throw new PhysicalCompatibilityError(compatibilityMessage(result, t));
    if (!token || answer.current) return null;
    if (verdict === 'ALLOW') return { token, accept_unknown: false };
    const accepted = await new Promise<boolean>(resolve => {
      answer.current = resolve;
      setPreview({ result, summary });
    });
    return accepted ? { token, accept_unknown: true } : null;
  }
  return {
    confirm, cancel: useCallback(() => finish(false), [finish]),
    confirmationDialog: preview && <PhysicalCompatibilityDialog preview={preview.result} summary={preview.summary} label={label} finish={finish} />,
  };
}
