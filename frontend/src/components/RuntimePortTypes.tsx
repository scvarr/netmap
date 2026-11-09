import { createContext, useContext, type ReactNode } from 'react';
import { usePortTypes, type PortType } from './PortTypeSelect';
import type { ConnectionPointDetails } from '../topology/physicalObjectDetailsTypes';

const Catalog = createContext<PortType[] | undefined>(undefined);
export const useRuntimePortTypes = () => useContext(Catalog);

function CatalogLoader({ children }: { children: ReactNode }) {
  const { types } = usePortTypes();
  return <Catalog.Provider value={types ?? []}>{children}</Catalog.Provider>;
}

export function RuntimePortTypes({ children }: { children: ReactNode }) {
  const inherited = useRuntimePortTypes();
  return inherited ? children : <CatalogLoader>{children}</CatalogLoader>;
}

export function RuntimePortLabel({ point, label }: { point: ConnectionPointDetails; label: string }) {
  const type = useRuntimePortTypes()?.find(item => item.id === point.blueprint_slot?.port_type_id);
  return <>{label}{type && <span className="runtime-port-type" title={type.name}><span aria-hidden="true" style={{ backgroundColor: type.color, borderRadius: point.blueprint_slot?.kind === 'NETWORK_PORT' ? 0 : '50%' }} />{type.name}</span>}</>;
}
