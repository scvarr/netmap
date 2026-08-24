import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ObjectBlueprintDataSource } from '../topology/objectBlueprintTypes';

export interface BlueprintInstantiationTarget { id: string; versionId: string; name: string; versionNumber: number }

export function BlueprintInstantiationDialog({ dataSource, target, onClose }: { dataSource: ObjectBlueprintDataSource; target: BlueprintInstantiationTarget; onClose: () => void }) {
  const navigate = useNavigate();
  const [instanceName, setInstanceName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const instantiate = async () => {
    if (!instanceName.trim()) { setError('Введите имя экземпляра.'); return; }
    if (!dataSource.instantiateObjectBlueprint) { setError('Создание экземпляра не поддерживается datasource.'); return; }
    setError(null); setCreating(true);
    try { const created = await dataSource.instantiateObjectBlueprint(target.id, target.versionId, { display_name: instanceName.trim() }); navigate(`/infrastructure/objects/${created.physical_object_ref.entity_id}`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось создать объект.'); }
    finally { setCreating(false); }
  };
  return <div className="blueprint-dialog" role="dialog" aria-modal="true" aria-label="Создать объект"><div className="blueprint-dialog__surface"><h2>Создать объект из «{target.name}»</h2><p>Версия: v{target.versionNumber}</p><label>Имя экземпляра<input autoFocus aria-label="Имя экземпляра" value={instanceName} onChange={(event) => setInstanceName(event.target.value)} /></label>{error && <p role="alert" className="blueprint-editor__error">{error}</p>}<div className="blueprint-card__actions"><button type="button" className="secondary-action" disabled={creating} onClick={onClose}>Отмена</button><button type="button" className="primary-action" disabled={creating || !instanceName.trim()} onClick={() => void instantiate()}>{creating ? 'Создаём…' : 'Создать'}</button></div></div></div>;
}
