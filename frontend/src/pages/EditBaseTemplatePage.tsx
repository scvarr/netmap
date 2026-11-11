import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createBlueprintRequest, hydrateBlueprintEditorState, type BlueprintEditorState } from '../blueprints/editorModel';
import { LocalBaseTemplateEditor as BaseTemplateEditor } from './LocalBaseTemplateEditor';
import { PageShell } from '../components/PageChrome';
import { useI18n } from '../i18n';
import type { BaseTemplateDataSource, BaseTemplateDraftDocument, BaseTemplateReconciliationResult, CreateBaseTemplateRequest } from '../topology/baseTemplateTypes';
import { BaseTemplateChangeInspector, reconciliationCounts, reviewCounts } from './BaseTemplateChangeInspector';

const signature = (d?: CreateBaseTemplateRequest) => d ? JSON.stringify(
  [d.name, d.default_physical_object_class ?? null, d.body, d.panels, d.slots, d.internal_links, d.bays ?? []],
  (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value,
) : '';

export function EditBaseTemplatePage({ dataSource }: { dataSource: BaseTemplateDataSource }) {
  const { templateId = '' } = useParams(); const { t } = useI18n();
  const [document, setDocument] = useState<BaseTemplateDraftDocument>();
  const [reconciliation, setReconciliation] = useState<BaseTemplateReconciliationResult>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const inspectorTrigger = useRef<HTMLButtonElement>(null);
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
      const definition = doc.definition;
      setInitial(hydrateBlueprintEditorState({ ...definition, schema_version: '2.0',
        blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: doc.template_id },
        version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: doc.source_revision_id },
        version_number: 1, next_panel_number: Math.max(...definition.panels.map(p => p.panel_number)) + 1 }));
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
      if (generation === undefined || busy || pending) return;
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
  }, [generation, busy, refresh]);
  const changed = useCallback((state: BlueprintEditorState) => { setEditing(signature(createBlueprintRequest(state).request)); setNotice(''); }, []);
  const dirty = editing !== saved;
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
      <button className="primary-action" type="button" disabled={busy || revalidating || !dataSource.reconcileObjects} onClick={() => {
        setBusy(true); setError(''); setReconciliation(undefined);
        void dataSource.reconcileObjects!(templateId).then(async result => {
          setReconciliation(result);
          // Refresh only server facts: unsaved authoring edits stay in the editor.
          setDocument(await refresh());
        }).catch(e => setError(String(e))).finally(() => setBusy(false));
      }}>{t('reconciliation.run')}</button>
    </section>}
    {error && <p role="alert">{error}</p>}
    {document && <section className="base-template-review" aria-label={t('review.impacts')}>
      <div className="base-template-review__actions">
      <button className="primary-action" type="button" disabled={busy || dirty || revalidating} onClick={() => {
        setBusy(true); setChecking(true); setError('');
        void dataSource.checkDraft!(templateId, document.generation).then(accept).catch(e => setError(String(e))).finally(() => { setBusy(false); setChecking(false); });
      }}>{t('review.check')}</button>
      <button className="primary-action" type="button" disabled={busy || !current || !dataSource.publishCandidate} onClick={() => {
        if (!review || !current || busy) return;
        setBusy(true); setError(''); setNotice('');
        void dataSource.publishCandidate!(templateId, review.candidate_id).then(async publication => {
          setNotice(t('publication.completed', { number: publication.version_number }));
          accept(await dataSource.loadDraft!(templateId));
        }).catch(e => setError(String(e))).finally(() => setBusy(false));
      }}>{t('publication.publish')}</button>
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
    {initial && document && <BaseTemplateEditor key={templateId} templateId={templateId} generation={document.generation} initialState={initial} title={t('review.edit')} description={t('review.description')} saveLabel={t('review.save')} saveDisabled={busy || revalidating} onStateChange={changed} onSave={async state => {
      if (busy || revalidating) return;
      const result = createBlueprintRequest(state); if (!result.request) throw new Error(result.errors.join(' '));
      setBusy(true); setError(''); setNotice('');
      try { accept(await dataSource.saveDraft!(templateId, result.request, document.generation)); setNotice(t('review.saved')); }
      catch (e) { setError(String(e)); throw e; }
      finally { setBusy(false); }
    }} />}
    {notice && <p role="status">{notice}</p>}

  </PageShell>;
}
