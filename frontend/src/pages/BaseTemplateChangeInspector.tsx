import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type MessageKey } from '../i18n';
import type { BaseTemplateDraftDocument, BaseTemplateReconciliationResult, BaseTemplateReviewDocument, TemplateImpactReason } from '../topology/baseTemplateTypes';

function useReasonDescription() {
  const { t } = useI18n();
  return (r: TemplateImpactReason) => {
    const labels = {
      IDENTITY_AND_DATA_PRESERVED: 'review.reason.preserved', ENDPOINT_DEPENDENCIES: 'review.reason.dependencies',
      MISSING_ENDPOINT_MAPPING: 'review.reason.mapping', ENDPOINT_KIND_CHANGE: 'review.reason.kind',
      INSUFFICIENT_COMPATIBLE_CAPACITY: 'review.reason.capacity', INTERNAL_LINK_CONNECTIONS: 'review.reason.links',
      INVALID_ENDPOINT_MAPPING: 'reconciliation.mapping', INTERNAL_LINK_CARDINALITY: 'reconciliation.cardinality',
      MODULE_LAYOUT_PANEL_CONFLICT: 'changeInspector.panelConflict',
      CONCURRENT_CHANGE: 'reconciliation.concurrent', OBJECT_CHANGED: 'reconciliation.objectChanged',
      TARGET_REVISION_CHANGED: 'reconciliation.targetChanged', APPLY_FAILED: 'reconciliation.failed',
    } as const;
    const dependencies = {
      CONNECTIONS: 'review.dep.connections', ENTITY_METADATA: 'review.dep.metadata', INTERFACE_PHYSICAL_BINDINGS: 'review.dep.bindings',
      L2_BINDINGS: 'review.dep.l2', L3_BINDINGS: 'review.dep.l3', NETWORK_INTERFACE_REALIZATIONS: 'review.dep.realizations',
      SECURITY_POLICY_ATTACHMENTS: 'review.dep.security', NAT_POLICY_ATTACHMENTS: 'review.dep.nat', PACKET_PROCESSING_PLAN_ATTACHMENTS: 'review.dep.processing',
      ROUTING_POLICY_RULES: 'review.dep.routing', ROUTING_POLICIES: 'review.dep.routing', NETWORK_INTERFACE_PHYSICAL_OWNERS: 'review.dep.owner',
      BUILT_IN_ENDPOINT_MAPPINGS: 'review.dep.mapping', MODULE_ENDPOINT_MAPPINGS: 'review.dep.mapping', CONNECTION_POINT_DATA: 'review.dep.point',
    } as const;
    return `${t(labels[r.code as keyof typeof labels] ?? 'review.reason.unknown')} ${r.endpoint_name ?? (r.key ? (Array.isArray(r.key) ? r.key.join(' в†” ') : r.key) : '')} ${r.compatibility === undefined ? '' : JSON.stringify(r.compatibility)}${r.dependencies?.length ? ` (${r.dependencies.map(d => t(dependencies[d as keyof typeof dependencies] ?? 'review.dep.other')).join(', ')})` : ''}`;
  };
}
type Translate = ReturnType<typeof useI18n>['t'];
type Impact = BaseTemplateReviewDocument['result']['objects'][number];

export function reviewCounts(objects: Impact[]) {
  const intervention = objects.filter(object => object.classification === 'requires_intervention').length;
  return { intervention, safe: objects.length - intervention };
}

export function reconciliationCounts(result: BaseTemplateReconciliationResult, t: Translate) {
  const counts = { updated: 0, already_current: 0, requires_intervention: 0 };
  for (const object of result.objects) counts[object.status]++;
  return t('changeInspector.appliedCounts', counts);
}

function displayName(snapshot: unknown) {
  if (snapshot && typeof snapshot === 'object' && 'display_name' in snapshot && typeof snapshot.display_name === 'string') {
    return snapshot.display_name;
  }
}

function logicalGroup(snapshot: unknown) {
  if (snapshot && typeof snapshot === 'object' && 'kind' in snapshot && snapshot.kind === 'LOGICAL'
    && 'panel_key' in snapshot && typeof snapshot.panel_key === 'string'
    && 'compatibility' in snapshot && typeof snapshot.compatibility === 'string') {
    return { panel: snapshot.panel_key, compatibility: snapshot.compatibility };
  }
}

