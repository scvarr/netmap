import { useEffect, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  toFlowProjection,
  type DeviceFlowNode,
  type FlowProjection,
  type LogicalFlowEdge,
  type TopologyLayoutEngine,
} from '../topology/layout';
import type { TopologyProjectionDocument, TopologySelection } from '../topology/types';
import {
  applyTopologyPositionOverrides,
  topologyLayoutViewKey,
  type TopologyLayoutStore,
} from '../topology/layoutStore';
import { DeviceNode } from './DeviceNode';
import { FloatingTopologyEdge } from './FloatingTopologyEdge';
import type { PhysicalTraceOverlay } from '../topology/interfacePhysicalTraceOverlay';
import { physicalObjectIdForNode } from '../topology/projection';
import type { XYPosition } from '@xyflow/react';

interface TopologyCanvasProps {
  document: TopologyProjectionDocument;
  selection: TopologySelection;
  onSelectionChange: (selection: TopologySelection) => void;
  layoutEngine?: TopologyLayoutEngine;
  layoutStore?: TopologyLayoutStore;
  traceOverlay?: PhysicalTraceOverlay;
  positionOverrides?: Record<string, XYPosition>;
  onPhysicalNodeDragStop?: (physicalObjectId: string, position: XYPosition) => void;
  disableAutoLayout?: boolean;
}

const nodeTypes = { device: DeviceNode };
const edgeTypes = { floating: FloatingTopologyEdge };

export function TopologyCanvas({
  document,
  selection,
  onSelectionChange,
  layoutEngine = toFlowProjection,
  layoutStore,
  traceOverlay,
  positionOverrides,
  onPhysicalNodeDragStop,
  disableAutoLayout,
}: TopologyCanvasProps) {
  const [projection, setProjection] = useState<FlowProjection | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const fitAfterLayout = useRef(false);
  const currentDocument = useRef(document);
  const { fitView } = useReactFlow();
  const selectedNodeId = selection?.type === 'node' ? selection.item.id : null;
  const viewKey = topologyLayoutViewKey(document);

  currentDocument.current = document;

  useEffect(() => {
    let current = true;
    setProjection(null);
    setLayoutError(null);
    void layoutEngine(document).then(
      (nextProjection) => {
        if (!current || currentDocument.current !== document) return;
        const storedPositions = positionOverrides ?? layoutStore?.load(viewKey) ?? {};
        setProjection({
          ...nextProjection,
          nodes: applyTopologyPositionOverrides(nextProjection.nodes, storedPositions),
        });
      },
      (reason: unknown) => {
        if (!current) return;
        setLayoutError(reason instanceof Error ? reason.message : 'Не удалось расположить топологию');
      },
    );
    return () => { current = false; };
  }, [document, layoutEngine, layoutRevision, layoutStore, positionOverrides, viewKey]);

  useEffect(() => {
    if (!projection || !fitAfterLayout.current) return;
    fitAfterLayout.current = false;
    void fitView({ duration: 300, maxZoom: 1.1, padding: 0.2 });
  }, [fitView, projection]);

  useEffect(() => {
    if (!projection || !selectedNodeId || !projection.nodes.some((node) => node.id === selectedNodeId)) return;
    void fitView({ nodes: [{ id: selectedNodeId }], duration: 300, maxZoom: 1.1, padding: 0.8 });
  }, [fitView, projection, selectedNodeId]);

  if (layoutError) {
    return <div className="topology-layout-state" role="alert">{layoutError}</div>;
  }
  if (!projection) {
    return <div className="topology-layout-state" role="status">Располагаем топологию…</div>;
  }

  const nodes = projection.nodes.map((node) => ({
    ...node,
    data: { ...node.data, traceHighlighted: traceOverlay?.highlightedNodeIds.has(node.id) ?? false },
    selected: selection?.type === 'node' && selection.item.id === node.id,
  }));
  const edges = projection.edges.map((edge) => {
    const isSelected = edge.data?.cableNode ? selection?.type === 'node' && selection.item.id === edge.data.cableNode.id : selection?.type === 'edge' && selection.item.id === edge.data?.projection.id;
    const isTraced = edge.data?.cableNode ? (edge.data.supportingEdgeIds?.every((id) => traceOverlay?.highlightedEdgeIds.has(id)) ?? false) : edge.data?.endpointPair ? (traceOverlay?.highlightedConnectionMemberIds.has(edge.data.endpointPair.connection_member_id) ?? false) : (traceOverlay?.highlightedEdgeIds.has(edge.id) ?? false);
    return {
      ...edge,
      selected: isSelected,
      animated: isSelected || isTraced,
      style: { stroke: isSelected ? '#54e3b4' : isTraced ? '#f0bd66' : '#52676b', strokeWidth: isSelected ? 3 : isTraced ? 4 : 2, opacity: isTraced ? 1 : 0.72 },
    };
  });

  const onNodeClick: NodeMouseHandler<DeviceFlowNode> = (_, node) => {
    onSelectionChange({ type: 'node', item: node.data.projection });
  };
  const onEdgeClick: EdgeMouseHandler<LogicalFlowEdge> = (_, edge) => {
    const item = edge.data?.projection;
    if (edge.data?.cableNode) onSelectionChange({ type: 'node', item: edge.data.cableNode }); else if (item) onSelectionChange({ type: 'edge', item });
  };
  const onNodesChange: OnNodesChange<DeviceFlowNode> = (changes) => {
    setProjection((current) => current ? {
      ...current,
      nodes: applyNodeChanges(changes, current.nodes),
    } : current);
  };
  const onNodeDragStop: OnNodeDrag<DeviceFlowNode> = (_, draggedNode) => {
    const physicalObjectId = physicalObjectIdForNode(draggedNode.data.projection);
    if (onPhysicalNodeDragStop && physicalObjectId) { onPhysicalNodeDragStop(physicalObjectId, draggedNode.position); return; }
    if (!layoutStore) return;
    layoutStore.save(viewKey, {
      ...layoutStore.load(viewKey),
      [draggedNode.id]: draggedNode.position,
    });
  };
  const resetLayout = () => {
    layoutStore?.clear(viewKey);
    fitAfterLayout.current = true;
    setLayoutRevision((revision) => revision + 1);
  };

  return (
    <div
      className="topology-canvas"
      aria-label={document.layer === 'L1' ? 'Физическая схема сети' : 'Логическая схема сети'}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={() => onSelectionChange(null)}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: document.layer === 'L1' ? 4 : 1.1 }}
        minZoom={0.35}
        maxZoom={document.layer === 'L1' ? 4 : 1.8}
        nodesDraggable={Boolean(onPhysicalNodeDragStop) || (!disableAutoLayout && document.layer === 'L1')}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Panel position="top-left">
          {!disableAutoLayout && <button type="button" className="topology-auto-layout" onClick={resetLayout}>Авторазмещение</button>}
        </Panel>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} color="#25383c" />
        <MiniMap
          pannable
          zoomable
          position="top-right"
          nodeColor="#183b3b"
          maskColor="rgba(5, 13, 15, 0.72)"
          ariaLabel="Мини-карта"
        />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
