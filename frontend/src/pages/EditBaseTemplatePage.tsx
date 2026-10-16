import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createBlueprintRequest, hydrateBlueprintEditorState, type BlueprintEditorState } from '../blueprints/editorModel';
import { BaseTemplateEditor } from './BaseTemplateEditor';
import { PageShell } from '../components/PageChrome';
import { useI18n } from '../i18n';
import type { BaseTemplateDataSource, BaseTemplateDraftDocument, CreateBaseTemplateRequest, TemplateImpactReason } from '../topology/baseTemplateTypes';

const signature = (d?: CreateBaseTemplateRequest) => d ? JSON.stringify(
  [d.name, d.default_physical_object_class ?? null, d.body, d.panels, d.slots, d.internal_links, d.bays ?? []],
  (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value,
) : '';

export function EditBaseTemplatePage({ dataSource }: { dataSource: BaseTemplateDataSource }) {
  const { templateId = '' } = useParams(); const { t } = useI18n();
  const [document, setDocument] = useState<BaseTemplateDraftDocument>();
  const [initial, setInitial] = useState<BlueprintEditorState>();
  const [saved, setSaved] = useState(''); const [editing, setEditing] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const accept = useCallback((doc: BaseTemplateDraftDocument) => { setDocument(doc); setSaved(signature(doc.definition)); }, []);
  const refresh = useCallback(async () => {
    const doc = await dataSource.loadDraft!(templateId);
    if (document && doc.generation !== document.generation) throw new Error(t('review.conflict'));
    setDocument(doc);
    return doc;
  }, [dataSource, templateId, document?.generation, t]);
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
    const validate = () => {
      if (!document?.review || busy) return;
      setRevalidating(true);
      void refresh().catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setRevalidating(false); });
    };
    const timer = window.setInterval(validate, 15000);
    window.addEventListener('focus', validate);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', validate); };
  }, [document?.review, busy, refresh]);
  const changed = useCallback((state: BlueprintEditorState) => { setEditing(signature(createBlueprintRequest(state).request)); setNotice(''); }, []);
  const dirty = editing !== saved;
  const reason = (r: TemplateImpactReason) => {
    const labels = {
      IDENTITY_AND_DATA_PRESERVED: 'review.reason.preserved', ENDPOINT_DEPENDENCIES: 'review.reason.dependencies',
      MISSING_ENDPOINT_MAPPING: 'review.reason.mapping', ENDPOINT_KIND_CHANGE: 'review.reason.kind',
      INSUFFICIENT_COMPATIBLE_CAPACITY: 'review.reason.capacity', INTERNAL_LINK_CONNECTIONS: 'review.reason.links',
    } as const;
    const dependencies = {
      CONNECTIONS: 'review.dep.connections', ENTITY_METADATA: 'review.dep.metadata', INTERFACE_PHYSICAL_BINDINGS: 'review.dep.bindings',
      L2_BINDINGS: 'review.dep.l2', L3_BINDINGS: 'review.dep.l3', NETWORK_INTERFACE_REALIZATIONS: 'review.dep.realizations',
      SECURITY_POLICY_ATTACHMENTS: 'review.dep.security', NAT_POLICY_ATTACHMENTS: 'review.dep.nat', PACKET_PROCESSING_PLAN_ATTACHMENTS: 'review.dep.processing',
      ROUTING_POLICY_RULES: 'review.dep.routing', ROUTING_POLICIES: 'review.dep.routing', NETWORK_INTERFACE_PHYSICAL_OWNERS: 'review.dep.owner',
      BUILT_IN_ENDPOINT_MAPPINGS: 'review.dep.mapping', MODULE_ENDPOINT_MAPPINGS: 'review.dep.mapping', CONNECTION_POINT_DATA: 'review.dep.point',
    } as const;
    return `${t(labels[r.code as keyof typeof labels] ?? 'review.reason.unknown')} ${r.endpoint_name ?? (r.key ? (Array.isArray(r.key) ? r.key.join(' ↔ ') : r.key) : '')} ${r.compatibility ?? ''}${r.dependencies?.length ? ` (${r.dependencies.map(d => t(dependencies[d as keyof typeof dependencies] ?? 'review.dep.other')).join(', ')})` : ''}`;
  };
  const review = document?.review;
  const current = review?.current && !dirty && !revalidating && !error;
  return <PageShell className="catalog-page blueprint-editor-page">
    <Link to="/library/base-templates">{t('blueprint.breadcrumb.library')}</Link>
    {error && <p role="alert">{error}</p>}
    {initial && document && <BaseTemplateEditor key={templateId} initialState={initial} title={t('review.edit')} description={t('review.description')} saveLabel={t('review.save')} saveDisabled={busy} onStateChange={changed} onSave={async state => {
      if (busy) return;
      const result = createBlueprintRequest(state); if (!result.request) throw new Error(result.errors.join(' '));
      setBusy(true); setError(''); setNotice('');
      try { accept(await dataSource.saveDraft!(templateId, result.request, document.generation)); setNotice(t('review.saved')); }
      catch (e) { setError(String(e)); throw e; }
      finally { setBusy(false); }
    }} />}
    {notice && <p role="status">{notice}</p>}
    {document && <section aria-label={t('review.impacts')}>
      <button className="primary-action" type="button" disabled={busy || dirty} onClick={() => {
        setBusy(true); setError('');
        void dataSource.checkDraft!(templateId, document.generation).then(accept).catch(e => setError(String(e))).finally(() => setBusy(false));
      }}>{t('review.check')}</button>
      {dirty && <p>{t('review.unsaved')}</p>}
      {review && <>
        <h2>{t('review.impacts')}</h2>
        <p>{t('review.candidate', { id: review.candidate_id, time: review.created_at })}</p>
        <p>{t(current ? 'review.current' : 'review.stale')}</p>
        <ul>{review.result.changes.map((c, i) => <li key={i}>{t(`review.section.${c.section}` as 'review.section.properties')} · {t(`review.operation.${c.operation}` as 'review.operation.changed')} · {Array.isArray(c.key) ? c.key.join(' ↔ ') : c.key}</li>)}</ul>
        {current && <>{review.result.objects.length === 0 && <p>{t('review.noObjects')}</p>}
          <ul>{review.result.objects.map(object => <li key={object.physical_object_id}>
            <Link to={`/infrastructure/objects/${object.physical_object_id}`}>{object.display_name ?? object.physical_object_id}</Link>: <strong>{t(object.classification === 'potentially_safe' ? 'review.safe' : 'review.attention')}</strong>
            <ul>{object.reasons.map((r, i) => <li key={i}>{reason(r)}</li>)}</ul>
            {Object.entries(object.proposed_placements).map(([installation, bay]) => <p key={installation}>{t('review.placement', { installation, bay })}</p>)}
          </li>)}</ul></>}
      </>}
    </section>}
  </PageShell>;
}
