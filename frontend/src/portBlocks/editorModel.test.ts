import { describe, expect, it } from 'vitest';
import { createPortBlockRequest, ensureLocalIds, generatePortBlock, newPortBlockEditorState } from './editorModel';

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
});
