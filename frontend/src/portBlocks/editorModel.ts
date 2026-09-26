import type { CreatePortBlockRequest, PortBlockKind, PortBlockPort, PortBlockVersionDocument } from '../topology/portBlockTypes';

export type VisualDirection = 'LTR' | 'RTL';
export interface PortBlockEditorState { name: string; rows: 1 | 2; portsPerRow: number; direction: VisualDirection; kind: PortBlockKind; localIds: string[]; preservedSnapshot: PortBlockPort[] | null; }
export type PortBlockValidationError = 'nameRequired' | 'portsPerRow' | 'localIds';
export interface GeneratedPortBlock { ports: PortBlockPort[]; validationErrors: PortBlockValidationError[]; }
export type IdFactory = () => string;
const defaultId: IdFactory = () => crypto.randomUUID();
const clean = (value: string) => value.trim();
export const requiredPortCount = (state: Pick<PortBlockEditorState, 'rows' | 'portsPerRow'>) => state.rows * state.portsPerRow;
export const ensureLocalIds = (localIds: string[], count: number, idFactory: IdFactory = defaultId) => [...localIds.slice(0, count), ...Array.from({ length: Math.max(0, count - localIds.length) }, () => `p-${idFactory()}`)];
export const newPortBlockEditorState = (idFactory: IdFactory = defaultId): PortBlockEditorState => ({ name: '', rows: 1, portsPerRow: 8, direction: 'LTR', kind: 'NETWORK_PORT', localIds: ensureLocalIds([], 8, idFactory), preservedSnapshot: null });
export const hydratePortBlockEditorState = (version: PortBlockVersionDocument): PortBlockEditorState => {
  const ports = [...version.ports].sort((a, b) => a.layout_order - b.layout_order);
  const rows = ports.some((port) => port.row === 2) ? 2 : 1;
  const firstRow = ports.filter((port) => port.row === 1);
  return { name: version.name, rows, portsPerRow: Math.max(...ports.map((port) => port.column)), direction: firstRow.length > 1 && firstRow[0].column > firstRow[1].column ? 'RTL' : 'LTR', kind: ports[0].kind, localIds: ports.map((port) => port.local_id), preservedSnapshot: ports };
};
export const generatePortBlock = (state: PortBlockEditorState): GeneratedPortBlock => {
  const validationErrors: PortBlockValidationError[] = [];
  if (!clean(state.name)) validationErrors.push('nameRequired');
  if (state.preservedSnapshot) return { ports: state.preservedSnapshot.map((port) => ({ ...port })), validationErrors };
  if (!Number.isInteger(state.portsPerRow) || state.portsPerRow < 1) validationErrors.push('portsPerRow');
  const count = requiredPortCount(state);
  if (state.localIds.length !== count || new Set(state.localIds).size !== count || state.localIds.some((id) => !clean(id))) validationErrors.push('localIds');
  if (validationErrors.some((error) => error !== 'nameRequired')) return { ports: [], validationErrors };
  const ports: PortBlockPort[] = [];
  for (let row = 1; row <= state.rows; row += 1) for (let index = 0; index < state.portsPerRow; index += 1) ports.push({ local_id: state.localIds[ports.length], kind: state.kind, row: row as 1 | 2, column: state.direction === 'LTR' ? index + 1 : state.portsPerRow - index, layout_order: ports.length + 1 });
  return { ports, validationErrors };
};
export const createPortBlockRequest = (state: PortBlockEditorState): { request?: CreatePortBlockRequest; validationErrors: PortBlockValidationError[] } => { const generated = generatePortBlock(state); return generated.validationErrors.length ? { validationErrors: generated.validationErrors } : { request: { name: clean(state.name), ports: generated.ports }, validationErrors: [] }; };
