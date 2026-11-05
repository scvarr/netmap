import { moduleEndpointPositions } from '../topology/hardwareModules';
import { ModuleTemplateEditor } from '../components/ModuleTemplateEditor';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader, PageShell } from '../components/PageChrome';
import { useI18n } from '../i18n';
import { moduleReviewDataSource, type ModuleReconciliationResult, type ModuleDraftDocument, type ModuleReviewDataSource, type ModuleTemplateInput } from '../topology/hardwareModules';

const signature = (d: ModuleTemplateInput) => JSON.stringify([d.name, d.compatibility, d.geometry, d.endpoints.map(e => [e.key, e.display_name, e.kind])]);

export function EditModuleTemplatePage({ dataSource = moduleReviewDataSource }: { dataSource?: ModuleReviewDataSource }) {
  const { templateId = '' } = useParams(); const { t } = useI18n();
  const [results, setResults] = useState<ModuleReconciliationResult>();
  const [document, setDocument] = useState<ModuleDraftDocument>();
  const [definition, setDefinition] = useState<ModuleTemplateInput>();
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false); const [revalidating, setRevalidating] = useState(false);
  const validating = useRef(false);
  useEffect(() => {
    let active = true;
    setDocument(undefined); setDefinition(undefined); setError(''); setNotice(''); setRevalidating(false);
    void dataSource.loadDraft(templateId).then(doc => { if (active) { setDocument(doc); setDefinition(doc.definition); } })
      .catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [dataSource, templateId]);
  useEffect(() => {
    let active = true;
    const validate = () => {
      if (!document || busy || validating.current) return;
      validating.current = true; setRevalidating(true);
      void dataSource.loadDraft(templateId).then(doc => {
        if (!active) return;
        if (doc.generation !== document.generation) throw new Error(t('review.conflict'));
        setDocument(doc);
        setError('');
      }).catch(e => { if (active) setError(String(e)); })
        .finally(() => { validating.current = false; if (active) setRevalidating(false); });
    };
    const timer = window.setInterval(validate, 15000); window.addEventListener('focus', validate);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', validate); };
  }, [dataSource, templateId, document?.generation, busy, t]);
  const dirty = !!document && !!definition && signature(document.definition) !== signature(definition);
  const current = document?.review?.current && !dirty && !busy && !revalidating && !error;
  const change = (value: ModuleTemplateInput) => { value = { ...value, geometry: { ...value.geometry, endpoints: moduleEndpointPositions(value.endpoints, value.geometry.endpoints) } }; setDefinition(value); setNotice(''); };
  const run = async (check: boolean) => {
    if (!document || !definition || busy || revalidating) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const doc = check ? await dataSource.checkDraft(templateId, document.generation)
        : await dataSource.saveDraft(templateId, definition, document.generation);
      setDocument(doc); setDefinition(doc.definition);
      if (!check) setNotice(t('review.saved'));
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const review = document?.review;
  const dependencyLabels = {
    CONNECTIONS: 'review.dep.connections', ENTITY_METADATA: 'review.dep.metadata', INTERFACE_PHYSICAL_BINDINGS: 'review.dep.bindings',
    L2_BINDINGS: 'review.dep.l2', L3_BINDINGS: 'review.dep.l3', NETWORK_INTERFACE_REALIZATIONS: 'review.dep.realizations',
    SECURITY_POLICY_ATTACHMENTS: 'review.dep.security', NAT_POLICY_ATTACHMENTS: 'review.dep.nat', PACKET_PROCESSING_PLAN_ATTACHMENTS: 'review.dep.processing',
    ROUTING_POLICY_RULES: 'review.dep.routing', NETWORK_INTERFACE_PHYSICAL_OWNERS: 'review.dep.owner',
    BUILT_IN_ENDPOINT_MAPPINGS: 'review.dep.mapping', MODULE_ENDPOINT_MAPPINGS: 'review.dep.mapping', CONNECTION_POINT_DATA: 'review.dep.point',
  } as const;
  const reasonLabels = {
    CONCURRENT_CHANGE: 'reconciliation.concurrent', INSTALLATION_CHANGED: 'moduleReconciliation.changed',
    TARGET_REVISION_CHANGED: 'reconciliation.targetChanged', APPLY_FAILED: 'reconciliation.failed',
    BAY_COMPATIBILITY_MISMATCH: 'moduleReview.compatibility', ENDPOINT_DEPENDENCIES: 'review.reason.dependencies',
    ENDPOINT_KIND_CHANGE: 'review.reason.kind', MISSING_ENDPOINT_MAPPING: 'review.reason.mapping',
    INVALID_ENDPOINT_MAPPING: 'reconciliation.mapping', IDENTITY_AND_DATA_PRESERVED: 'review.reason.preserved',
  } as const;
  return <PageShell className="catalog-page">
    <Link to="/library/base-templates">{t('blueprint.breadcrumb.library')}</Link>
    <PageHeader title={t('review.edit')} eyebrow={t('hardware.module')} />
    <p>{t('review.description')}</p>
    {error && <p role="alert">{error}</p>}
    {definition && <form className="module-template-form" onSubmit={e => { e.preventDefault(); void run(false); }}>
      <ModuleTemplateEditor value={definition} onChange={change} disabled={busy} />
        <button type="submit" className="primary-action" disabled={busy || revalidating || !definition.name.trim() || !definition.compatibility.trim() || definition.endpoints.some(e => !e.display_name.trim())}>{t('review.save')}</button>
    </form>}
    {document?.publication_state && <section aria-label={t('publication.state')}>
      <p>{t('publication.revision', { number: document.publication_state.version_number })}</p>
      <p>{t('publication.awaiting', { count: document.publication_state.awaiting_update_count })}</p>
      <p>{t('publication.intervention', { count: document.publication_state.requires_intervention_count })}</p>
      <button type="button" disabled={busy || revalidating || !dataSource.reconcileInstallations} onClick={async () => {
        setBusy(true); setError(''); setResults(undefined);
        try {
          setResults(await dataSource.reconcileInstallations!(templateId));
          setDocument(await dataSource.loadDraft(templateId));
        } catch (e) { setError(String(e)); } finally { setBusy(false); }
      }}>{t('moduleReconciliation.action')}</button>
      {results && <ul>{results.installations.map(i => <li key={i.installation_id}>
        {i.physical_object_id && <Link to={'/infrastructure/objects/' + i.physical_object_id}>{i.display_name || i.physical_object_id}</Link>}
        <p>{i.bay_key} {i.source_revision_id}</p>
        {i.context_at_batch_start && <p>{t('moduleReconciliation.snapshot')}</p>}
        {i.installation_id}: {t(i.status === 'updated' ? 'reconciliation.updated' : i.status === 'already_current' ? 'reconciliation.current' : 'review.attention')}
        <ul>{i.reasons.map((r, n) => <li key={n}>{t(reasonLabels[r.code as keyof typeof reasonLabels] ?? 'review.reason.unknown')} ({r.code}) {r.endpoint_name ?? r.key} {r.dependencies?.join(', ')}</li>)}</ul>
      </li>)}</ul>}
      <ul>{document.publication_state.installations.map(i => <li key={i.installation_id}>
        <Link to={`/infrastructure/objects/${i.physical_object_id}`}>{i.display_name}</Link>
        <p>{t('moduleReview.installation', { id: i.installation_id, revision: i.source_revision_id, bay: i.bay_key })}</p>
        <strong>{t(i.classification === 'requires_intervention' ? 'review.attention' : 'publication.waiting')}</strong>
        <ul>{i.reasons.map((r, n) => <li key={n}>{t(reasonLabels[r.code as keyof typeof reasonLabels] ?? 'review.reason.unknown')} {r.endpoint_name ?? r.key} {r.dependencies?.map(d => t(dependencyLabels[d as keyof typeof dependencyLabels] ?? 'review.dep.other')).join(', ')}</li>)}</ul>
      </li>)}</ul>
    </section>}
    {notice && <p role="status">{notice}</p>}
    {document && <section aria-label={t('review.impacts')}>
      <button type="button" disabled={busy || revalidating || dirty} onClick={() => void run(true)}>{t('review.check')}</button>
      <button type="button" disabled={!current || !!review?.published_revision_id} onClick={async () => {
        if (!review || !current) return;
        setBusy(true); setError(''); setNotice('');
        try {
          const published = await dataSource.publishCandidate(templateId, review.candidate_id);
          const doc = await dataSource.loadDraft(templateId);
          setDocument(doc); setDefinition(doc.definition);
          setNotice(t('publication.completed', { number: published.version_number }));
        } catch (e) { setError(String(e)); } finally { setBusy(false); }
      }}>{t('publication.publish')}</button>
      {dirty && <p>{t('review.unsaved')}</p>}
      {review && <>
        <p>{t('review.candidate', { id: review.candidate_id, time: review.created_at })}</p>
        <p>{t(review.published_revision_id ? 'publication.candidatePublished' : current ? 'review.current' : 'review.stale')}</p>
        {current && <>
          <ul>{review.result.changes.map((c, i) => <li key={i}>{t(c.section === 'endpoints' ? 'moduleReview.endpoints' : 'review.section.properties')} В· {t(`review.operation.${c.operation}`)} В· {c.section === 'properties' ? t(c.key === 'name' ? 'hardware.name' : 'hardware.compatibility') : (typeof c.after === 'object' && c.after && 'display_name' in c.after && c.after.display_name) || (typeof c.before === 'object' && c.before && 'display_name' in c.before && c.before.display_name) || t('moduleGeometry.title')}</li>)}</ul>
          {!review.result.installations.length && <p>{t('moduleReview.noInstallations')}</p>}
          <ul>{review.result.installations.map(i => <li key={i.installation_id}>
            <Link to={`/infrastructure/objects/${i.physical_object_id}`}>{i.display_name}</Link>
            <p>{t('moduleReview.installation', { id: i.installation_id, revision: i.source_revision_id, bay: i.bay_key })}</p>
            <strong>{t(i.classification === 'potentially_safe' ? 'review.safe' : 'review.attention')}</strong>
            <ul>{i.reasons.map((r, n) => <li key={n}>
              {t(reasonLabels[r.code as keyof typeof reasonLabels] ?? 'review.reason.unknown')}
              {' '}{r.endpoint_name ?? r.key}{r.dependencies?.length ? ` (${r.dependencies.map(d => t(dependencyLabels[d as keyof typeof dependencyLabels] ?? 'review.dep.other')).join(', ')})` : ''}
            </li>)}</ul>
          </li>)}</ul>
        </>}
      </>}
    </section>}
  </PageShell>;
}
