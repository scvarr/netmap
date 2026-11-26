import { expect, it } from 'vitest';
import { opticalPathStatus, readOpticalDiagnostic, type OpticalFact } from './opticalDiagnostic';

const fiber = (value: OpticalFact['value']): OpticalFact => ({
  source: 'CABLE', value, points: [{ point_id: 'ending', member_index: 2 }], canonical_refs: [],
});

it.each([
  { status: 'CONSISTENT', facts: [fiber('SM')] },
  { status: 'UNKNOWN', facts: [{ ...fiber(null), unknown_reason: 'FIBER_TYPE_UNSPECIFIED' }] },
  { status: 'NOT_APPLICABLE', facts: [fiber('COPPER')] },
])('preserves the server status $status', result => {
  const wire = { ...result, conflicts: [] };
  expect(readOpticalDiagnostic(wire)).toEqual(wire);
  expect(opticalPathStatus([wire])).toBe(result.status);
});

it('never reports missing or malformed evidence as consistent', () => {
  for (const wire of [undefined, [], [{ status: 'CONSISTENT' }],
    [{ status: 'CONSISTENT', facts: [fiber(null)], conflicts: [] }],
    [{ status: 'CONSISTENT', facts: [fiber('SM')], conflicts: [], reason: 'INCOMPLETE_PATH' }]]) {
    expect(opticalPathStatus(wire)).toBe('UNKNOWN');
  }
});

it('keeps proven conflict on an incomplete path and rejects invalid evidence indices', () => {
  const wire = {
    status: 'CONFLICT', reason: 'INCOMPLETE_PATH', termination: { node_id: 'missing', reason: 'NO_CONNECTION' },
    facts: [fiber('SM'), { ...fiber('MM'), unknown_reason: 'CABLE_ENDING_MEDIUM_MISMATCH' },
      { ...fiber(null), source: 'MODULE_MEMBER_MAPPING',
        model_error: { code: 'MODEL_ERROR', reason: 'INVALID_CANONICAL_DATA', detail: 'AMBIGUOUS_MEMBER_MAPPING' } },
      fiber('MM')],
    conflicts: [{ kind: 'END_TO_END', left_fact: 0, right_fact: 3, unknown_facts: [1, 2] }],
  };
  expect(readOpticalDiagnostic(wire)).toEqual(wire);
  expect(opticalPathStatus([undefined, wire])).toBe('CONFLICT');
  expect(readOpticalDiagnostic({ ...wire, conflicts: [{ ...wire.conflicts[0], unknown_facts: [4] }] })).toBeUndefined();
});
