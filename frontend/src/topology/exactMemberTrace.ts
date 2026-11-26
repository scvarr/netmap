import type { PhysicalTraceEdge, PhysicalTraceNode } from './physicalObjectL1TraceTypes';

export interface MemberAddress {
  point_id: string;
  member_index: number;
}

export interface ExpectedMemberPair {
  from: MemberAddress;
  to: MemberAddress;
}

const terminationReasons = [
  'EXPECTED_MEMBER', 'OTHER_ENDING', 'MISSING_EXTERNAL_CONNECTION',
  'MISSING_INTERNAL_CONTINUITY', 'NO_CONNECTION', 'INVALID_CANONICAL_DATA', 'CYCLE',
] as const;

export interface ExactMemberTrace {
  query: ExpectedMemberPair;
  verdict: 'REACHABLE' | 'UNKNOWN';
  nodes: (PhysicalTraceNode & { payload: MemberAddress })[];
  edges: PhysicalTraceEdge[];
  terminations: { node_id: string; reason: typeof terminationReasons[number] }[];
}

export interface ExactMemberGroup {
  completeness: 'COMPLETE' | 'PARTIAL' | 'UNCONFIRMED';
  results: ExactMemberTrace[];
}

export const memberAddressKey = (address: MemberAddress) => `${address.point_id}:${address.member_index}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isAddress = (value: unknown): value is MemberAddress =>
  isRecord(value) && typeof value.point_id === 'string'
  && typeof value.member_index === 'number' && Number.isInteger(value.member_index) && value.member_index > 0;

const isEvidence = (value: unknown) => Array.isArray(value) && value.every(ref =>
  isRecord(ref) && typeof ref.entity_type === 'string' && typeof ref.entity_id === 'string');

function readTrace(value: unknown, expected: ExpectedMemberPair): ExactMemberTrace {
  if (!isRecord(value) || value.schema_version !== 1 || !isRecord(value.query)
    || !isAddress(value.query.from) || !isAddress(value.query.to)
    || memberAddressKey(value.query.from) !== memberAddressKey(expected.from)
    || memberAddressKey(value.query.to) !== memberAddressKey(expected.to)
    || (value.verdict !== 'REACHABLE' && value.verdict !== 'UNKNOWN')
    || !Array.isArray(value.nodes) || !value.nodes.every(node => isRecord(node)
      && typeof node.id === 'string' && isAddress(node.payload) && isEvidence(node.canonical_refs))
    || !Array.isArray(value.edges) || !Array.isArray(value.terminations)) {
    throw new Error('Invalid exact L1 trace response');
  }
  const nodes = new Set(value.nodes.map(node => node.id));
  if (!value.edges.every(edge => isRecord(edge) && typeof edge.id === 'string'
    && nodes.has(edge.from_node_id) && nodes.has(edge.to_node_id) && isEvidence(edge.evidence_refs))
    || !value.terminations.every(end => isRecord(end) && nodes.has(end.node_id)
      && terminationReasons.some(reason => reason === end.reason))) {
    throw new Error('Invalid exact L1 trace evidence');
  }
  return value as unknown as ExactMemberTrace;
}

export class ExactTraceRequestError extends Error {
  constructor(readonly code: 'MODEL_ERROR' | 'INVALID_REQUEST') { super(code); }
}

async function postTrace(path: string, query: unknown, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/v1/traces/l1${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query), signal,
  });
  if (response.status === 422) throw new ExactTraceRequestError('INVALID_REQUEST');
  if (response.status === 409 && (await response.json())?.error?.code === 'MODEL_ERROR') {
    throw new ExactTraceRequestError('MODEL_ERROR');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function traceExactMember(pair: ExpectedMemberPair, signal: AbortSignal) {
  return readTrace(await postTrace('', pair, signal), pair);
}

export async function traceExactGroup(pairs: ExpectedMemberPair[], signal: AbortSignal): Promise<ExactMemberGroup> {
  const value = await postTrace('/group', { expected_pairs: pairs }, signal);
  if (!isRecord(value) || (value.completeness !== 'COMPLETE' && value.completeness !== 'PARTIAL'
    && value.completeness !== 'UNCONFIRMED') || !Array.isArray(value.results) || value.results.length !== pairs.length) {
    throw new Error('Invalid exact L1 group response');
  }
  return { completeness: value.completeness, results: value.results.map((result, index) => readTrace(result, pairs[index])) };
}
