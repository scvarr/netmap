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

export const endpointPairKey = (a: string, b: string) => JSON.stringify([a, b].sort());

// Keep stored link order and direction, including when a new pair is entered in reverse.
export function appendMemberPairs<Link>(
  links: readonly Link[],
  additions: readonly MemberPair[],
  endpoints: (link: Link) => readonly [string, string],
  append: (link: Link | undefined, pair: MemberPair) => Link,
): Link[] {
  const grouped = new Map(links.map(link => [endpointPairKey(...endpoints(link)), link]));
  for (const pair of additions) {
    const key = endpointPairKey(pair.a.endpointKey, pair.b.endpointKey);
    const existing = grouped.get(key);
    const oriented = existing && endpoints(existing)[0] !== pair.a.endpointKey
      ? { a: pair.b, b: pair.a } : pair;
    grouped.set(key, append(existing, oriented));
  }
  return [...grouped.values()];
}

export function removeMemberPairs<Link>(
  links: readonly Link[],
  keys: ReadonlySet<string>,
  pairsOf: (link: Link) => MemberPair[],
  retain: (link: Link, indices: number[]) => Link,
): Link[] {
  return links.flatMap(link => {
    const pairs = pairsOf(link);
    const indices = pairs.flatMap((pair, index) => keys.has(memberPairKey(pair)) ? [] : [index]);
    if (indices.length === pairs.length) return [link];
    return indices.length ? [retain(link, indices)] : [];
  });
}

export interface MemberMapping {
  from_member_index: number;
  to_member_index: number;
}

export function mappedMemberPairs(from: string, to: string, mappings: readonly MemberMapping[]): MemberPair[] {
  return mappings.map(mapping => ({
    a: { endpointKey: from, memberIndex: mapping.from_member_index },
    b: { endpointKey: to, memberIndex: mapping.to_member_index },
  }));
}

export const memberMapping = ({ a, b }: MemberPair): MemberMapping => ({
  from_member_index: a.memberIndex, to_member_index: b.memberIndex,
});
