import type { MemberAddress } from './exactMemberTrace';
import type { PhysicalTraceEvidenceRef } from './physicalObjectL1TraceTypes';

export const opticalStatuses = ['CONSISTENT', 'CONFLICT', 'UNKNOWN', 'NOT_APPLICABLE'] as const;
export type OpticalStatus = typeof opticalStatuses[number];
const sources = ['CABLE', 'PROPOSED_CABLE', 'BASE_MEMBER_MAPPING', 'MODULE_MEMBER_MAPPING',
  'TRANSCEIVER', 'DIRECT_CONNECTION', 'UNRESOLVED_INTERNAL_CONNECTION', 'ACTIVE_ENDING'] as const;
const values = ['SM', 'MM', 'NO_FIBER', 'COPPER'] as const;
const reasons = ['FIBER_TYPE_UNSPECIFIED', 'DIRECT_CONSTRUCTION_UNKNOWN', 'INTERNAL_PROVENANCE_UNKNOWN',
  'TRANSCEIVER_FIBER_TYPE_UNKNOWN', 'ACTIVE_ENDING_CHARACTERISTIC_UNKNOWN', 'CABLE_ENDING_MEDIUM_MISMATCH'] as const;
const pathReasons = ['INCOMPLETE_PATH', 'NO_SEGMENTS', 'OPTICAL_MODE_UNESTABLISHED'] as const;
const modelErrorDetails = ['INVALID_INTERNAL_LINKS', 'INVALID_MEMBER_MAPPINGS', 'INVALID_MEMBER_FIBER_TYPE',
  'AMBIGUOUS_MEMBER_MAPPING', 'MISSING_MEMBER_MAPPING'] as const;

export interface OpticalFact {
  source: typeof sources[number];
  value: typeof values[number] | null;
  points: MemberAddress[];
  canonical_refs: PhysicalTraceEvidenceRef[];
  trace_edge_id?: string | null;
  unknown_reason?: typeof reasons[number] | null;
  model_error?: { code: 'MODEL_ERROR'; reason: 'INVALID_CANONICAL_DATA'; detail: typeof modelErrorDetails[number] } | null;
  provenance?: { revision_id: string; mapping_ids: string[]; internal_link_id?: string | null } | null;
  ending_media?: { side: 'A' | 'B'; medium: 'COPPER'; port_type_id: string; revision_id: string; mapping_id: string | null }[];
  proposed_endings?: { side: 'A' | 'B'; interface_id: string; member_index: number }[];
}

export interface OpticalDiagnostic {
  status: OpticalStatus;
  facts: OpticalFact[];
  conflicts: { kind: 'LOCAL' | 'END_TO_END'; left_fact: number; right_fact: number; unknown_facts: number[] }[];
  reason?: typeof pathReasons[number] | null;
  termination?: { node_id: string; reason: string } | null;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const nullable = (value: unknown, valid: (value: unknown) => boolean) => value == null || valid(value);
const oneOf = (value: unknown, choices: readonly string[]) => choices.some(choice => choice === value);
const list = (value: unknown, valid: (item: unknown) => boolean) => Array.isArray(value) && value.every(valid);
const member = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0;
const side = (value: unknown) => value === 'A' || value === 'B';

function validFact(fact: unknown) {
  return record(fact) && oneOf(fact.source, sources) && (fact.value === null || oneOf(fact.value, values))
    && list(fact.points, point => record(point) && string(point.point_id) && member(point.member_index))
    && list(fact.canonical_refs, ref => record(ref) && string(ref.entity_type) && string(ref.entity_id)
      && (ref.ref_type === undefined || ref.ref_type === 'CANONICAL_FACT'))
    && nullable(fact.trace_edge_id, string)
    && nullable(fact.unknown_reason, reason => oneOf(reason, reasons))
    && nullable(fact.provenance, value => record(value) && string(value.revision_id)
      && list(value.mapping_ids, string) && nullable(value.internal_link_id, string))
    && nullable(fact.model_error, value => record(value) && value.code === 'MODEL_ERROR'
      && value.reason === 'INVALID_CANONICAL_DATA' && oneOf(value.detail, modelErrorDetails))
    && nullable(fact.ending_media, value => list(value, item => record(item) && side(item.side)
      && item.medium === 'COPPER' && string(item.port_type_id) && string(item.revision_id) && nullable(item.mapping_id, string)))
    && nullable(fact.proposed_endings, value => list(value, item => record(item) && side(item.side)
      && string(item.interface_id) && member(item.member_index)));
}

export function readOpticalDiagnostic(value: unknown): OpticalDiagnostic | undefined {
  if (!record(value) || !oneOf(value.status, opticalStatuses) || !Array.isArray(value.facts)
    || !value.facts.every(validFact) || !nullable(value.reason, reason => oneOf(reason, pathReasons))
    || !nullable(value.termination, end => record(end) && string(end.node_id) && string(end.reason))) return;
  const facts = value.facts as OpticalFact[];
  const index = (item: unknown): item is number =>
    typeof item === 'number' && Number.isInteger(item) && item >= 0 && item < facts.length;
  if (!Array.isArray(value.conflicts) || !value.conflicts.every(conflict =>
    record(conflict) && oneOf(conflict.kind, ['LOCAL', 'END_TO_END'])
    && index(conflict.left_fact) && index(conflict.right_fact) && conflict.left_fact !== conflict.right_fact
    && Array.isArray(conflict.unknown_facts) && conflict.unknown_facts.every(index)
    && (conflict.kind === 'LOCAL' ? conflict.unknown_facts.length === 0 : conflict.unknown_facts.length > 0))) return;
  if ((value.status === 'CONFLICT') !== (value.conflicts.length > 0)) return;
  if (value.status === 'CONSISTENT' && (!facts.length || value.reason || value.termination
    || !facts.some(fact => fact.value === 'SM' || fact.value === 'MM')
    || facts.some(fact => fact.value === null || fact.value === 'COPPER' || fact.unknown_reason || fact.model_error))) return;
  if (value.status === 'NOT_APPLICABLE' && (!facts.length || value.reason || value.termination
    || facts.some(fact => fact.value !== 'COPPER' || fact.unknown_reason || fact.model_error))) return;
  return value as unknown as OpticalDiagnostic;
}

export function readOpticalPaths(value: unknown) {
  return Array.isArray(value) && value.length ? value.map(readOpticalDiagnostic) : [undefined];
}

export function opticalPathStatus(value: unknown): OpticalStatus {
  const statuses = readOpticalPaths(value).map(item => item?.status ?? 'UNKNOWN');
  if (statuses.includes('CONFLICT')) return 'CONFLICT';
  return statuses.every(status => status === statuses[0]) ? statuses[0] : 'UNKNOWN';
}
