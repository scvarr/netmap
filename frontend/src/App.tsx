import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { HealthIndicator } from './components/HealthIndicator';
import { Inspector } from './components/Inspector';
import { TopologyCanvas } from './components/TopologyCanvas';
import { ViewState } from './components/ViewState';
import type {
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologyProjectionRequest,
  TopologySelection,
} from './topology/types';
import type { DeviceDetailsDataSource } from './topology/deviceDetailsTypes';

const DEFAULT_REQUEST: TopologyProjectionRequest = {
  layer: 'L2',
  detail_level: 'DEVICE',
  scope: { include_location_subtrees: [], include_entities: [] },
};

interface AppProps {
  dataSource: TopologyDataSource;
  deviceDetailsDataSource: DeviceDetailsDataSource;
}

export function App({ dataSource, deviceDetailsDataSource }: AppProps) {
  const [document, setDocument] = useState<TopologyProjectionDocument | null>(null);
  const [selection, setSelection] = useState<TopologySelection>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDocument(await dataSource.loadProjection(DEFAULT_REQUEST));
    } catch (reason) {
      setDocument(null);
      setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
    } finally {
      setLoading(false);
    }
  }, [dataSource]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const isEmpty = document !== null && document.nodes.length === 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand__mark">N</span><strong>NetMap</strong></div>
        <div className="topbar__context">
          <span className="eyebrow">Workspace</span>
          <strong>Default workspace</strong>
        </div>
        <div className="topbar__actions">
          <span className="projection-badge">Настроенная проекция</span>
          <HealthIndicator />
        </div>
      </header>

      <section className="workspace">
        <div className="workspace__heading">
          <div><span className="eyebrow">L2 · Device view</span><h1>Логическая топология</h1></div>
          <div className="workspace__stats">
            <span><strong>{document?.nodes.length ?? '—'}</strong> устройств</span>
            <span><strong>{document?.edges.length ?? '—'}</strong> связей</span>
          </div>
        </div>
        {document?.warnings.map((warning, index) => (
          <div className="projection-note" key={`warning-${index}-${warning}`}>{warning}</div>
        ))}
        {document?.gaps.map((gap, index) => (
          <div className="projection-note projection-note--gap" key={`gap-${index}-${gap}`}>
            <span className="projection-note__kind">Пробел проекции</span>
            {gap}
          </div>
        ))}

        <div className="workspace__body">
          <section className="canvas-panel">
            {loading && <ViewState kind="loading" />}
            {!loading && error && <ViewState kind="error" message={error} onRetry={() => setReloadKey((key) => key + 1)} />}
            {!loading && !error && isEmpty && <ViewState kind="empty" />}
            {!loading && !error && document && !isEmpty && (
              <ReactFlowProvider>
                <TopologyCanvas document={document} selection={selection} onSelectionChange={setSelection} />
              </ReactFlowProvider>
            )}
          </section>
          <Inspector
            document={document}
            selection={selection}
            deviceDetailsDataSource={deviceDetailsDataSource}
            onSelectNode={(node) => setSelection({ type: 'node', item: node })}
            onClose={() => setSelection(null)}
          />
        </div>
      </section>
    </main>
  );
}
