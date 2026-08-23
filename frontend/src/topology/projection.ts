import type {
  TopologyProjectionNode,
  TopologyProjectionRequest,
  TopologySelection,
} from './types';

export const LOGICAL_PROJECTION_REQUEST: TopologyProjectionRequest = {
  layer: 'L2',
  detail_level: 'DEVICE',
  scope: { include_location_subtrees: [], include_entities: [] },
};

export const PHYSICAL_PROJECTION_REQUEST: TopologyProjectionRequest = {
  layer: 'L1',
  detail_level: 'PHYSICAL_OBJECT',
  scope: { include_location_subtrees: [], include_entities: [] },
};

export type TopologyViewMode = 'logical' | 'physical';

export const projectionRequestFor = (view: TopologyViewMode): TopologyProjectionRequest => (
  view === 'physical' ? PHYSICAL_PROJECTION_REQUEST : LOGICAL_PROJECTION_REQUEST
);

export const physicalObjectIdForNode = (node: TopologyProjectionNode): string | null => {
  const refs = node.source_refs.filter((ref) => (
    ref.ref_type === 'CANONICAL_FACT' && ref.entity_type === 'PhysicalObject'
  ));
  return refs.length === 1 ? refs[0].entity_id : null;
};

export const physicalObjectIdForSelection = (selection: TopologySelection): string | null => (
  selection?.type === 'node' ? physicalObjectIdForNode(selection.item) : null
);

export const nodeForPhysicalObject = (
  nodes: TopologyProjectionNode[],
  physicalObjectId: string,
): TopologyProjectionNode | null => {
  const matches = nodes.filter((node) => physicalObjectIdForNode(node) === physicalObjectId);
  return matches.length === 1 ? matches[0] : null;
};
