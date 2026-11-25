export interface MemberAddress {
  endpointKey: string;
  memberIndex: number;
}

export interface MemberPair {
  a: MemberAddress;
  b: MemberAddress;
}

export interface MemberEndpoint {
  key: string;
  cardinality: number;
  allowsInternalLink: boolean;
}

export const memberAddressKey = ({ endpointKey, memberIndex }: MemberAddress) => JSON.stringify([endpointKey, memberIndex]);
export const memberPairKey = ({ a, b }: MemberPair) => JSON.stringify([memberAddressKey(a), memberAddressKey(b)].sort());

export function internalOccupancy(pairs: readonly MemberPair[]): ReadonlyMap<string, MemberAddress> {
  const occupied = new Map<string, MemberAddress>();
  for (const { a, b } of pairs) {
    occupied.set(memberAddressKey(a), b);
    occupied.set(memberAddressKey(b), a);
  }
  return occupied;
}

export type MemberPairError = 'missingEndpoint' | 'invalidRole' | 'invalidMember' | 'selfLink' | 'occupied';

export function validateMemberPairs(
  endpoints: readonly MemberEndpoint[],
  pairs: readonly MemberPair[],
  occupied: ReadonlyMap<string, MemberAddress> = new Map(),
): MemberPairError | undefined {
  const byKey = new Map(endpoints.map(endpoint => [endpoint.key, endpoint]));
  const used = new Set(occupied.keys());
  for (const { a, b } of pairs) {
    if (a.endpointKey === b.endpointKey) return 'selfLink';
    for (const address of [a, b]) {
      const endpoint = byKey.get(address.endpointKey);
      if (!endpoint) return 'missingEndpoint';
      if (!endpoint.allowsInternalLink) return 'invalidRole';
      if (!Number.isSafeInteger(address.memberIndex) || address.memberIndex < 1 || address.memberIndex > endpoint.cardinality) return 'invalidMember';
      const key = memberAddressKey(address);
      if (used.has(key)) return 'occupied';
      used.add(key);
    }
  }
}

export function pairSelectedMembers(a: readonly MemberAddress[], b: readonly MemberAddress[]) {
  return a.length && a.length === b.length ? a.map((address, index) => ({ a: address, b: b[index] })) : [];
}

/** Use a free address or exchange two addresses already in the preview. */
export function replacePreviewMember(pairs: readonly MemberPair[], row: number, side: 'a' | 'b', address: MemberAddress) {
  const key = memberAddressKey(address);
  const previous = pairs[row][side];
  return pairs.map((pair, index) => {
    if (index === row) return { ...pair, [side]: address };
    if (memberAddressKey(pair[side]) === key) return { ...pair, [side]: previous };
    return pair;
  });
}
