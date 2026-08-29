import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ObjectBlueprintDataSource } from '../topology/objectBlueprintTypes';
import { useI18n } from '../i18n';

export interface BlueprintInstantiationTarget { id: string; versionId: string; name: string; versionNumber: number }

export function BlueprintInstantiationDialog({ dataSource, target, onClose }: { dataSource: ObjectBlueprintDataSource; target: BlueprintInstantiationTarget; onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [instanceName, setInstanceName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const instantiate = async () => {
    if (!instanceName.trim()) { setError(t('blueprint.instantiate.nameRequired')); return; }
    if (!dataSource.instantiateObjectBlueprint) { setError(t('blueprint.instantiate.unsupported')); return; }
    setError(null); setCreating(true);
    try { const created = await dataSource.instantiateObjectBlueprint(target.id, target.versionId, { display_name: instanceName.trim() }); navigate(`/infrastructure/objects/${created.physical_object_ref.entity_id}`); }
    catch { setError(t('blueprint.instantiate.failed')); }
    finally { setCreating(false); }
  };
  return <div className="blueprint-dialog" role="dialog" aria-modal="true" aria-label={t('blueprint.instantiate.title')}><div className="blueprint-dialog__surface"><h2>{t('blueprint.instantiate.from', { name: target.name })}</h2><p>{t('blueprint.instantiate.version', { version: target.versionNumber })}</p><label>{t('blueprint.instantiate.name')}<input autoFocus aria-label={t('blueprint.instantiate.name')} value={instanceName} onChange={(event) => setInstanceName(event.target.value)} /></label>{error && <p role="alert" className="blueprint-editor__error">{error}</p>}<div className="blueprint-card__actions"><button type="button" className="secondary-action" disabled={creating} onClick={onClose}>{t('action.cancel')}</button><button type="button" className="primary-action" disabled={creating || !instanceName.trim()} onClick={() => void instantiate()}>{creating ? t('blueprint.instantiate.creating') : t('create.create')}</button></div></div></div>;
}
