import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createBlueprintRequest, hydrateBlueprintEditorState, type BlueprintEditorState } from '../blueprints/editorModel';
import { LocalBaseTemplateEditor as BaseTemplateEditor, type LocalBaseTemplateDraftHandle } from './LocalBaseTemplateEditor';
import { PageShell } from '../components/PageChrome';
import { useI18n } from '../i18n';
import type { BaseTemplateDataSource, BaseTemplateDraftDocument, BaseTemplateReconciliationResult, CreateBaseTemplateRequest } from '../topology/baseTemplateTypes';
import { BaseTemplateChangeInspector, reconciliationCounts, reviewCounts } from './BaseTemplateChangeInspector';

import { DestructiveConfirmationDialog } from '../components/DestructiveConfirmationDialog';
import { BaseTemplateApiError } from '../topology/apiBaseTemplateDataSource';

const hydrateDraft = (doc: BaseTemplateDraftDocument) => hydrateBlueprintEditorState({
  ...doc.definition, schema_version: '2.0',
  blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: doc.template_id },
  version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: doc.source_revision_id },
  version_number: 1,
  next_panel_number: Math.max(...doc.definition.panels.map(panel => panel.panel_number)) + 1,
});

const signature = (d?: CreateBaseTemplateRequest) => d ? JSON.stringify(
  [d.name, d.default_physical_object_class ?? null, d.body, d.panels, d.slots, d.internal_links, d.bays ?? []],
  (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value,
) : '';

export function EditBaseTemplatePage({ dataSource }: { dataSource: BaseTemplateDataSource }) {
  const { templateId = '' } = useParams(); const { t } = useI18n();
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [reconciliationRefreshError, setReconciliationRefreshError] = useState("");
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  const [document, setDocument] = useState<BaseTemplateDraftDocument>();
  const [reconciliation, setReconciliation] = useState<BaseTemplateReconciliationResult>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const inspectorTrigger = useRef<HTMLButtonElement>(null);
  const [incompatibleGeneration, setIncompatibleGeneration] = useState<number>();
  const [restorePhase, setRestorePhase] = useState<'confirming' | 'pending'>();
  const restoreInFlight = useRef(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const draftHandle = useRef<LocalBaseTemplateDraftHandle>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const [initial, setInitial] = useState<BlueprintEditorState>();
  const [saved, setSaved] = useState(''); const [editing, setEditing] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const accept = useCallback((doc: BaseTemplateDraftDocument) => { setDocument(doc); setSaved(signature(doc.definition)); }, []);
  const generation = document?.generation;
  const refresh = useCallback(async () => {
    const doc = await dataSource.loadDraft!(templateId);
    if (generation !== undefined && doc.generation !== generation) throw new Error(t('review.conflict'));
    return doc;
  }, [dataSource, templateId, generation, t]);
  useEffect(() => {
    let active = true;
    void dataSource.loadDraft!(templateId).then(doc => {
      if (!active) return;
      accept(doc);
      setInitial(hydrateDraft(doc));
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [dataSource, templateId, accept]);
  // Revalidate on return and periodically. Pending revalidation never asserts safety.
  const [revalidating, setRevalidating] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    setRevalidating(false);
    const validate = () => {
      if (generation === undefined || busy || pending || reconciliationRefreshError) return;
      pending = true;
      setRevalidating(true);
      void refresh().then(doc => { if (active) setDocument(doc); }).catch(e => { if (active) setError(String(e)); }).finally(() => {
        pending = false;
        if (active) setRevalidating(false);
      });
    };
    const timer = window.setInterval(validate, 15000);
    window.addEventListener('focus', validate);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', validate); };
  }, [generation, busy, refresh, reconciliationRefreshError]);
  const changed = useCallback((state: BlueprintEditorState) => { setEditing(signature(createBlueprintRequest(state).request)); setNotice(''); }, []);
  const dirty = editing !== saved;
  const canRestore = document !== undefined && (incompatibleGeneration === generation || document.fiber_types_changed) && !!dataSource.restoreDraftSource;
  const restore = async () => {
    if (!canRestore || restorePhase !== 'confirming' || restoreInFlight.current || busy || revalidating) return;
    restoreInFlight.current = true;
    setRestorePhase('pending');
    setBusy(true); setError(''); setNotice('');
    try {
      const restored = await dataSource.restoreDraftSource!(templateId, document.generation);
      // Only disarm the old editor after the server has committed the restore.
      try { draftHandle.current?.discardAfterRestore(); }
      catch { setError(t('localDraft.error')); }
      setInitial(hydrateDraft(restored));
      setEditorVersion(version => version + 1);
      setIncompatibleGeneration(undefined);
      accept(restored);
    } catch (error) {
      setError(String(error));
    } finally {
      restoreInFlight.current = false;
      setRestorePhase(undefined);
      setBusy(false);
    }
  };
  const restoredNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (editorVersion) setNotice(t('review.sourceRestored'));
  }, [editorVersion, t]);
  useEffect(() => { if (notice === t('review.sourceRestored')) restoredNotice.current?.focus(); }, [notice, t]);
  const outdated = document?.publication_state?.objects ?? [];
  const selection = outdated.filter(item => selectedInstances.includes(item.physical_object_id)).map(item => item.physical_object_id);
  useEffect(() => {
    const available = new Set(document?.publication_state?.objects.map(item => item.physical_object_id));
    setSelectedInstances(previous => {
      const retained = previous.filter(id => available.has(id));
      return retained.length === previous.length ? previous : retained;
    });
  }, [document?.publication_state, templateId]);

  const reconciliationBlocked = busy || revalidating || !!reconciliationRefreshError || !dataSource.reconcileObjects;
  const refreshAfterReconciliation = async () => {
    try {
      setDocument(await refresh());
      setReconciliationRefreshError("");
    } catch (cause) {
      setReconciliationRefreshError(String(cause));
    }
  };
  const reconcile = async (scope: 'all' | 'selected') => {
    if (reconciliationBlocked || (scope === 'selected' && !selection.length)) return;
    setBusy(true); setError(''); setReconciliation(undefined);
    try {
      const result = scope === 'all'
        ? await dataSource.reconcileObjects!(templateId)
        : await dataSource.reconcileObjects!(templateId, selection);
      setReconciliation(result);
      setSelectedInstances([]);
      await refreshAfterReconciliation();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const retryReconciliationRefresh = async () => {
    if (busy || revalidating || !reconciliationRefreshError) return;
    setBusy(true);
    try { await refreshAfterReconciliation(); }
    finally { setBusy(false); }
  };
  const review = document?.review;
  const current = review?.current && !review.published_revision_id && review.draft_generation === generation && !dirty && !busy && !revalidating && !error;
  const { safe, intervention } = reviewCounts(review?.result.objects ?? []);
  const reviewStatus = checking ? 'changeInspector.checking'
    : revalidating ? 'changeInspector.revalidating'
    : review?.published_revision_id ? 'publication.candidatePublished'
    : current ? 'changeInspector.preview'
    : review ? 'review.stale' : 'changeInspector.unchecked';
  return <PageShell className="catalog-page blueprint-editor-page base-template-edit-page">
    <Link to="/library/base-templates">{t('blueprint.breadcrumb.library')}</Link>
    {document?.publication_state && <section className="base-template-publication" aria-label={t('publication.state')}>
      <div className="base-template-summary">
      <p>{t('publication.revision', { number: document.publication_state.version_number })}</p>
      <p>{t('publication.outdated', { count: document.publication_state.outdated_count })}</p>
      <p>{t('publication.awaiting', { count: document.publication_state.awaiting_update_count })}</p>
      <p>{t('publication.intervention', { count: document.publication_state.requires_intervention_count })}</p>
      </div>
      {outdated.length > 0 && <details onToggle={event => setSelectionOpen(event.currentTarget.open)}>
        <summary>{t('reconciliation.selection')}</summary>
        {selectionOpen && <fieldset aria-label={t('reconciliation.selection')} disabled={reconciliationBlocked}>
        {outdated.map(item => <label key={item.physical_object_id}>
          <input type="checkbox" checked={selection.includes(item.physical_object_id)} onChange={event => {
            const checked = event.target.checked;
            setSelectedInstances(current => checked ? [...current, item.physical_object_id] : current.filter(id => id !== item.physical_object_id));
          }} />
          {item.display_name || item.physical_object_id}
        </label>)}
        </fieldset>}
      </details>}
      <div className="base-template-review__actions">
        <button className="primary-action" type="button" disabled={reconciliationBlocked || !selection.length} onClick={() => void reconcile('selected')}>
          {t('reconciliation.applySelected')}
        </button>
        <button className="secondary-action" type="button" disabled={reconciliationBlocked} onClick={() => void reconcile('all')}>
          {t('reconciliation.run')}
        </button>
      </div>
      {reconciliationRefreshError && <>
        <p role="alert">{t('reconciliation.refreshFailed')} {reconciliationRefreshError}</p>
        <button className="primary-action" type="button" disabled={busy || revalidating} onClick={() => void retryReconciliationRefresh()}>
          {t('reconciliation.retryRefresh')}
        </button>
      </>}
    </section>}
    {error && <p role="alert">{error}</p>}
    {document && <section className="base-template-review" aria-label={t('review.impacts')}>
      <div className="base-template-review__actions">
      <button ref={checkButton} className="primary-action" type="button" disabled={busy || dirty || revalidating} onClick={() => {
        setBusy(true); setChecking(true); setError('');
        void dataSource.checkDraft!(templateId, document.generation).then(doc => {
          setIncompatibleGeneration(undefined);
          accept(doc);
        }).catch(error => {
          if (error instanceof BaseTemplateApiError && error.reason === 'PHYSICAL_STRUCTURE_IMMUTABLE') setIncompatibleGeneration(document.generation);
          setError(String(error));
        }).finally(() => { setBusy(false); setChecking(false); });
      }}>{t('review.check')}</button>
      <button className="primary-action" type="button" disabled={busy || !current || !dataSource.publishCandidate} onClick={() => {
        if (!review || !current || busy) return;
        setBusy(true); setError(''); setNotice('');
        void dataSource.publishCandidate!(templateId, review.candidate_id).then(async publication => {
          setNotice(t('publication.completed', { number: publication.version_number }));
          accept(await dataSource.loadDraft!(templateId));
        }).catch(e => setError(String(e))).finally(() => setBusy(false));
      }}>{t('publication.publish')}</button>
      {canRestore && <button className="secondary-action" type="button" disabled={busy || revalidating}
        onClick={() => setRestorePhase('confirming')}>{t('review.restoreSource')}</button>}
      {dirty && <p>{t('review.unsaved')}</p>}
      </div>
      <div className="base-template-review__status">
        <div role="status" data-tone={current && !checking ? (intervention ? 'warning' : safe ? 'positive' : undefined) : undefined}>
          {t(reviewStatus === 'review.stale' ? 'changeInspector.stale' : reviewStatus)}{current && !checking && <> · {t('changeInspector.checked', { count: review.result.objects.length })} · {t('changeInspector.safe', { count: safe })} · {t('changeInspector.blocked', { count: intervention })}</>}
        </div>
        {reconciliation && <p role="status">{t('reconciliation.results')} · {reconciliationCounts(reconciliation, t)}</p>}
        <button className="secondary-action" ref={inspectorTrigger} type="button" onClick={() => setInspectorOpen(true)}>{t('changeInspector.open')}</button>
      </div>
    </section>}
    {document && inspectorOpen && <BaseTemplateChangeInspector document={document} reviewStatus={reviewStatus}
      showPreview={!!current && !checking} reconciliation={reconciliation} onClose={() => {
        setInspectorOpen(false);
        inspectorTrigger.current?.focus();
      }} />}
    {restorePhase && <DestructiveConfirmationDialog
      title={t('review.restoreSource')}
      description={t('review.restoreSourceConfirm')}
      action={t('review.restoreSourceAction')}
      fallbackFocus={() => checkButton.current}
      pendingMessage={restorePhase === 'pending' ? t('review.restoringSource') : undefined}
      onCancel={() => { if (!restoreInFlight.current) setRestorePhase(undefined); }}
      onConfirm={() => void restore()} />}
    {initial && document && <BaseTemplateEditor physicalReadOnly draftHandle={draftHandle} key={`${templateId}:${editorVersion}`} templateId={templateId} generation={document.generation} initialState={initial} title={t('review.edit')} description={t('review.description')} saveLabel={t('review.save')} saveDisabled={busy || revalidating} onStateChange={changed} onSave={async state => {
      if (busy || revalidating) return;
      const result = createBlueprintRequest(state); if (!result.request) throw new Error(result.errors.join(' '));
      setBusy(true); setError(''); setNotice('');
      try { accept(await dataSource.saveDraft!(templateId, result.request, document.generation)); setNotice(t('review.saved')); }
      catch (e) { setError(String(e)); throw e; }
      finally { setBusy(false); }
    }} />}
    <p ref={restoredNotice} hidden={!notice} tabIndex={-1} role="status">{notice}</p>

  </PageShell>;
}
