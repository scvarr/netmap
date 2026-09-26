import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { createPortBlockRequest, generatePortBlock, hydratePortBlockEditorState, newPortBlockEditorState, type PortBlockEditorState } from '../portBlocks/editorModel';
import { useI18n } from '../i18n';
import type { PortBlockDataSource } from '../topology/portBlockTypes';
import { ViewState } from '../components/ViewState';
import { Breadcrumbs, PageHeader, PageShell } from '../components/PageChrome';

export function PortBlockEditorPage({ dataSource, mode }: { dataSource: PortBlockDataSource; mode: 'new' | 'version' }) {
  const { t } = useI18n(); const navigate = useNavigate(); const location = useLocation(); const { portBlockId, versionId } = useParams();
  const [state, setState] = useState<PortBlockEditorState>(() => newPortBlockEditorState());
  const [loading, setLoading] = useState(mode === 'version'); const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false); const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (mode !== 'version') return;
    if (!portBlockId || !versionId) { setError(t('portBlock.editor.invalidAddress')); setLoading(false); return; }
    void dataSource.loadPortBlockVersion(portBlockId, versionId).then((version) => { setState(hydratePortBlockEditorState(version)); setLoading(false); }, (reason) => { setError(reason instanceof Error ? reason.message : t('portBlock.editor.loadFailed')); setLoading(false); });
  }, [dataSource, mode, portBlockId, versionId, t]);
  const breadcrumbs = <Breadcrumbs label={t('portBlock.breadcrumb.library')} items={[{ label: t('portBlock.library.section') }, { label: t('portBlock.breadcrumb.library'), to: '/library/port-blocks' }, { label: mode === 'new' ? t('portBlock.breadcrumb.new') : t('portBlock.breadcrumb.version') }]} />;
  if (loading) return <PageShell className="catalog-page port-block-editor-page">{breadcrumbs}<ViewState kind="loading" /></PageShell>;
  if (error && !attempted) return <PageShell className="catalog-page port-block-editor-page">{breadcrumbs}<ViewState kind="error" message={error} /></PageShell>;
  const update = (patch: Partial<PortBlockEditorState>, regenerate = false) => setState((current) => {
    const next = { ...current, ...patch }; const count = next.rows * next.portsPerRow;
    const localIds = Number.isInteger(count) && count >= 1 && count <= 1000
      ? Array.from({ length: count }, (_, position) => {
          const row = Math.floor(position / next.portsPerRow); const column = position % next.portsPerRow;
          return row < current.rows && column < current.portsPerRow ? current.localIds[row * current.portsPerRow + column] : `p-${crypto.randomUUID()}`;
        }) : current.localIds;
    return { ...next, localIds, preservedSnapshot: regenerate ? null : current.preservedSnapshot };
  });
  const generated = generatePortBlock(state);
  const save = async () => {
    setAttempted(true); const result = createPortBlockRequest(state); if (!result.request) return;
    setSaving(true); setError(null);
    try {
      if (mode === 'new') await dataSource.createPortBlock(result.request);
      else if (portBlockId) await dataSource.createPortBlockVersion(portBlockId, { port_block_name: result.request.name, ports: result.request.ports });
      await dataSource.loadPortBlocks();
      navigate(mode === 'new' && location.state?.returnTo === '/library/object-blueprints/new' ? '/library/object-blueprints/new' : '/library/port-blocks');
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('portBlock.editor.saveFailed')); } finally { setSaving(false); }
  };
  return <PageShell className="catalog-page port-block-editor-page">{breadcrumbs}
    <PageHeader eyebrow={t('portBlock.library.section')} title={mode === 'new' ? t('portBlock.new.title') : t('portBlock.version.title')} description={mode === 'new' ? t('portBlock.new.description') : t('portBlock.version.description')} />
    <div className="port-block-editor"><section className="port-block-editor__controls">
      <label>{t('portBlock.editor.name')}<input value={state.name} onChange={(event) => update({ name: event.target.value })} /></label>
      <div className="blueprint-editor-controls__row">
        <label>{t('portBlock.editor.rows')}<select value={state.rows} onChange={(event) => update({ rows: Number(event.target.value) as 1 | 2 }, true)}><option value={1}>{t('portBlock.rows.one')}</option><option value={2}>{t('portBlock.rows.two')}</option></select></label>
        <label>{t('portBlock.editor.count')}<input type="number" min="1" value={state.portsPerRow} onChange={(event) => update({ portsPerRow: Number(event.target.value) }, true)} /></label>
      </div>
      <label>{t('portBlock.editor.direction')}<select value={state.direction} onChange={(event) => update({ direction: event.target.value as PortBlockEditorState['direction'] }, true)}><option value="LTR">{t('portBlock.direction.ltr')}</option><option value="RTL">{t('portBlock.direction.rtl')}</option></select></label>
      <label>{t('portBlock.editor.kind')}<select value={state.kind} onChange={(event) => update({ kind: event.target.value as PortBlockEditorState['kind'] }, true)}><option value="CONNECTION_POINT">{t('portBlock.kind.connection')}</option><option value="NETWORK_PORT">{t('portBlock.kind.network')}</option></select></label>
      {attempted && generated.validationErrors.length > 0 && <div className="blueprint-editor__error">{generated.validationErrors.map((entry) => <div key={entry}>{t(entry === 'nameRequired' ? 'portBlock.validation.name' : entry === 'portsPerRow' ? 'portBlock.validation.count' : 'portBlock.validation.identity')}</div>)}</div>}
      {error && <div className="blueprint-editor__error">{error}</div>}
      <button type="button" className="primary-action" disabled={saving} onClick={() => void save()}>{saving ? t('portBlock.editor.saving') : mode === 'new' ? t('portBlock.editor.create') : t('portBlock.editor.createVersion')}</button>
    </section><section className="port-block-editor__preview"><h2>{t('portBlock.editor.preview')}</h2><p>{t('portBlock.editor.previewHint')}</p><div className="port-block-preview">{[1, 2].map((row) => row <= state.rows && <div className="port-block-preview__row" key={row}>{generated.ports.filter((port) => port.row === row).sort((a, b) => a.column - b.column).map((port) => <span key={port.local_id}>P{port.layout_order}</span>)}</div>)}</div></section></div>
  </PageShell>;
}
