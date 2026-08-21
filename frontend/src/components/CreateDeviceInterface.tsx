import { useState, type FormEvent } from 'react';
import type { DeviceDetailsDocument } from '../topology/deviceDetailsTypes';
import type { DeviceInterfaceWriteDataSource } from '../topology/deviceInterfaceWriteTypes';

interface CreateDeviceInterfaceProps {
  physicalObjectId: string;
  dataSource: DeviceInterfaceWriteDataSource;
  onCreated: (document: DeviceDetailsDocument) => void;
}

export function CreateDeviceInterface({
  physicalObjectId,
  dataSource,
  onCreated,
}: CreateDeviceInterfaceProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const document = await dataSource.createDeviceInterface(
        physicalObjectId,
        { display_name: name.trim() },
      );
      setName('');
      setOpen(false);
      onCreated(document);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-interface">
      <button
        className="create-interface__trigger"
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setError(null);
        }}
      >
        + Добавить интерфейс
      </button>
      {open && (
        <form className="create-interface__form" onSubmit={submit} noValidate>
          <label>
            <span>Название</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
            />
          </label>
          {error && (
            <p className="create-interface__error" role="alert">
              Не удалось создать интерфейс. {error}
            </p>
          )}
          <div className="create-interface__actions">
            <button type="button" onClick={() => setOpen(false)} disabled={submitting}>Отмена</button>
            <button type="submit" disabled={!valid || submitting}>
              {submitting ? 'Создаём…' : error ? 'Повторить' : 'Создать'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
