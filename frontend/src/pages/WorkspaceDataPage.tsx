import { useRef, useState, type ChangeEvent } from 'react';
import { Breadcrumbs, PageHeader, PageShell } from '../components/PageChrome';
import { useI18n } from '../i18n';

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') {
      return body.detail;
    }
  } catch { /* Use the localized fallback. */ }
  return fallback;
}

export function WorkspaceDataPage() {
  const { t } = useI18n();
  const importInput = useRef<HTMLInputElement>(null);
  const [exportName, setExportName] = useState('netmap-workspace');
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (operation: () => Promise<string>) => {
    setBusy(true);
    setStatus(null);
    setError(null);
    try { setStatus(await operation()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('workspace.unknownError')); }
    finally { setBusy(false); }
  };

  const exportData = () => run(async () => {
    const response = await fetch('/api/v1/workspace/package');
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
      throw new Error(t('workspace.exportFailed'));
    }
    const url = URL.createObjectURL(await response.blob());
    try {
      const link = document.createElement('a');
      link.href = url;
      const basename = exportName.trim() || 'netmap-workspace';
      link.download = /\.json$/i.test(basename) ? basename : `${basename}.json`;
      document.body.append(link);
      link.click();
      link.remove();
    } finally { URL.revokeObjectURL(url); }
    return t('workspace.exported');
  });

  const importData = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSelectedFileName(file.name);
    void run(async () => {
      const response = await fetch('/api/v1/workspace/package', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: file,
      });
      if (response.status !== 204) {
        if (response.status === 409) throw new Error(t('workspace.nonempty'));
        if (response.status === 422) throw new Error(t('workspace.invalidPackage'));
        if (response.status === 413) throw new Error(t('workspace.tooLarge'));
        throw new Error(await errorMessage(response, t('workspace.importFailed')));
      }
      return t('workspace.imported');
    });
  };

  const resetData = () => {
    if (!window.confirm(t('workspace.resetConfirm'))) return;
    void run(async () => {
      const response = await fetch('/api/v1/workspace/dataset', { method: 'DELETE' });
      if (response.status !== 204) throw new Error(await errorMessage(response, t('workspace.resetFailed')));
      return t('workspace.resetDone');
    });
  };

  return <PageShell className="catalog-page">
    <Breadcrumbs label={t('workspace.title')} items={[{ label: t('workspace.title') }]} />
    <PageHeader eyebrow={t('workspace.section')} title={t('workspace.title')} description={t('workspace.description')} />
    <section className="catalog-surface workspace-data-actions" aria-label={t('workspace.title')}>
      <div><h2>{t('workspace.export')}</h2><p>{t('workspace.exportHint')}</p>
        <label className="workspace-data-filename"><span>{t('workspace.filename')}</span><input type="text" value={exportName} disabled={busy} onChange={(event) => setExportName(event.target.value)} /></label>
        <button className="primary-action" type="button" disabled={busy} onClick={() => void exportData()}>{t('workspace.export')}</button>
      </div>
      <div><h2>{t('workspace.import')}</h2><p>{t('workspace.importHint')}</p>
        <div className="workspace-data-file-picker">
          <input ref={importInput} hidden type="file" accept=".json,application/json" disabled={busy} onChange={importData} />
          <button className="secondary-action" type="button" disabled={busy} onClick={() => importInput.current?.click()}>{t('workspace.chooseFile')}</button>
          <span className="workspace-data-file-name" aria-live="polite">{selectedFileName ?? t('workspace.noFile')}</span>
        </div>
      </div>
      <div><h2>{t('workspace.reset')}</h2><p>{t('workspace.resetHint')}</p><button className="danger-action" type="button" disabled={busy} onClick={resetData}>{t('workspace.reset')}</button></div>
    </section>
    {busy && <p className="catalog-note" role="status">{t('workspace.working')}</p>}
    {status && <p className="catalog-note" role="status">{status}</p>}
    {error && <p className="catalog-note catalog-note--gap" role="alert">{error}</p>}
  </PageShell>;
}
