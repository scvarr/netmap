import { useState, type FormEvent } from 'react';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import type { PhysicalObjectWriteDataSource } from '../topology/physicalObjectWriteTypes';

interface CreatePhysicalObjectProps {
  dataSource: PhysicalObjectWriteDataSource;
  onCreated: (document: PhysicalObjectDetailsDocument) => void;
}

export function CreatePhysicalObject({ dataSource, onCreated }: CreatePhysicalObjectProps) {
  const [open, setOpen] = useState(false);
  const [objectName, setObjectName] = useState('');
  const [pointName, setPointName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = objectName.trim().length > 0 && pointName.trim().length > 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await dataSource.createPhysicalObject({
        display_name: objectName.trim(),
        initial_connection_point: { display_name: pointName.trim() },
      });
      setObjectName('');
      setPointName('');
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
              <h2>Физический объект</h2>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть форму">×</button>
          </div>
          <label>
            <span>Название</span>
            <input
              autoFocus
              value={objectName}
              onChange={(event) => setObjectName(event.target.value)}
              disabled={submitting}
            />
          </label>
          <label>
            <span>Первая точка подключения</span>
            <input
              value={pointName}
              onChange={(event) => setPointName(event.target.value)}
              disabled={submitting}
            />
          </label>
          {error && <p className="create-device__error" role="alert">Не удалось создать физический объект. {error}</p>}
          <button className="create-device__submit" type="submit" disabled={!valid || submitting}>
            {submitting ? 'Создаём…' : 'Создать'}
          </button>
        </form>
      )}
    </div>
  );
}
