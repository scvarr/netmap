import { DestructiveConfirmationDialog } from '../components/DestructiveConfirmationDialog';
import { mountTypeId } from '../topology/hardwareModules';
import { moduleEndpointPositions } from '../topology/hardwareModules';
import { ModuleTemplateEditor } from '../components/ModuleTemplateEditor';
import { TransceiverTemplateForm } from '../components/TransceiverTemplateForm';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Breadcrumbs, PageHeader, PageShell } from '../components/PageChrome';
import { useI18n } from '../i18n';
import { moduleReviewDataSource, type ModuleReconciliationResult, type ModuleDraftDocument, type ModuleReviewDataSource, type ModuleTemplateInput } from '../topology/hardwareModules';

const signature = (d: ModuleTemplateInput) => JSON.stringify([d.name, d.mount_kind, mountTypeId(d), d.geometry, d.module_places ?? [], d.endpoints, d.transceiver, d.internal_links ?? []]);

export function EditModuleTemplatePage({ dataSource = moduleReviewDataSource, transceiverRoute = false }: {
  dataSource?: ModuleReviewDataSource; transceiverRoute?: boolean;
}) {
  const { templateId = '' } = useParams(); const { t } = useI18n();
  const [results, setResults] = useState<ModuleReconciliationResult>();
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  const [document, setDocument] = useState<ModuleDraftDocument>();
  const [definition, setDefinition] = useState<ModuleTemplateInput>();
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false); const [revalidating, setRevalidating] = useState(false);
  const [restorePhase, setRestorePhase] = useState<'confirming' | 'pending'>();
  const restoring = useRef(false);
  useEffect(() => {
    let active = true;
    setDocument(undefined); setDefinition(undefined); setError(''); setNotice(''); setRevalidating(false);
    setRestorePhase(undefined);
    void dataSource.loadDraft(templateId).then(doc => { if (active) { setDocument(doc); setDefinition(doc.definition); } })
      .catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [dataSource, templateId]);
  useEffect(() => {
    let active = true;
    let validating = false;
    setRevalidating(false);
    const validate = () => {
      if (!document || busy || restorePhase || validating) return;
      validating = true; setRevalidating(true);
      void dataSource.loadDraft(templateId).then(doc => {
        if (!active) return;
        if (doc.generation !== document.generation) throw new Error(t('review.conflict'));
        setDocument(doc);
        setError('');
      }).catch(e => { if (active) setError(String(e)); })
        .finally(() => { validating = false; if (active) setRevalidating(false); });
    };
    const timer = window.setInterval(validate, 15000); window.addEventListener('focus', validate);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', validate); };
  }, [dataSource, templateId, document?.generation, busy, restorePhase, t]);
  const dirty = !!document && !!definition && signature(document.definition) !== signature(definition);

  const incompatible = document?.source_wiring?.draft_incompatible;
  const current = !incompatible && document?.review?.current && !dirty && !busy && !revalidating && !error;
  const change = (value: ModuleTemplateInput) => { value = { ...value, geometry: { ...value.geometry, endpoints: moduleEndpointPositions(value.endpoints, value.geometry.endpoints) } }; setDefinition(value); setNotice(''); };
  const run = async (check: boolean) => {
    if (!document || !definition || busy || restorePhase || revalidating || (check && dirty)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const doc = check ? await dataSource.checkDraft(templateId, document.generation)
        : await dataSource.saveDraft(templateId, definition, document.generation);
      setDocument(doc); setDefinition(doc.definition);
      if (!check) setNotice(t('review.saved'));
    } catch (e) {
      setError(String(e));
    } finally { setBusy(false); }
  };
  const canRestore = (incompatible || document?.source_wiring?.fiber_types_changed) && !!dataSource.restoreDraftSource;
  const restore = async () => {
    if (!document || !canRestore || restorePhase !== 'confirming' || restoring.current || busy || revalidating) return;
    restoring.current = true;
    setRestorePhase('pending'); setBusy(true); setError(''); setNotice('');
    try {
      const restored = await dataSource.restoreDraftSource!(templateId, document.generation);
      setDocument(restored); setDefinition(restored.definition);
      setNotice(t('review.sourceRestored'));
    } catch (e) {
      setError(String(e));
    } finally {
      restoring.current = false;
      setRestorePhase(undefined); setBusy(false);
    }
  };
  const outdated = document?.publication_state?.installations ?? [];
  const selection = outdated.filter(item => selectedInstances.includes(item.installation_id)).map(item => item.installation_id);
  const review = document?.review;
  const transceiver = definition ? definition.mount_kind === 'MODULE_PORT' : transceiverRoute;
  const title = t(transceiver ? 'transceiver.edit' : 'review.edit');
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
    NESTED_INSTALLATION_RECONCILE_BLOCKED: 'review.reason.nestedInstallations',
    INVALID_NESTED_PLACEMENT: 'review.reason.invalidNestedPlacement',
    NESTED_PLACE_COMPATIBILITY_MISMATCH: 'review.reason.nestedMountMismatch',
    NO_COMPATIBLE_NESTED_PLACEMENT: 'review.reason.nestedCapacity',
    AMBIGUOUS_NESTED_PLACEMENT: 'review.reason.nestedAmbiguity',
    TRANSCEIVER_BINDING_REQUIRED: 'hardware.error.transceiverReconcile',
    MODULE_LAYOUT_PANEL_CONFLICT: 'changeInspector.panelConflict',
    NESTED_MODULE_PORTS_UNSUPPORTED: 'moduleReview.nestedPortsUnsupported',
    BAY_COMPATIBILITY_MISMATCH: 'moduleReview.compatibility', PHYSICAL_STRUCTURE_IMMUTABLE: 'review.reason.immutable', ENDPOINT_DEPENDENCIES: 'review.reason.dependencies',
    HARDWARE_INTERFACE_ASSOCIATION_CHANGE: 'review.reason.hardwareInterface',
    ENDPOINT_KIND_CHANGE: 'review.reason.kind', MISSING_ENDPOINT_MAPPING: 'review.reason.mapping',
    INVALID_ENDPOINT_MAPPING: 'reconciliation.mapping', IDENTITY_AND_DATA_PRESERVED: 'review.reason.preserved',
  } as const;
  return <PageShell className="catalog-page">
    <Breadcrumbs label={t('blueprint.breadcrumb.library')} items={[{
      label: t(transceiver ? 'transceiver.library' : 'templateLibrary.modules'),
      to: '/library/base-templates?tab=' + (transceiver ? 'transceivers' : 'modules'),
    }, { label: title }]} />
    <PageHeader title={title} />
    <p>{t('review.description')}</p>
    {error && <p role="alert">{error}</p>}
    {incompatible && <p role="alert">{t('moduleReview.incompatibleDraft')}</p>}
    {!transceiver && canRestore && <button type="button" className="secondary-action" disabled={busy || revalidating}
      onClick={() => setRestorePhase('confirming')}>{t('review.restoreSource')}</button>}
    {restorePhase && <DestructiveConfirmationDialog title={t('review.restoreSource')}
      description={t('review.restoreSourceConfirm')} action={t('review.restoreSourceAction')}
      pendingMessage={restorePhase === 'pending' ? t('review.restoringSource') : undefined}
      onCancel={() => { if (!restoring.current) setRestorePhase(undefined); }}
      onConfirm={() => void restore()} />}
    {definition && <form className="module-template-form" onSubmit={e => { e.preventDefault(); void run(false); }}>
      {transceiver ? <TransceiverTemplateForm value={definition} onChange={change} disabled={busy} />
        : document?.source_wiring && <ModuleTemplateEditor value={definition} onChange={change} disabled={busy} publishedWiring={document.source_wiring} />}
        <button type="submit" className="primary-action" disabled={busy || revalidating || !definition.name.trim() || !mountTypeId(definition) || definition.endpoints.some(e => !e.display_name.trim()) || definition.module_places?.some(port => !port.display_name.trim() || !mountTypeId(port))}>{t('review.save')}</button>
    </form>}
    {document?.publication_state && <section aria-label={t('publication.state')}>
      <p>{t('publication.revision', { number: document.publication_state.version_number })}</p>
      <p>{t('publication.awaiting', { count: document.publication_state.awaiting_update_count })}</p>
      <p>{t('publication.intervention', { count: document.publication_state.requires_intervention_count })}</p>
      {outdated.length > 0 && <details onToggle={event => setSelectionOpen(event.currentTarget.open)}>
        <summary>{t('reconciliation.selection')}</summary>
        {selectionOpen && <fieldset aria-label={t('reconciliation.selection')} disabled={busy || revalidating}>
        {outdated.map(item => <label key={item.installation_id}>
          <input type="checkbox" checked={selection.includes(item.installation_id)} onChange={event => {
            const checked = event.target.checked;
            setSelectedInstances(current => checked ? [...current, item.installation_id] : current.filter(id => id !== item.installation_id));
          }} />
          {item.display_name || item.physical_object_id} · {item.bay_key}
        </label>)}
        </fieldset>}
      </details>}
      <button type="button" disabled={busy || revalidating || !dataSource.reconcileInstallations} onClick={async () => {
        setBusy(true); setError(''); setResults(undefined);
        try {
          setResults(await (selection.length ? dataSource.reconcileInstallations!(templateId, selection) : dataSource.reconcileInstallations!(templateId)));
          setSelectedInstances([]);
          const refreshed = await dataSource.loadDraft(templateId);
          if (refreshed.generation !== document.generation) throw new Error(t('review.conflict'));
          setDocument(refreshed);
        } catch (e) { setError(String(e)); } finally { setBusy(false); }
      }}>{t(selection.length ? 'reconciliation.applySelected' : 'moduleReconciliation.action')}</button>
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
          <ul>{review.result.changes.map((c, i) => <li key={i}>{t(c.section === 'endpoints' ? 'moduleReview.endpoints' : c.section === 'module_places' ? 'moduleMount.places' : 'review.section.properties')} · {t(`review.operation.${c.operation}`)} · {c.section === 'properties' ? t(c.key === 'name' ? 'hardware.name' : c.key === 'transceiver' ? 'transceiver.specifications' : c.key === 'fiber_types' ? 'fiber.type' : 'hardware.compatibility') : (typeof c.after === 'object' && c.after && 'display_name' in c.after && c.after.display_name) || (typeof c.before === 'object' && c.before && 'display_name' in c.before && c.before.display_name) || t('moduleGeometry.title')}</li>)}</ul>
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
