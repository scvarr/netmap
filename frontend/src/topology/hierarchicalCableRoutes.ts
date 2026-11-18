import { buildLocationChannelGraph, type LocationChannelBoundary, type LocationChannelGraph, type LocationChannelMember } from './locationVirtualChannels';

export interface LocationChannelInput {
  locationId: string | null;
  boundary: LocationChannelBoundary | null;
  members: (LocationChannelMember & { kind: 'generic-object' | 'blueprint-object' | 'location' })[];
}

export interface ChannelTerminal {
  locationId: string | null;
  terminalId: string;
}

function indexTree(graph: LocationChannelGraph) {
  const adjacent = graph.nodes.map(() => [] as { node: number; segment: number }[]);
  graph.segments.forEach(({ from, to }, segment) => {
    adjacent[from].push({ node: to, segment });
    adjacent[to].push({ node: from, segment });
  });
  const parents = new Map<number, { node: number; segment: number; depth: number }>();
  if (graph.root !== null) {
    parents.set(graph.root, { node: graph.root, segment: -1, depth: 0 });
    const pending = [graph.root];
    for (let index = 0; index < pending.length; index++) {
      const node = pending[index];
      for (const next of adjacent[node]) {
        if (parents.has(next.node)) continue;
        parents.set(next.node, { node, segment: next.segment, depth: parents.get(node)!.depth + 1 });
        pending.push(next.node);
      }
    }
  }
  return (from: string, to: string) => {
    const start = graph.terminals.get(from), end = graph.terminals.get(to);
    if (start === undefined || end === undefined) return null;
    let a: number = start, b: number = end;
    if (a === b) return [];
    if (!parents.has(a) || !parents.has(b)) return null;
    const left: number[] = [], right: number[] = [];
    while (a !== b) {
      const upA = parents.get(a)!, upB = parents.get(b)!;
      if (upA.depth >= upB.depth) {
        left.push(upA.segment);
        a = upA.node;
      } else {
        right.push(upB.segment);
        b = upB.node;
      }
    }
    return left.concat(right.reverse());
  };
}

export function buildHierarchicalCableChannels(inputs: readonly LocationChannelInput[]) {
  const terminals = new Map<string, ChannelTerminal>();
  const locations = new Map(inputs.map(input => {
    for (const member of input.members) {
      terminals.set(member.id, { locationId: input.locationId, terminalId: member.id });
    }
    const graph = buildLocationChannelGraph(input.boundary, input.members);
    return [input.locationId, { input, graph, path: indexTree(graph) }] as const;
  }));
  return { locations, terminals };
}

export type HierarchicalCableChannels = ReturnType<typeof buildHierarchicalCableChannels>;
export interface LocationSegmentRef {
  locationId: string | null;
  segment: number;
}

function ancestors(channels: HierarchicalCableChannels, end: ChannelTerminal) {
  const chain = new Map<string | null, string>();
  for (let anchor: ChannelTerminal | undefined = end; anchor && !chain.has(anchor.locationId);) {
    chain.set(anchor.locationId, anchor.terminalId);
    const boundary: LocationChannelBoundary | null | undefined = channels.locations.get(anchor.locationId)?.input.boundary;
    anchor = boundary ? channels.terminals.get(boundary.id) : undefined;
  }
  return chain;
}

export function hierarchicalLocationPath(channels: HierarchicalCableChannels, from: ChannelTerminal, to: ChannelTerminal) {
  const left = ancestors(channels, from), right = ancestors(channels, to);
  const common = [...left.keys()].find(id => right.has(id));
  if (common === undefined) return { failure: { locationId: from.locationId, from: from.terminalId, to: to.terminalId } };
  const legs: { locationId: string | null; from: string; to: string }[] = [];
  for (const [locationId, terminal] of left) {
    if (locationId === common) break;
    legs.push({ locationId, from: terminal, to: channels.locations.get(locationId)!.input.boundary!.id });
  }
  legs.push({ locationId: common, from: left.get(common)!, to: right.get(common)! });
  const descent: typeof legs = [];
  for (const [locationId, terminal] of right) {
    if (locationId === common) break;
    descent.push({ locationId, from: channels.locations.get(locationId)!.input.boundary!.id, to: terminal });
  }
  const segments: LocationSegmentRef[] = [];
  for (const leg of legs.concat(descent.reverse())) {
    const path = channels.locations.get(leg.locationId)?.path(leg.from, leg.to);
    if (!path) return { failure: leg };
    for (const segment of path) segments.push({ locationId: leg.locationId, segment });
  }
  return { segments };
}
