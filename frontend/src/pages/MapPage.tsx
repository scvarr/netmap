import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QuickInspector } from '../components/QuickInspector';
import { TopologyCanvas } from '../components/TopologyCanvas';
import { ViewState } from '../components/ViewState';
import {
  nodeForPhysicalObject,
  physicalObjectIdForSelection,
  projectionRequestFor,
  type TopologyViewMode,
} from '../topology/projection';
import type { TopologyLayoutStore } from '../topology/layoutStore';
import type {
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologySelection,
} from '../topology/types';

interface MapPageProps {
  dataSource: TopologyDataSource;
  topologyLayoutStore?: TopologyLayoutStore;
}

const viewFrom = (value: string | null): TopologyViewMode => (
  value === 'physical' ? 'physical' : 'logical'
);

export function MapPage({ dataSource, topologyLayoutStore }: MapPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const viewMode = viewFrom(searchParams.get('view'));
  const focusId = searchParams.get('focus');
  const [document, setDocument] = useState<TopologyProjectionDocument | null>(null);
  const [selection, setSelection] = useState<TopologySelection>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const loadSequence = useRef(0);

  useEffect(() => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    setDocument(null);
    void dataSource.loadProjection(projectionRequestFor(viewMode)).then(
      (nextDocument) => {
        if (sequence !== loadSequence.current) return;
        setDocument(nextDocument);
        setLoading(false);
      },
      (reason: unknown) => {
        if (sequence !== loadSequence.current) return;
        setSelection(null);
        setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
        setLoading(false);
      },
    );
  }, [dataSource, reloadKey, viewMode]);

  const focusedNode = useMemo(() => (
    document && focusId ? nodeForPhysicalObject(document.nodes, focusId) : null
  ), [document, focusId]);

  useEffect(() => {
    if (!document) return;
    if (focusId) {
      setSelection(focusedNode ? { type: 'node', item: focusedNode } : null);
      return;
    }
    setSelection((current) => {
      if (!current) return null;
      if (current.type === 'edge') {
        return document.edges.some((edge) => edge.id === current.item.id) ? current : null;
      }
      const canonicalId = physicalObjectIdForSelection(current);
      const matchingNode = canonicalId ? nodeForPhysicalObject(document.nodes, canonicalId) : null;
      return matchingNode ? { type: 'node', item: matchingNode } : null;
    });
  }, [document, focusId, focusedNode]);

  const updateSelection = useCallback((nextSelection: TopologySelection) => {
    setSelection(nextSelection);
    const nextFocus = physicalObjectIdForSelection(nextSelection);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextFocus) next.set('focus', nextFocus);
      else next.delete('focus');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const switchView = (nextView: TopologyViewMode) => {
    if (nextView === viewMode) return;
    const selectedId = physicalObjectIdForSelection(selection);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('view', nextView);
      if (selectedId) next.set('focus', selectedId);
      else next.delete('focus');
      return next;
    });
  };

  const isEmpty = document !== null && document.nodes.length === 0;
  const focusMissing = Boolean(document && focusId && !focusedNode);

  return (
    <main className="map-page">
      <div className="map-page__toolbar topology-mode-switch" role="group" aria-label="Режим карты">
        <button type="button" aria-pressed={viewMode === 'logical'} onClick={() => switchView('logical')}>
          Логическая
        </button>
        <button type="button" aria-pressed={viewMode === 'physical'} onClick={() => switchView('physical')}>
          Физическая
        </button>
      </div>
      {(document?.warnings.length || document?.gaps.length || focusMissing) && (
        <div className="map-page__notices" aria-label="Сообщения проекции">
          {document?.warnings.map((warning, index) => <p key={`warning-${index}-${warning}`}>{warning}</p>)}
          {document?.gaps.map((gap, index) => <p className="map-page__notice--gap" key={`gap-${index}-${gap}`}>{gap}</p>)}
          {focusMissing && <p className="map-page__notice--gap">Объект с указанной canonical-ссылкой отсутствует в этой проекции.</p>}
        </div>
      )}
      <section className="map-page__canvas">
        {loading && <ViewState kind="loading" />}
        {!loading && error && <ViewState kind="error" message={error} onRetry={() => setReloadKey((key) => key + 1)} />}
        {!loading && !error && isEmpty && <ViewState kind="empty" />}
        {!loading && !error && document && !isEmpty && (
          <ReactFlowProvider>
            <TopologyCanvas
              document={document}
              selection={selection}
              onSelectionChange={updateSelection}
              layoutStore={topologyLayoutStore}
            />
          </ReactFlowProvider>
        )}
      </section>
      <QuickInspector
        document={document}
        selection={selection}
        onSelectNode={(node) => updateSelection({ type: 'node', item: node })}
        onClose={() => updateSelection(null)}
      />
    </main>
  );
}
