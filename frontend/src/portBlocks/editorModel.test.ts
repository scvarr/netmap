import { describe, expect, it } from 'vitest';
import { createPortBlockRequest, ensureLocalIds, generatePortBlock, hydratePortBlockEditorState, newPortBlockEditorState } from './editorModel';
import type { PortBlockVersionDocument } from '../topology/portBlockTypes';

const ids = (() => { let index = 0; return () => `opaque-${++index}`; })();
describe('Port Block authoring generation', () => {
  it('generates the supported two-row schemes and visual direction as an explicit snapshot', () => {
    const state = { ...newPortBlockEditorState(ids), rows: 2 as const, portsPerRow: 3, localIds: ensureLocalIds([], 6, ids), startingNumber: 1, displayPrefix: 'Gi', scheme: 'ODD_EVEN' as const, direction: 'RTL' as const };
    const ports = generatePortBlock(state).ports;
    expect(ports.map(({ display_label, row, column }) => [display_label, row, column])).toEqual([['Gi1', 1, 3], ['Gi3', 1, 2], ['Gi5', 1, 1], ['Gi2', 2, 3], ['Gi4', 2, 2], ['Gi6', 2, 1]]);
    expect(generatePortBlock({ ...state, scheme: 'SEQUENTIAL' }).ports.map((port) => port.display_label)).toEqual(['Gi1', 'Gi2', 'Gi3', 'Gi4', 'Gi5', 'Gi6']);
    expect(generatePortBlock({ ...state, scheme: 'EVEN_ODD' }).ports.map((port) => port.display_label)).toEqual(['Gi2', 'Gi4', 'Gi6', 'Gi1', 'Gi3', 'Gi5']);
  });
  it('keeps opaque local identities independent of labels, direction and placement', () => {
    const state = { ...newPortBlockEditorState(ids), name: 'Block', localIds: ensureLocalIds([], 4, ids), portsPerRow: 4 };
    const original = createPortBlockRequest(state).request!.ports.map((port) => port.local_id);
    const changed = createPortBlockRequest({ ...state, displayPrefix: 'xe-', direction: 'RTL', startingNumber: 11, labelOverrides: { [original[0]]: 'MGMT' } }).request!.ports;
    expect(changed.map((port) => port.local_id)).toEqual(original);
    expect(changed[0].display_label).toBe('MGMT');
    expect(changed.map((port) => port.column)).toEqual([4, 3, 2, 1]);
  });
  it('round-trips an RTL snapshot exactly without inventing authoring settings', () => {
    const version: PortBlockVersionDocument = { schema_version: '1.0', port_block_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlock', entity_id: 'block' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlockVersion', entity_id: 'v1' }, name: 'RTL', version_number: 1, ports: [{ local_id: 'opaque-a', display_label: 'xe-11', kind: 'NETWORK_PORT', row: 1, column: 3, layout_order: 1 }, { local_id: 'opaque-b', display_label: 'xe-12', kind: 'CONNECTION_POINT', row: 1, column: 2, layout_order: 2 }, { local_id: 'opaque-c', display_label: 'xe-13', kind: 'NETWORK_PORT', row: 1, column: 1, layout_order: 3 }] };
    const hydrated = hydratePortBlockEditorState(version);
    expect([hydrated.direction, hydrated.scheme, hydrated.startingNumber, hydrated.displayPrefix, hydrated.kind]).toEqual([null, null, null, null, null]);
    expect(createPortBlockRequest(hydrated).request).toEqual({ name: 'RTL', ports: version.ports });
  });
  it('round-trips mixed kinds and exceptional two-row labels exactly', () => {
    const version: PortBlockVersionDocument = { schema_version: '1.0', port_block_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlock', entity_id: 'block' }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'PortBlockVersion', entity_id: 'v1' }, name: 'Patch panel', version_number: 3, ports: [{ local_id: 'a', display_label: 'MGMT', kind: 'NETWORK_PORT', row: 1, column: 2, layout_order: 1 }, { local_id: 'b', display_label: 'Uplink', kind: 'CONNECTION_POINT', row: 1, column: 1, layout_order: 2 }, { local_id: 'c', display_label: 'EX-01', kind: 'NETWORK_PORT', row: 2, column: 2, layout_order: 3 }, { local_id: 'd', display_label: 'EX-02', kind: 'CONNECTION_POINT', row: 2, column: 1, layout_order: 4 }] };
    expect(createPortBlockRequest(hydratePortBlockEditorState(version)).request).toEqual({ name: 'Patch panel', ports: version.ports });
  });
});
