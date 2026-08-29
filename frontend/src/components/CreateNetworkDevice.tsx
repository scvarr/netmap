import { useState, type FormEvent } from 'react';
import type { DeviceDetailsDocument } from '../topology/deviceDetailsTypes';
import type { DeviceWriteDataSource } from '../topology/deviceWriteTypes';
import { useI18n } from '../i18n';

interface CreateNetworkDeviceProps {
  dataSource: DeviceWriteDataSource;
  onCreated: (document: DeviceDetailsDocument) => void;
  variant?: 'popover' | 'page';
}

export function CreateNetworkDevice({ dataSource, onCreated, variant = 'popover' }: CreateNetworkDeviceProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(variant === 'page');
  const [deviceName, setDeviceName] = useState('');
  const [interfaceName, setInterfaceName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = deviceName.trim().length > 0 && interfaceName.trim().length > 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await dataSource.createNetworkDevice({
        display_name: deviceName.trim(),
        initial_interface: { display_name: interfaceName.trim() },
      });
      setDeviceName('');
      setInterfaceName('');
      setOpen(false);
      onCreated(created);
    } catch {
      setError(t('create.failedDeviceGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-device">
      {variant === 'popover' && (
        <button
          className="create-device__trigger"
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            setError(null);
          }}
        >
          {t('create.add')}
        </button>
      )}
      {open && (
        <form className={`create-device__form${variant === 'page' ? ' create-device__form--page' : ''}`} onSubmit={submit} noValidate>
          <div className="create-device__heading">
            <div>
              <span className="eyebrow">{t('create.newObject')}</span>
              <h2>{t('create.networkDevice')}</h2>
            </div>
            {variant === 'popover' && <button type="button" onClick={() => setOpen(false)} aria-label={t('create.closeForm')}>×</button>}
          </div>
          <label>
            <span>{t('create.deviceName')}</span>
            <input
              autoFocus
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              disabled={submitting}
            />
          </label>
          <label>
            <span>{t('create.firstInterface')}</span>
            <input
              value={interfaceName}
              onChange={(event) => setInterfaceName(event.target.value)}
              disabled={submitting}
            />
          </label>
          {error && <p className="create-device__error" role="alert">{error}</p>}
          <button className="create-device__submit" type="submit" disabled={!valid || submitting}>
            {submitting ? t('create.creating') : t('create.create')}
          </button>
        </form>
      )}
    </div>
  );
}
