/** Authoritative PORT-mode availability for one-member physical endpoints. */
export interface PhysicalPortAvailability {
  cardinality: number;
  external_connection_count?: number;
}

export const isAvailablePhysicalPort = (point: PhysicalPortAvailability): boolean => (
  point.cardinality === 1 && point.external_connection_count === 0
);
