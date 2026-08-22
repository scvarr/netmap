import type { XYPosition } from '@xyflow/react';
import type { DeviceFlowNode } from './layout';
import type { TopologyProjectionDocument } from './types';

export type TopologyNodePositions = Record<string, XYPosition>;

export interface TopologyLayoutStore {
  load(viewKey: string): TopologyNodePositions;
  save(viewKey: string, positions: TopologyNodePositions): void;
  clear(viewKey: string): void;
}

const isPosition = (value: unknown): value is XYPosition => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
};

export const topologyLayoutViewKey = (document: TopologyProjectionDocument): string => (
  `${document.layer}/${document.detail_level}`
);

export const applyTopologyPositionOverrides = (
  nodes: DeviceFlowNode[],
  positions: TopologyNodePositions,
): DeviceFlowNode[] => nodes.map((node) => (
  positions[node.id] ? { ...node, position: positions[node.id] } : node
));

export class BrowserTopologyLayoutStore implements TopologyLayoutStore {
  constructor(
    private readonly storage: Storage,
    private readonly namespace = 'netmap.topology-layout.default',
  ) {}

  load(viewKey: string): TopologyNodePositions {
    try {
      const raw = this.storage.getItem(this.key(viewKey));
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, XYPosition] => isPosition(entry[1])),
      );
    } catch {
      return {};
    }
  }

  save(viewKey: string, positions: TopologyNodePositions): void {
    try {
      this.storage.setItem(this.key(viewKey), JSON.stringify(positions));
    } catch {
      // Presentation persistence must not break topology interaction.
    }
  }

  clear(viewKey: string): void {
    try {
      this.storage.removeItem(this.key(viewKey));
    } catch {
      // Presentation persistence must not break topology interaction.
    }
  }

  private key(viewKey: string): string {
    return `${this.namespace}:${viewKey}`;
  }
}
