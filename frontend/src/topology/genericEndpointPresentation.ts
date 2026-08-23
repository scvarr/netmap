import type { ConnectionPointPresentation, TopologyProjectionNode } from './types';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const genericConnectionPoints = (node: TopologyProjectionNode): ConnectionPointPresentation[] => (
  [...(node.attributes.connection_points ?? [])]
    .sort((left, right) => collator.compare(left.display_name, right.display_name)
      || left.connection_point_id.localeCompare(right.connection_point_id))
);

export const genericEndpointOffset = (index: number, count: number): number => (
  (index + 1) / (count + 1)
);
