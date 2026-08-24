import { useMemo, useState } from 'react';
import { physicalClassPresentation } from '../topology/presentation';
import type { CatalogInventoryDocument, CatalogInventoryEquipmentItem } from '../topology/catalogInventoryTypes';

export interface MapInsertionCandidate {
  id: string;
  label: string;
  className?: string;
}

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
const knownClasses = new Set(['workstation', 'switch', 'cable', 'outlet', 'patch_panel']);
const fold = (value: string) => value.trim().toLocaleLowerCase();

const classLabel = (className?: string) => (
  className === undefined ? 'Без типа' : knownClasses.has(className)
    ? physicalClassPresentation(className).label
    : className
);

export const mapCandidateChoices = (
  equipment: CatalogInventoryEquipmentItem[],
  placedIds: string[],
): MapInsertionCandidate[] => equipment
  .filter((item) => !placedIds.includes(item.physical_object_ref.entity_id))
  .map((item) => ({
    id: item.physical_object_ref.entity_id,
    label: item.label,
    className: item.class,
  }))
  .sort((left, right) => collator.compare(left.label, right.label));

export function MapInsertionPicker({
  inventory,
  placedIds,
  status,
  error,
  onSelect,
  onClose,
  onRetryRefresh,
}: {
  inventory: CatalogInventoryDocument | null;
  placedIds: string[];
  status: 'loading' | 'ready' | 'saving' | 'saved-refresh-failed';
  error: string | null;
  onSelect: (candidate: MapInsertionCandidate) => void;
  onClose: () => void;
  onRetryRefresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const candidates = useMemo(
    () => mapCandidateChoices(inventory?.equipment ?? [], placedIds),
    [inventory, placedIds],
  );
  const normalizedQuery = fold(query);
  const visible = candidates.filter((candidate) => [candidate.label, candidate.className, classLabel(candidate.className)]
    .some((value) => !normalizedQuery || fold(value ?? '').includes(normalizedQuery)));

  return (
    <section className="map-dialog" role="dialog" aria-modal="true" aria-label="Добавить на карту">
      <div className="map-dialog__surface map-insertion-picker">
        <h2>Добавить на карту</h2>
        {status === 'loading' && <p role="status">Загружаем оборудование…</p>}
        {status !== 'loading' && !error && (
          <label>
            Поиск
            <input aria-label="Поиск оборудования" value={query} onChange={(event) => setQuery(event.target.value)} disabled={status !== 'ready'} />
          </label>
        )}
        {status === 'ready' && error && <p role="alert">{error}</p>}
        {status === 'ready' && visible.map((candidate) => (
          <button key={candidate.id} type="button" aria-label={candidate.label} onClick={() => onSelect(candidate)}>
            <strong>{candidate.label}</strong>
            <small>{classLabel(candidate.className)}</small>
          </button>
        ))}
        {status === 'ready' && candidates.length === 0 && inventory?.equipment.length === 0 && (
          <p>Оборудование пока не создано.</p>
        )}
        {status === 'ready' && candidates.length === 0 && inventory && inventory.equipment.length > 0 && (
          <p>Всё оборудование уже размещено на этой карте.</p>
        )}
        {status === 'ready' && candidates.length > 0 && visible.length === 0 && (
          <p>По заданному запросу ничего не найдено.</p>
        )}
        {status === 'saving' && <p role="status">Добавляем на карту…</p>}
        {status === 'saved-refresh-failed' && (
          <>
            <p role="alert">{error}</p>
            <button type="button" onClick={onRetryRefresh}>Повторить обновление</button>
          </>
        )}
        {status !== 'saving' && <button type="button" onClick={onClose}>Закрыть</button>}
      </div>
    </section>
  );
}
