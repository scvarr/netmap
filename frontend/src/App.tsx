import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { HealthIndicator } from './components/HealthIndicator';
import { Inspector } from './components/Inspector';
import { CreateNetworkDevice } from './components/CreateNetworkDevice';
import { CreatePhysicalObject } from './components/CreatePhysicalObject';
import { TopologyCanvas } from './components/TopologyCanvas';
import { ViewState } from './components/ViewState';
import type {
  TopologyDataSource,
  TopologyProjectionDocument,
  TopologyProjectionRequest,
  TopologySelection,
} from './topology/types';
import type { DeviceDetailsDataSource } from './topology/deviceDetailsTypes';
import type { DeviceWriteDataSource } from './topology/deviceWriteTypes';
import type { DeviceInterfaceWriteDataSource } from './topology/deviceInterfaceWriteTypes';
import type { PhysicalLinkWriteDataSource } from './topology/physicalLinkWriteTypes';
import type { PhysicalEndpointConnectionWriteDataSource } from './topology/physicalEndpointConnectionWriteTypes';
import type { PhysicalObjectDetailsDataSource } from './topology/physicalObjectDetailsTypes';
import type { PhysicalObjectWriteDataSource } from './topology/physicalObjectWriteTypes';
import type { TopologyLayoutStore } from './topology/layoutStore';

const LOGICAL_REQUEST: TopologyProjectionRequest = {
  layer: 'L2',
  detail_level: 'DEVICE',
  scope: { include_location_subtrees: [], include_entities: [] },
};

const PHYSICAL_REQUEST: TopologyProjectionRequest = {
  layer: 'L1',
  detail_level: 'PHYSICAL_OBJECT',
  scope: { include_location_subtrees: [], include_entities: [] },
};

type TopologyViewMode = 'logical' | 'physical';

const physicalObjectId = (selection: TopologySelection): string | null => (
  selection?.type === 'node'
    ? selection.item.source_refs.find((ref) => (
      ref.ref_type === 'CANONICAL_FACT' && ref.entity_type === 'PhysicalObject'
    ))?.entity_id ?? null
    : null
);

interface AppProps {
  dataSource: TopologyDataSource;
  deviceDetailsDataSource: DeviceDetailsDataSource;
  deviceWriteDataSource?: DeviceWriteDataSource;
  deviceInterfaceWriteDataSource?: DeviceInterfaceWriteDataSource;
  physicalLinkWriteDataSource?: PhysicalLinkWriteDataSource;
  physicalObjectDetailsDataSource?: PhysicalObjectDetailsDataSource;
  physicalEndpointConnectionWriteDataSource?: PhysicalEndpointConnectionWriteDataSource;
  physicalObjectWriteDataSource?: PhysicalObjectWriteDataSource;
  topologyLayoutStore?: TopologyLayoutStore;
}

