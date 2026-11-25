import { useId, useLayoutEffect, useRef } from 'react';
import { useI18n } from '../i18n';

export function DestructiveConfirmationDialog({ title, description, action, onCancel, onConfirm, fallbackFocus }: {
  title: string;
  description: string;
  action: string;
  onCancel: () => void;
  onConfirm: () => void;
  fallbackFocus?: () => HTMLElement | null;
}) {
  const { t } = useI18n();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const fallback = useRef(fallbackFocus);

  useLayoutEffect(() => {
    const surface = dialog.current!;
    const trigger = document.activeElement;
    surface.showModal();
    cancel.current?.focus();
    return () => {
      surface.close();
      queueMicrotask(() => {
        if (document.activeElement !== document.body) return;
        if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
        if (document.activeElement === document.body) fallback.current?.()?.focus();
      });
    };
  }, []);

  return <dialog ref={dialog} className="destructive-confirmation-dialog"
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <div className="map-dialog__surface">
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-description`}>{description}</p>
      <div className="map-dialog__actions">
        <button ref={cancel} type="button" className="secondary-action" onClick={onCancel}>{t('map.cancel')}</button>
        <button type="button" className="danger-action" onClick={onConfirm}>{action}</button>
      </div>
    </div>
  </dialog>;
}