function ChangeSummary({ review }: { review: BaseTemplateReviewDocument }) {
  const { t } = useI18n();
  const { definition, result } = review;
  const panels = new Map(definition.panels.map(panel => [panel.panel_key, panel.display_name]));
  const slots = new Map(definition.slots.map(slot => [slot.key, slot.display_name]));
  const bays = new Map(definition.bays?.map(bay => [bay.bay_key, bay.display_name]));
  const groups = new Map<string, { panel: string; compatibility: string; delta: number; after: number; keys: Set<string> }>();
  for (const change of result.changes) {
    const name = displayName(change.before);
    if (typeof change.key !== 'string' || !name) continue;
    const names = change.section === 'panels' ? panels : change.section === 'slots' ? slots : undefined;
    if (names && !names.has(change.key)) names.set(change.key, name);
  }
  const other = result.changes.filter(change => {
    if (change.section !== 'bays' || typeof change.key !== 'string') return true;
    const before = logicalGroup(change.before);
    const after = logicalGroup(change.after);
    for (const [group, delta] of [[before, -1], [after, 1]] as const) {
      if (!group) continue;
      const key = JSON.stringify([group.panel, group.compatibility]);
      const entry = groups.get(key) ?? { ...group, delta: 0, after: 0, keys: new Set<string>() };
      entry.delta += delta;
      entry.keys.add(change.key);
      groups.set(key, entry);
    }
    // A transition to or from a physical bay also has a named physical side.
    return (!before && !after) || (!!change.before && !before) || (!!change.after && !after);
  });
  // The candidate snapshot supplies the final count. The server diff supplies
  // the net change, even after publication advances the draft's source revision.
  for (const bay of definition.bays ?? []) {
    if (bay.kind !== 'LOGICAL') continue;
    const group = groups.get(JSON.stringify([bay.panel_key, bay.compatibility]));
    if (group) group.after++;
  }
  const sections: Record<string, MessageKey> = {
    properties: 'review.section.properties', panels: 'review.section.panels',
    slots: 'review.section.slots', bays: 'review.section.bays', internal_links: 'review.section.internal_links',
  };
  const properties: Record<string, MessageKey> = {
    name: 'blueprint.editor.name', default_physical_object_class: 'blueprint.editor.class', body: 'changeInspector.body',
  };
  return <>
    <h3>{t('changeInspector.changes')}</h3>
    {result.changes.length === 0 && <p>{t('changeInspector.noChanges')}</p>}
    <ul>
      {[...groups].map(([key, group]) => <li key={key}>
        {t('changeInspector.places', {
          panel: panels.get(group.panel) ?? t('changeInspector.unnamedPanel'),
          compatibility: JSON.stringify(group.compatibility),
          before: group.after - group.delta, after: group.after,
          delta: group.delta < 0 ? `−${-group.delta}` : group.delta > 0 ? `+${group.delta}` : '0',
        })}
        <Technical>{[group.panel, ...group.keys].join('\n')}</Technical>
      </li>)}
      {other.map((change, i) => {
        const { section, key, operation } = change;
        const names = section === 'panels' ? panels : section === 'slots' ? slots : section === 'bays' ? bays : undefined;
        const name = Array.isArray(key)
          ? key.map(slot => slots.get(slot) ?? t('changeInspector.unnamedEndpoint')).join(' ↔ ')
          : section === 'properties' && properties[key] ? t(properties[key])
          : displayName(change.after) ?? displayName(change.before) ?? names?.get(key);
        return <li key={i}>
          {t(operation === 'added' ? 'review.operation.added' : operation === 'removed' ? 'review.operation.removed' : 'review.operation.changed')}
          {' · '}{t(sections[section] ?? 'changeInspector.unknownChange')}{name && ` · ${name}`}
          <Technical>{Array.isArray(key) ? key.join(' ↔ ') : key}</Technical>
        </li>;
      })}
    </ul>
  </>;
}

function Technical({ children }: { children: string | (() => string) }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return <details className="base-template-inspector__technical" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{t('inspector.technical')}</summary>
    {expanded && <pre>{typeof children === 'function' ? children() : children}</pre>}
  </details>;
}

type ObjectRow = { physical_object_id: string; display_name?: string; reasons: TemplateImpactReason[] };