export function App({
  dataSource,
  deviceDetailsDataSource,
  deviceWriteDataSource,
  deviceInterfaceWriteDataSource,
  physicalLinkWriteDataSource,
  physicalObjectDetailsDataSource,
  physicalEndpointConnectionWriteDataSource,
  physicalObjectWriteDataSource,
  topologyLayoutStore,
}: AppProps) {
  const [document, setDocument] = useState<TopologyProjectionDocument | null>(null);
  const [selection, setSelection] = useState<TopologySelection>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewMode, setViewMode] = useState<TopologyViewMode>('logical');
  const selectionToPreserve = useRef<string | null | undefined>(undefined);
  const loadSequence = useRef(0);

  const load = useCallback(async (
    request: TopologyProjectionRequest,
    selectPhysicalObjectId?: string,
  ) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const nextDocument = await dataSource.loadProjection(request);
      if (sequence !== loadSequence.current) return;
      setDocument(nextDocument);
      if (selectPhysicalObjectId) {
        const matches = nextDocument.nodes.filter((node) => node.source_refs.some((ref) => (
          ref.ref_type === 'CANONICAL_FACT'
          && ref.entity_type === 'PhysicalObject'
          && ref.entity_id === selectPhysicalObjectId
        )));
        setSelection(matches.length === 1 ? { type: 'node', item: matches[0] } : null);
      }
    } catch (reason) {
      if (sequence !== loadSequence.current) return;
      setDocument(null);
      setSelection(null);
      setError(reason instanceof Error ? reason.message : 'Неизвестная ошибка');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [dataSource]);

  useEffect(() => {
    const preserveId = selectionToPreserve.current;
    selectionToPreserve.current = undefined;
    void load(viewMode === 'logical' ? LOGICAL_REQUEST : PHYSICAL_REQUEST, preserveId ?? undefined);
  }, [load, reloadKey, viewMode]);

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
        <div className="topology-mode-switch" role="group" aria-label="Режим карты">
          <button
            type="button"
            aria-pressed={viewMode === 'logical'}
            onClick={() => {
              if (viewMode === 'logical') return;
              selectionToPreserve.current = physicalObjectId(selection);
              if (!selectionToPreserve.current) setSelection(null);
              setViewMode('logical');
            }}
          >
            Логическая
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'physical'}
            onClick={() => {
              if (viewMode === 'physical') return;
              selectionToPreserve.current = physicalObjectId(selection);
              if (!selectionToPreserve.current) setSelection(null);
              setViewMode('physical');
            }}
          >
            Физическая
          </button>
        </div>
        <div className="workspace__heading">
          <div>
            <span className="eyebrow">
              {viewMode === 'logical' ? 'L2 · Device view' : 'L1 · Physical object view'}
            </span>
            <h1>{viewMode === 'logical' ? 'Логическая топология' : 'Физическая топология'}</h1>
          </div>
          <div className="workspace__heading-actions">
            <div className="workspace__stats">
              <span>
                <strong>{document?.nodes.length ?? '—'}</strong>
                {viewMode === 'logical' ? ' устройств' : ' объектов'}
              </span>
              <span><strong>{document?.edges.length ?? '—'}</strong> связей</span>
            </div>
            {viewMode === 'logical' && deviceWriteDataSource && (
              <CreateNetworkDevice
                dataSource={deviceWriteDataSource}
                onCreated={(created) => {
                  void load(LOGICAL_REQUEST, created.device.source_ref.entity_id);
                }}
              />
            )}
            {viewMode === 'physical' && physicalObjectWriteDataSource && (
              <CreatePhysicalObject
                dataSource={physicalObjectWriteDataSource}
                onCreated={(created) => {
                  void load(
                    PHYSICAL_REQUEST,
                    created.physical_object.source_ref.entity_id,
                  );
                }}
              />
            )}
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
                <TopologyCanvas
                  document={document}
                  selection={selection}
                  onSelectionChange={setSelection}
                  layoutStore={topologyLayoutStore}
                />
              </ReactFlowProvider>
            )}
          </section>
          <Inspector
            document={document}
            selection={selection}
            deviceDetailsDataSource={deviceDetailsDataSource}
            deviceInterfaceWriteDataSource={viewMode === 'logical' ? deviceInterfaceWriteDataSource : undefined}
            onInterfaceCreated={(id) => { void load(LOGICAL_REQUEST, id); }}
            physicalLinkWriteDataSource={viewMode === 'logical' ? physicalLinkWriteDataSource : undefined}
            physicalObjectDetailsDataSource={viewMode === 'physical' ? physicalObjectDetailsDataSource : undefined}
            physicalEndpointConnectionWriteDataSource={viewMode === 'physical'
              ? physicalEndpointConnectionWriteDataSource
              : undefined}
            onPhysicalEndpointConnected={(id) => { void load(PHYSICAL_REQUEST, id); }}
            onPhysicalLinkCreated={(id) => { void load(LOGICAL_REQUEST, id); }}
            onSelectNode={(node) => setSelection({ type: 'node', item: node })}
            onClose={() => setSelection(null)}
          />
        </div>
      </section>
    </main>
  );
}
