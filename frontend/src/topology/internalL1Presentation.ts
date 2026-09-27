import { panelCompositionBounds } from './blueprintDisplaySize';
import type {
  BlueprintPresentation,
  PhysicalInternalL1Link,
  TopologyProjectionNode,
} from './types';

export type InternalL1PresentationState = 'normal' | 'selected' | 'trace-highlighted' | 'wiring-highlighted';

export interface InternalL1Segment {
  connectionMemberId: string;
  fromConnectionPointId: string;
  toConnectionPointId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  state: InternalL1PresentationState;
}

const renderedPoint = (
  blueprint: BlueprintPresentation,
  slot: BlueprintPresentation['slots'][number],
  displayWidth?: number,
): { x: number; y: number } => {
  const bounds = panelCompositionBounds(blueprint.panels);
  const width = displayWidth ?? bounds.width;
  const panel = blueprint.panels.find((item) => item.panel_key === slot.panel_key);
  if (!panel) throw new Error(`Unknown Blueprint panel ${slot.panel_key}`);
  return {
    x: width * (panel.x + panel.width * slot.panel_local_position.x - bounds.x) / bounds.width,
    y: width * (panel.y + panel.height * slot.panel_local_position.y - bounds.y) / bounds.width,
  };
};

const compareLinks = (left: PhysicalInternalL1Link, right: PhysicalInternalL1Link): number => (
  left.connection_id.localeCompare(right.connection_id)
  || left.connection_member_id.localeCompare(right.connection_member_id)
);

export const internalL1Segments = (
  node: TopologyProjectionNode,
  selected: boolean,
  highlightedConnectionMemberIds: ReadonlySet<string> = new Set(),
  wiringHighlightedConnectionMemberIds: ReadonlySet<string> = new Set(),
  displayWidth?: number,
): InternalL1Segment[] => {
  const blueprint = node.attributes.blueprint_presentation;
  if (node.kind !== 'PHYSICAL_OBJECT' || !blueprint) return [];

  const slotsByConnectionPoint = new Map(
    blueprint.slots.map((slot) => [slot.connection_point_id, slot]),
  );
  return [...(node.attributes.internal_l1_links ?? [])]
    .sort(compareLinks)
    .flatMap((link) => {
      const fromSlot = slotsByConnectionPoint.get(link.from_connection_point_id);
      const toSlot = slotsByConnectionPoint.get(link.to_connection_point_id);
      if (!fromSlot || !toSlot) return [];
      return [{
        connectionMemberId: link.connection_member_id,
        fromConnectionPointId: link.from_connection_point_id,
        toConnectionPointId: link.to_connection_point_id,
        from: renderedPoint(blueprint, fromSlot, displayWidth),
        to: renderedPoint(blueprint, toSlot, displayWidth),
        state: highlightedConnectionMemberIds.has(link.connection_member_id)
          ? 'trace-highlighted'
          : wiringHighlightedConnectionMemberIds.has(link.connection_member_id)
            ? 'wiring-highlighted'
          : selected ? 'selected' : 'normal',
      }];
    });
};

