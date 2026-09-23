import type { Dispatch, SetStateAction } from 'react';
import { useI18n } from '../i18n';
import type { MapTextAnnotation } from '../topology/savedMapTypes';

export interface TextAnnotationOperation { mapId: string; annotationId?: string; original?: MapTextAnnotation; text: string; position: { x: number; y: number } | null; textColor: string; fontSize: number; status: 'placing' | 'editing' | 'saving' | 'refresh-failed'; error: string | null; }
export interface TextAnnotationDeleteOperation { mapId: string; annotationId: string; text: string; status: 'confirming' | 'deleting' | 'refresh-failed'; error: string | null; }

interface Props {
  annotations: readonly MapTextAnnotation[];
  selectedAnnotationId: string | null;
  selectionDisabled: boolean;
  textAnnotationEdit: TextAnnotationOperation | null;
  textAnnotationDeletion: TextAnnotationDeleteOperation | null;
  setTextAnnotationEdit: Dispatch<SetStateAction<TextAnnotationOperation | null>>;
  setTextAnnotationDeletion: Dispatch<SetStateAction<TextAnnotationDeleteOperation | null>>;
  onSelectAnnotation: (id: string) => void;
  onEditAnnotation: () => void;
  onDeleteAnnotation: () => void;
  onSaveAnnotation: () => void;
  onRetryAnnotationRefresh: () => void;
  onConfirmAnnotationDeletion: () => void;
  onRetryAnnotationDeletionRefresh: () => void;
}

export function PresentationAuthoringPanel(props: Props) {
  const { t } = useI18n();
  const footer = (children: React.ReactNode) => <footer className="presentation-authoring-panel__footer">{children}</footer>;
  const field = (label: string, control: React.ReactNode) => <label className="presentation-authoring-panel__field"><span>{label}</span>{control}</label>;
  return <aside className="presentation-authoring-panel" aria-label={t('map.textAnnotation')}>
    <section className="presentation-authoring-panel__list" aria-label={t('map.textAnnotation')}>
      <div className="presentation-authoring-panel__annotation-list">{props.annotations.length === 0 ? <p>{t('map.textAnnotationEmpty')}</p> : props.annotations.map((annotation) => <button key={annotation.annotation_ref.entity_id} type="button" className="presentation-authoring-panel__row" aria-pressed={props.selectedAnnotationId === annotation.annotation_ref.entity_id} disabled={props.selectionDisabled} onClick={() => props.onSelectAnnotation(annotation.annotation_ref.entity_id)}>{annotation.text.split('\n')[0] || t('map.textAnnotation')}</button>)}</div>
    </section>
    {props.selectedAnnotationId && !props.selectionDisabled && <section className="presentation-authoring-panel__context" aria-label={t('map.textAnnotation')}><div className="presentation-authoring-panel__actions"><button type="button" className="secondary-action" onClick={props.onEditAnnotation}>{t('map.textAnnotationEdit')}</button><button type="button" className="danger-action" onClick={props.onDeleteAnnotation}>{t('map.textAnnotationDelete')}</button></div></section>}
    {props.textAnnotationEdit && <section className="presentation-authoring-panel__editor"><h2>{t('map.textAnnotation')}</h2>{props.textAnnotationEdit.status === 'placing' ? <p role="status">{t('map.textAnnotationPlace')}</p> : <>{field(t('map.textAnnotationText'), <textarea value={props.textAnnotationEdit.text} disabled={props.textAnnotationEdit.status !== 'editing'} onChange={(event) => props.setTextAnnotationEdit((current) => current ? { ...current, text: event.target.value, error: null } : current)} />)}{field(t('map.textAnnotationColor'), <input aria-label={t('map.textAnnotationColor')} type="color" value={props.textAnnotationEdit.textColor} disabled={props.textAnnotationEdit.status !== 'editing'} onChange={(event) => props.setTextAnnotationEdit((current) => current ? { ...current, textColor: event.target.value, error: null } : current)} />)}{field(t('map.textAnnotationFontSize'), <input aria-label={t('map.textAnnotationFontSize')} type="number" min="1" value={props.textAnnotationEdit.fontSize} disabled={props.textAnnotationEdit.status !== 'editing'} onChange={(event) => props.setTextAnnotationEdit((current) => current ? { ...current, fontSize: Number(event.target.value), error: null } : current)} />)}</>}{props.textAnnotationEdit.error && <p role="alert">{props.textAnnotationEdit.error}</p>}{props.textAnnotationEdit.status === 'saving' && <p role="status">{t('map.textAnnotationSaving')}</p>}{footer(<>{props.textAnnotationEdit.status === 'editing' && <button type="button" className="primary-action" disabled={!props.textAnnotationEdit.position || props.textAnnotationEdit.fontSize <= 0} onClick={props.onSaveAnnotation}>{t('map.save')}</button>}{props.textAnnotationEdit.status === 'refresh-failed' && <button type="button" className="primary-action" onClick={props.onRetryAnnotationRefresh}>{t('map.retryRefresh')}</button>}<button type="button" className="secondary-action" onClick={() => props.setTextAnnotationEdit(null)}>{t('map.cancel')}</button></>)}</section>}
    {props.textAnnotationDeletion && <section className="presentation-authoring-panel__editor" role="alertdialog" aria-label={t('map.textAnnotationDeleteConfirm')}><p>{t('map.textAnnotationDeleteConfirm')}</p>{props.textAnnotationDeletion.error && <p role="alert">{props.textAnnotationDeletion.error}</p>}{props.textAnnotationDeletion.status === 'deleting' && <p role="status">{t('map.textAnnotationDeleting')}</p>}{footer(<>{props.textAnnotationDeletion.status === 'confirming' && <button type="button" className="danger-action" onClick={props.onConfirmAnnotationDeletion}>{t('map.textAnnotationDelete')}</button>}{props.textAnnotationDeletion.status === 'refresh-failed' && <button type="button" className="primary-action" onClick={props.onRetryAnnotationDeletionRefresh}>{t('map.retryRefresh')}</button>}<button type="button" className="secondary-action" onClick={() => props.setTextAnnotationDeletion(null)}>{t('map.cancel')}</button></>)}</section>}
  </aside>;
}
