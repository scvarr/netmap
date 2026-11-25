import { describe, expect, it } from 'vitest';
import { memberPairKey, pairSelectedMembers, replacePreviewMember } from '../blueprints/memberMappings';
import type { PortType } from '../components/PortTypeSelect';
import { initialModuleGeometry, moduleMount, type ModuleTemplateInput } from './hardwareModules';
import { applyModuleMemberPairs, moduleLinkPairs, moduleWiringEndpoints, removeModuleMemberPairs, validateModuleMemberPairs } from './moduleMemberMappings';

const optical: PortType = {
  id: 'optic', name: 'Optic', medium: 'FIBER', color: '#334455', description: null, is_active: true,
  members: ['Tx', 'Rx', 'Aux'], cardinality: 3, compatibility_mode: 'UNDEFINED',
};
const board: ModuleTemplateInput = {
  ...moduleMount('MODULE_BAY', 'board'), name: 'Passive board', geometry: initialModuleGeometry(),
  endpoints: ['a', 'b', 'c', 'port', 'unknown'].map(key => ({
    key, display_name: key, kind: key === 'port' ? 'NETWORK_PORT' : 'CONNECTION_POINT',
    port_type_id: key === 'unknown' ? 'missing' : optical.id,
  })),
  module_places: [{ ...moduleMount('MODULE_PORT', 'socket-type'), key: 'socket', display_name: 'Socket', x: .3, y: .4 }],
};
const address = (endpointKey: string, memberIndex: number) => ({ endpointKey, memberIndex });
const pair = (a: string, x: number, b: string, y: number) => ({ a: address(a, x), b: address(b, y) });

describe('module member mapping adapter', () => {
  it('uses PortType and only offers owned passive endpoints on boards', () => {
    expect(moduleWiringEndpoints(board, [optical]).map(({ key, cardinality, designations }) =>
      [key, cardinality, designations])).toEqual([
      ['a', 3, optical.members], ['b', 3, optical.members], ['c', 3, optical.members], ['unknown', 0, undefined],
    ]);
    expect(moduleWiringEndpoints({ ...board, ...moduleMount('MODULE_PORT', 'optic') }, [optical])).toEqual([]);
    expect(moduleWiringEndpoints(board).every(endpoint => endpoint.cardinality === 0)).toBe(true);
  });

  it('pairs in selection order, swaps or replaces addresses, groups reverse pairs and removes exact addresses', () => {
    const preview = pairSelectedMembers([address('a', 1), address('a', 2)], [address('b', 1), address('b', 2)]);
    expect(pairSelectedMembers([address('a', 1)], [])).toEqual([]);
    const swapped = replacePreviewMember(preview, 0, 'b', address('b', 2));
    expect(swapped).toEqual([pair('a', 1, 'b', 2), pair('a', 2, 'b', 1)]);
    const replaced = replacePreviewMember(swapped, 0, 'b', address('b', 3));
    expect(replaced).toEqual([pair('a', 1, 'b', 3), pair('a', 2, 'b', 1)]);
    const linked = applyModuleMemberPairs(board, [optical], [replaced[0], pair('b', 1, 'a', 2)]);
    expect(linked.internal_links).toEqual([{
      from_endpoint_key: 'a', to_endpoint_key: 'b',
      member_mappings: [{ from_member_index: 1, to_member_index: 3 }, { from_member_index: 2, to_member_index: 1 }],
    }]);
    const retained = removeModuleMemberPairs(linked, new Set([memberPairKey(pair('b', 3, 'a', 1))]));
    expect(retained.internal_links?.flatMap(moduleLinkPairs)).toEqual([pair('a', 2, 'b', 1)]);
    expect(removeModuleMemberPairs(retained, new Set([memberPairKey(replaced[1])])).internal_links).toEqual([]);
  });

  it.each([
    [pair('a', 1, 'a', 2), 'selfLink'],
    [pair('a', 1, 'socket', 1), 'missingEndpoint'],
    [pair('a', 1, 'port', 1), 'missingEndpoint'],
    [pair('a', 1, 'unknown', 1), 'invalidMember'],
    [pair('a', 1, 'b', 4), 'invalidMember'],
    [pair('a', 1, 'b', 0), 'invalidMember'],
  ] as const)('rejects invalid address %j atomically', (invalid, error) => {
    const pairs = [pair('b', 2, 'c', 1), invalid];
    expect(validateModuleMemberPairs(board, [optical], pairs)).toBe(error);
    expect(applyModuleMemberPairs(board, [optical], pairs)).toBe(board);
  });

  it('enforces occupancy across stored links and across the entire preview', () => {
    const first = pair('a', 1, 'b', 2);
    const second = pair('c', 1, 'a', 1);
    expect(validateModuleMemberPairs(board, [optical], [first, second])).toBe('occupied');
    const linked = applyModuleMemberPairs(board, [optical], [first]);
    expect(validateModuleMemberPairs(linked, [optical], [second])).toBe('occupied');
    expect(applyModuleMemberPairs(linked, [optical], [second])).toBe(linked);
  });
});