function ObjectList({ objects, status, blocked = false }: {
  objects: ObjectRow[]; status: MessageKey; blocked?: boolean;
}) {
  const { t } = useI18n();
  const reason = useReasonDescription();
  return <ul>{objects.map(object => <li key={object.physical_object_id}>
    <Link to={`/infrastructure/objects/${object.physical_object_id}`}>
      {object.display_name && object.display_name !== object.physical_object_id ? object.display_name : t('changeInspector.unnamedObject')}
    </Link>{' · '}{t(status)}
    {object.reasons.length > 0 && <ul>{object.reasons.map((item, i) => <li key={i}>{reason(item)}</li>)}</ul>}
    {blocked && <p>{t('changeInspector.staysPinned')}</p>}
    <Technical>{() => JSON.stringify(object, null, 2)}</Technical>
  </li>)}</ul>;
}

function ObjectDisclosure({ objects, status, blocked }: { objects: ObjectRow[]; status: MessageKey; blocked?: boolean }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(!!blocked);
  if (!objects.length) return null;
  return <details className="base-template-details" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{t(status)} · {objects.length}</summary>
    {expanded && <ObjectList objects={objects} status={status} blocked={blocked} />}
  </details>;
}

export function BaseTemplateChangeInspector({ document, reviewStatus, showPreview, reconciliation, onClose }: {
  document: BaseTemplateDraftDocument;
  reviewStatus: MessageKey;
  showPreview: boolean;
  reconciliation?: BaseTemplateReconciliationResult;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const title = useId();
  useEffect(() => {
    const modal = dialog.current!;
    modal.showModal();
    close.current?.focus();
    return () => { if (modal.open) modal.close(); };
  }, []);
  const { review, publication_state: publication } = document;
  const previewObjects = showPreview ? review?.result.objects ?? [] : [];
  return <dialog ref={dialog} className="base-template-inspector" aria-labelledby={title}
    onCancel={event => { event.preventDefault(); dialog.current?.close(); onClose(); }}>
    <header className="base-template-inspector__header">
      <h2 id={title}>{t('changeInspector.title')}</h2>
      <button className="secondary-action" ref={close} type="button" onClick={() => { dialog.current?.close(); onClose(); }}>{t('action.close')}</button>
    </header>
    <div className="base-template-inspector__body">
      <p>{review?.definition.name ?? document.definition.name}</p>
      {publication && <p>{t('publication.revision', { number: publication.version_number })}</p>}
      <section>
        <h3>{t('changeInspector.preview')}</h3>
        <p>{t(showPreview ? 'review.current' : reviewStatus)}</p>
        {review && <>
          <p>{t('changeInspector.snapshot', { generation: review.draft_generation })}</p>
          <ChangeSummary review={review} />
          <Technical>{t('review.candidate', { id: review.candidate_id, time: review.created_at })}</Technical>
        </>}
        {showPreview && previewObjects.length === 0 && <p>{t('review.noObjects')}</p>}
        <ObjectDisclosure objects={previewObjects.filter(object => object.classification === 'requires_intervention')} status="review.attention" blocked />
        <ObjectDisclosure objects={previewObjects.filter(object => object.classification === 'potentially_safe')} status="review.safe" />
      </section>
      {reconciliation && <section>
        <h3>{t('reconciliation.results')} · {t('blueprint.library.version', { version: reconciliation.version_number })}</h3>
        <p>{reconciliationCounts(reconciliation, t)}</p>
        <ObjectDisclosure objects={reconciliation.objects.filter(object => object.status === 'requires_intervention')} status="review.attention" blocked />
        <ObjectDisclosure objects={reconciliation.objects.filter(object => object.status === 'updated')} status="reconciliation.updated" />
        <ObjectDisclosure objects={reconciliation.objects.filter(object => object.status === 'already_current')} status="reconciliation.current" />
      </section>}
      {publication && <section>
        <h3>{t('publication.objects')}</h3>
        <ObjectDisclosure objects={publication.objects.filter(object => object.classification === 'requires_intervention')} status="review.attention" blocked />
        <ObjectDisclosure objects={publication.objects.filter(object => object.classification === 'potentially_safe')} status="publication.waiting" />
        <ObjectDisclosure objects={publication.current_objects.map(object => ({ ...object, reasons: [] }))} status="reconciliation.current" />
      </section>}
    </div>
  </dialog>;
}
