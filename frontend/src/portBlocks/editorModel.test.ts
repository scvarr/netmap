import { describe, expect, it } from 'vitest';
import { createPortBlockRequest, ensureLocalIds, generatePortBlock, hydratePortBlockEditorState, newPortBlockEditorState } from './editorModel';
import type { PortBlockVersionDocument } from '../topology/portBlockTypes';

const ids = (() => { let index = 0; return () => `opaque-${++index}`; })();
describe('Port Block structural authoring', () => {
  it('generates neutral two-row positions and visual direction without endpoint names', () => {
    const state = { ...newPortBlockEditorState(ids), name: 'Reusable', rows: 2 as const, portsPerRow: 3, localIds: ensureLocalIds([], 6, ids), direction: 'RTL' as const };
    const ports = generatePortBlock(state).ports;
    expect(ports.map(({ row, column, layout_order }) => [row, column, layout_order])).toEqual([[1, 3, 1], [1, 2, 2], [1, 1, 3], [2, 3, 4], [2, 2, 5], [2, 1, 6]]);
    expect(ports.every((port) => !('display_label' in port))).toBe(true);
  });
  it('keeps stable local ids when structural direction changes', () => {
    const state = { ...newPortBlockEditorState(ids), name: 'Block', localIds: ensureLocalIds([], 4, ids), portsPerRow: 4 };
    const original = createPortBlockRequest(state).request!.ports.map((port) => port.local_id);
    const changed = createPortBlockRequest({ ...state, direction: 'RTL' }).request!.ports;
    expect(changed.map((port) => port.local_id)).toEqual(original);
    expect(changed.map((port) => port.column)).toEqual([4, 3, 2, 1]);
  });
  it('hydrates the next version from the exact structural snapshot', () => {
    const version: PortBlockVersionDocument = { schema_version: '1.0', port_block_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlock', entity_id: 'block' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlockVersion', entity_id: 'v1' }, name: 'Mixed', version_number: 1, ports: [{ local_id: 'a', kind: 'NETWORK_PORT', row: 1, column: 2, layout_order: 1 }, { local_id: 'b', kind: 'CONNECTION_POINT', row: 1, column: 1, layout_order: 2 }] };
    const hydrated = hydratePortBlockEditorState(version);
    expect(hydrated.direction).toBe('RTL');
    expect(createPortBlockRequest(hydrated).request).toEqual({ name: 'Mixed', ports: version.ports });
  });
});
