import { useState, type FormEvent } from 'react';
import type { PhysicalObjectDetailsDocument } from '../topology/physicalObjectDetailsTypes';
import type { PhysicalObjectWriteDataSource } from '../topology/physicalObjectWriteTypes';
import { useI18n } from '../i18n';

interface CreatePhysicalObjectProps {
  dataSource: PhysicalObjectWriteDataSource;
  onCreated: (document: PhysicalObjectDetailsDocument) => void;
  variant?: 'popover' | 'page';
}

export function CreatePhysicalObject({ dataSource, onCreated, variant = 'popover' }: CreatePhysicalObjectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(variant === 'page');
  const [objectName, setObjectName] = useState('');
  const [pointName, setPointName] = useState('');
  const [category, setCategory] = useState('');
  const [customClass, setCustomClass] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const classValue = category === '__custom__' ? customClass.trim() : category;
  const valid = objectName.trim().length > 0
    && pointName.trim().length > 0
    && (category !== '__custom__' || classValue.length > 0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await dataSource.createPhysicalObject({
        display_name: objectName.trim(),
        initial_connection_point: { display_name: pointName.trim() },
        ...(classValue ? { class: classValue } : {}),
      });
      setObjectName('');
      setPointName('');
      setCategory('');
      setCustomClass('');
      setOpen(false);
      onCreated(created);
    } catch {
      setError(t('create.failedObjectGeneric'));
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
              <h2>{t('create.physicalObject')}</h2>
            </div>
            {variant === 'popover' && <button type="button" onClick={() => setOpen(false)} aria-label={t('create.closeForm')}>×</button>}
          </div>
          <label>
            <span>{t('create.name')}</span>
            <input
              autoFocus
              value={objectName}
              onChange={(event) => setObjectName(event.target.value)}
              disabled={submitting}
            />
          </label>
          <label>
            <span>{t('create.firstPoint')}</span>
            <input
              value={pointName}
              onChange={(event) => setPointName(event.target.value)}
              disabled={submitting}
            />
          </label>
          <label>
            <span>{t('create.category')}</span>
            <select
              aria-label={t('create.category')}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              disabled={submitting}
            >
              <option value="">{t('create.otherUnspecified')}</option>
              <option value="outlet">{t('physical.class.outlet')}</option>
              <option value="patch_panel">{t('physical.class.patchPanel')}</option>
              <option value="__custom__">{t('create.otherValue')}</option>
            </select>
          </label>
          {category === '__custom__' && (
            <label>
              <span>{t('create.classValue')}</span>
              <input
                value={customClass}
                onChange={(event) => setCustomClass(event.target.value)}
                disabled={submitting}
              />
            </label>
          )}
          {error && <p className="create-device__error" role="alert">{error}</p>}
          <button className="create-device__submit" type="submit" disabled={!valid || submitting}>
            {submitting ? t('create.creating') : t('create.create')}
          </button>
        </form>
      )}
    </div>
  );
}
