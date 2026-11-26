import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { FiberType } from '../topology/fiberTypes';
import { FiberTypeSelect } from './FiberTypeSelect';

export function CableFiberTypeDialog({ id, label, onClose }: { id: string; label: string; onClose: () => void }) {
  const { t } = useI18n();
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [original, setOriginal] = useState<FiberType | null>();
  const [value, setValue] = useState<FiberType | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<'load' | 'save'>();
  const [attempt, setAttempt] = useState(0);
  const url = '/api/v1/cables/' + encodeURIComponent(id) + '/fiber-type';

  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const { fiber_type: fiberType } = await response.json();
        if (fiberType !== null && fiberType !== 'SM' && fiberType !== 'MM') throw new Error();
        if (controller.signal.aborted) return;
        setValue(fiberType);
        setOriginal(fiberType);
      } catch {
        if (!controller.signal.aborted) setFailed('load');
      }
    };
    void load();
    return () => controller.abort();
  }, [url, attempt]);

  const save = async () => {
    if (pending || original === undefined || original === value) return;
    setPending(true);
    setFailed(undefined);
    try {
      const response = await fetch(url, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fiber_type: value }),
      });
      if (!response.ok) throw new Error();
      onClose();
    } catch {
      setFailed('save');
    } finally {
      setPending(false);
    }
  };

  return <dialog ref={dialog} className="catalog-dialog__surface cable-fiber-dialog" aria-labelledby={title} onCancel={event => {
    event.preventDefault();
    if (!pending) onClose();
  }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <h2 id={title}>{t('fiber.edit')} · {label}</h2>
      {original !== undefined ? <label>{t('fiber.type')} <FiberTypeSelect value={value} onChange={setValue} disabled={pending} /></label>
        : !failed && <p role="status">{t('object.loading')}</p>}
      {failed && <p role="alert">{t(failed === 'load' ? 'fiber.loadFailed' : 'fiber.saveFailed')}</p>}
      <div className="catalog-dialog__actions">
        <button type="button" onClick={onClose} disabled={pending}>{t('map.cancel')}</button>
        {failed === 'load' ? <button type="button" onClick={() => { setFailed(undefined); setAttempt(attempt + 1); }}>{t('catalog.retryRefresh')}</button>
          : <button type="submit" disabled={pending || original === undefined || original === value}>{t('catalog.save')}</button>}
      </div>
    </form>
  </dialog>;
}
