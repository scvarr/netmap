import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type EdgeMouseHandler,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toFlowProjection, type DeviceFlowNode, type LogicalFlowEdge } from '../topology/layout';
import type { TopologyProjectionDocument, TopologySelection } from '../topology/types';
import { DeviceNode } from './DeviceNode';

interface TopologyCanvasProps {
  document: TopologyProjectionDocument;
  selection: TopologySelection;
  onSelectionChange: (selection: TopologySelection) => void;
}

const nodeTypes = { device: DeviceNode };

export function TopologyCanvas({ document, selection, onSelectionChange }: TopologyCanvasProps) {
  const projection = useMemo(() => toFlowProjection(document), [document]);
  const nodes = projection.nodes.map((node) => ({
    ...node,
    selected: selection?.type === 'node' && selection.item.id === node.id,
  }));
  const edges = projection.edges.map((edge) => {
    const isSelected = selection?.type === 'edge' && selection.item.id === edge.id;
    return {
      ...edge,
      selected: isSelected,
      animated: isSelected,
      style: { stroke: isSelected ? '#54e3b4' : '#52676b', strokeWidth: isSelected ? 3 : 2 },
    };
  });

  const onNodeClick: NodeMouseHandler<DeviceFlowNode> = (_, node) => {
    onSelectionChange({ type: 'node', item: node.data.projection });
  };
  const onEdgeClick: EdgeMouseHandler<LogicalFlowEdge> = (_, edge) => {
    const item = edge.data?.projection;
    if (item) onSelectionChange({ type: 'edge', item });
  };

  return (
    <div className="topology-canvas" aria-label="Логическая схема сети">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={() => onSelectionChange(null)}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
        minZoom={0.35}
        maxZoom={1.8}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} color="#25383c" />
        <MiniMap
          pannable
          zoomable
          nodeColor="#183b3b"
          maskColor="rgba(5, 13, 15, 0.72)"
          ariaLabel="Мини-карта"
        />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
