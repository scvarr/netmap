import { useState, type FormEvent } from 'react';
import type { ConnectionPointWriteDataSource } from '../topology/connectionPointWriteTypes';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import { useI18n } from '../i18n';

interface CreateConnectionPointProps {
  physicalObjectId: string;
  dataSource: ConnectionPointWriteDataSource;
  onCreated: (document: PhysicalObjectDetailsDocument) => void;
}

export function CreateConnectionPoint({
  physicalObjectId,
  dataSource,
  onCreated,
}: CreateConnectionPointProps) {
  const { t } = useI18n();
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
      const document = await dataSource.createConnectionPoint(
        physicalObjectId,
        { display_name: name.trim() },
      );
      setName('');
      setOpen(false);
      onCreated(document);
    } catch {
      setError(t('physical.createPointFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-interface create-connection-point">
      <button
        className="create-interface__trigger"
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setError(null);
        }}
      >
        {t('create.addPoint')}
      </button>
      {open && (
        <form className="create-interface__form" onSubmit={submit} noValidate>
          <label>
            <span>{t('create.name')}</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={submitting}
            />
          </label>
          {error && (
            <p className="create-interface__error" role="alert">
              {error}
            </p>
          )}
          <div className="create-interface__actions">
            <button type="button" onClick={() => setOpen(false)} disabled={submitting}>{t('action.cancel')}</button>
            <button type="submit" disabled={!valid || submitting}>
              {submitting ? t('create.creating') : error ? t('action.retry') : t('create.create')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
