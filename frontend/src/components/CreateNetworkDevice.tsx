import { useState, type FormEvent } from 'react';
import type { DeviceDetailsDocument } from '../topology/deviceDetailsTypes';
import type { DeviceWriteDataSource } from '../topology/deviceWriteTypes';

interface CreateNetworkDeviceProps {
  dataSource: DeviceWriteDataSource;
  onCreated: (document: DeviceDetailsDocument) => void;
}

export function CreateNetworkDevice({ dataSource, onCreated }: CreateNetworkDeviceProps) {
  const [open, setOpen] = useState(false);
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-device">
      <button
        className="create-device__trigger"
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setError(null);
        }}
      >
        + Добавить
      </button>
      {open && (
        <form className="create-device__form" onSubmit={submit} noValidate>
          <div className="create-device__heading">
            <div>
              <span className="eyebrow">Новый объект</span>
              <h2>Сетевое устройство</h2>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть форму">×</button>
          </div>
          <label>
            <span>Название устройства</span>
            <input
              autoFocus
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              disabled={submitting}
            />
          </label>
          <label>
            <span>Первый интерфейс</span>
            <input
              value={interfaceName}
              onChange={(event) => setInterfaceName(event.target.value)}
              disabled={submitting}
            />
          </label>
          {error && <p className="create-device__error" role="alert">Не удалось создать устройство. {error}</p>}
          <button className="create-device__submit" type="submit" disabled={!valid || submitting}>
            {submitting ? 'Создаём…' : 'Создать'}
          </button>
        </form>
      )}
    </div>
  );
}
