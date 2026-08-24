import type { PhysicalObjectL1TraceArtifact, PhysicalObjectL1TraceDataSource, PhysicalObjectL1TraceQuery } from './physicalObjectL1TraceTypes';

const endpoint = '/api/v1/traces/physical-objects/l1';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const malformed = (message: string): never => { throw new Error(`Malformed physical object L1 trace response: ${message}`); };
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const evidence = (value: unknown): boolean => Array.isArray(value) && value.every((item) => object(item) && typeof item.entity_type === 'string' && typeof item.entity_id === 'string');

export const parsePhysicalObjectL1TraceArtifact = (value: unknown): PhysicalObjectL1TraceArtifact => {
  if (!object(value)) malformed('document must be an object.');
  const document = value as Record<string, unknown>;
  if (document.schema_version !== 1 || !object(document.query)) malformed('document or query is invalid.');
  const query = document.query as Record<string, unknown>;
  if (typeof query.from_physical_object_id !== 'string' || typeof query.to_physical_object_id !== 'string') malformed('query requires PhysicalObject IDs.');
  if (document.verdict !== 'REACHABLE' && document.verdict !== 'UNKNOWN') malformed('verdict must be REACHABLE or UNKNOWN.');
  if (!Array.isArray(document.branches) || !document.branches.every((branch: unknown) => object(branch) && typeof branch.branch_id === 'string' && strings(branch.edge_ids) && evidence(branch.evidence_refs))) malformed('branches are invalid.');
  if (!Array.isArray(document.cycles) || !document.cycles.every((cycle: unknown) => object(cycle) && typeof cycle.cycle_id === 'string' && strings(cycle.state_node_ids) && strings(cycle.edge_ids) && evidence(cycle.evidence_refs))) malformed('cycles are invalid.');
  if (!Array.isArray(document.nodes) || !document.nodes.every((node: unknown) => object(node) && typeof node.id === 'string' && evidence(node.canonical_refs))) malformed('nodes are invalid.');
  if (!Array.isArray(document.edges) || !document.edges.every((edge: unknown) => object(edge) && typeof edge.id === 'string' && typeof edge.from_node_id === 'string' && typeof edge.to_node_id === 'string' && evidence(edge.evidence_refs))) malformed('edges are invalid.');
  if (!evidence(document.evidence_refs) || !Array.isArray(document.gaps) || !Array.isArray(document.warnings)) malformed('evidence, gaps, or warnings are invalid.');
  return value as unknown as PhysicalObjectL1TraceArtifact;
};

export class ApiPhysicalObjectL1TraceDataSource implements PhysicalObjectL1TraceDataSource {
  async tracePhysicalObjectsL1(query: PhysicalObjectL1TraceQuery): Promise<PhysicalObjectL1TraceArtifact> {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
    if (!response.ok) throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''} while tracing physical objects.`);
    return parsePhysicalObjectL1TraceArtifact(await response.json() as unknown);
  }
}
