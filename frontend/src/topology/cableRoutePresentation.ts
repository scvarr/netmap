import { physicalObjectIdForNode } from './projection';
import type { MapCableRoute } from './savedMapTypes';
import type { TopologyProjectionNode } from './types';

/** Finds an authoritative Physical/L1 route only for this exact canonical cable. */
export const cableRouteForCollapsedCable = (
  cableNode: TopologyProjectionNode | undefined,
  routes: readonly MapCableRoute[] | undefined,
): MapCableRoute | undefined => {
  const cablePhysicalObjectId = cableNode && physicalObjectIdForNode(cableNode);
  if (!cablePhysicalObjectId) return undefined;
  return routes?.find((route) => (
    route.view === 'L1/PHYSICAL_OBJECT'
    && route.cable_ref.ref_type === 'CANONICAL_FACT'
    && route.cable_ref.entity_type === 'PhysicalObject'
    && route.cable_ref.entity_id === cablePhysicalObjectId
  ));
};
