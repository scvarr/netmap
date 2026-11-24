export interface PhysicalPointMember {
  index: number;
  designation: string;
  occupied: boolean;
}
export interface PhysicalPortAvailability {
  cardinality: number;
  external_connection_count?: number;
  members?: PhysicalPointMember[];
}

export const isAvailablePhysicalPort = (point: PhysicalPortAvailability): boolean => (
  point.cardinality === 1
    ? point.external_connection_count === 0
    : point.members?.some(member => !member.occupied) === true
);

export const selectedPhysicalMember = (point: PhysicalPortAvailability, index: number | undefined): number | undefined => (
  point.cardinality === 1
    ? isAvailablePhysicalPort(point) ? 1 : undefined
    : point.members?.find(member => member.index === index && !member.occupied)?.index
);

export const physicalMemberLabel = (point: PhysicalPortAvailability, label: string, index?: number, includeSingle = false): string => {
  const member = (includeSingle || point.cardinality > 1) ? point.members?.find(value => value.index === index) : undefined;
  const designation = member?.designation ?? (includeSingle && point.cardinality === 1 ? "1" : undefined);
  return designation ? `${label} · ${designation}` : label;
};
