import {
  appendMemberPairs, internalOccupancy, mappedMemberPairs, memberMapping, removeMemberPairs,
  validateMemberPairs, type MemberPair,
} from '../blueprints/memberMappings';
import type { PortType } from '../components/PortTypeSelect';
import type { ModuleTemplateInput } from './hardwareModules';

type ModuleLink = NonNullable<ModuleTemplateInput['internal_links']>[number];

export const moduleLinkPairs = (link: ModuleLink) =>
  mappedMemberPairs(link.from_endpoint_key, link.to_endpoint_key, link.member_mappings);

export function moduleWiringEndpoints(definition: ModuleTemplateInput, portTypes?: readonly PortType[]) {
  if (definition.mount_kind !== 'MODULE_BAY') return [];
  const types = new Map(portTypes?.map(type => [type.id, type]));
  return definition.endpoints.filter(endpoint => endpoint.kind === 'CONNECTION_POINT').map(endpoint => {
    const type = types.get(endpoint.port_type_id);
    return { ...endpoint, cardinality: type?.cardinality ?? 0, designations: type?.members, allowsInternalLink: true };
  });
}

export function validateModuleMemberPairs(definition: ModuleTemplateInput, portTypes: readonly PortType[] | undefined, pairs: readonly MemberPair[]) {
  return validateMemberPairs(moduleWiringEndpoints(definition, portTypes), pairs,
    internalOccupancy((definition.internal_links ?? []).flatMap(moduleLinkPairs)));
}

export function applyModuleMemberPairs(definition: ModuleTemplateInput, portTypes: readonly PortType[] | undefined, pairs: readonly MemberPair[]): ModuleTemplateInput {
  if (!pairs.length || validateModuleMemberPairs(definition, portTypes, pairs)) return definition;
  return { ...definition, internal_links: appendMemberPairs(definition.internal_links ?? [], pairs,
    link => [link.from_endpoint_key, link.to_endpoint_key], (link, pair) => ({
      from_endpoint_key: pair.a.endpointKey, to_endpoint_key: pair.b.endpointKey,
      member_mappings: [...(link?.member_mappings ?? []), memberMapping(pair)],
    })) };
}

export function removeModuleMemberPairs(definition: ModuleTemplateInput, keys: ReadonlySet<string>): ModuleTemplateInput {
  return { ...definition, internal_links: removeMemberPairs(definition.internal_links ?? [], keys, moduleLinkPairs,
    (link, indices) => ({ ...link, member_mappings: indices.map(index => link.member_mappings[index]) })) };
}
