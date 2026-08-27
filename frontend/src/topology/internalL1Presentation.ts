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

const anchorPoint = (
  blueprint: BlueprintPresentation,
  anchor: BlueprintPresentation['slots'][number]['anchor'],
  displayWidth?: number,
): { x: number; y: number } => {
  const width = displayWidth ?? blueprint.body.width;
  const height = width * blueprint.body.height / blueprint.body.width;
  switch (anchor.side) {
    case 'LEFT': return { x: 0, y: height * anchor.offset };
    case 'RIGHT': return { x: width, y: height * anchor.offset };
    case 'TOP': return { x: width * anchor.offset, y: 0 };
    case 'BOTTOM': return { x: width * anchor.offset, y: height };
  }
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
  face?: 'FRONT' | 'REAR',
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
      if (!fromSlot || !toSlot || (face && ((fromSlot.face ?? 'FRONT') !== face || (toSlot.face ?? 'FRONT') !== face))) return [];
      return [{
        connectionMemberId: link.connection_member_id,
        fromConnectionPointId: link.from_connection_point_id,
        toConnectionPointId: link.to_connection_point_id,
        from: anchorPoint(blueprint, fromSlot.anchor, displayWidth),
        to: anchorPoint(blueprint, toSlot.anchor, displayWidth),
        state: highlightedConnectionMemberIds.has(link.connection_member_id)
          ? 'trace-highlighted'
          : wiringHighlightedConnectionMemberIds.has(link.connection_member_id)
            ? 'wiring-highlighted'
          : selected ? 'selected' : 'normal',
      }];
    });
};

