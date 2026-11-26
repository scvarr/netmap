import { assignMemberFiberTypes } from "../blueprints/memberMappings";
import { EndpointLinkWorkspace } from './EndpointLinkWorkspace';
import { applyBulkNames, blueprintMarkers, bulkNamePreview, spatialOrderedKeys, applyMemberMappings, linkMemberPairs, removeMemberMappings, validateBlueprintMemberPairs, type BlueprintEditorState } from '../blueprints/editorModel';
import type { PortType } from './PortTypeSelect';

export function presentedLinks(state: BlueprintEditorState, sides: { panel: string; order: string[] }[], all: boolean) {
  const slots = new Map(state.slots.map(s => [s.key, s]));
  const compare = (a: string, b: string) => {
    const x = slots.get(a); const y = slots.get(b);
    if (!x || !y) return Number(!x) - Number(!y) || a.localeCompare(b);
    return (state.panels.find(p => p.panel_key === x.panel_key)!.panel_number - state.panels.find(p => p.panel_key === y.panel_key)!.panel_number)
      || x.display_name.localeCompare(y.display_name, 'ru', { numeric: true }) || a.localeCompare(b);
  };
  return state.individualLinks.flatMap(link => {
    let a = link.from_slot_key; let b = link.to_slot_key;
    if (all) { if (compare(a,b) > 0) [a,b] = [b,a]; }
    else {
      const forward = slots.get(a)?.panel_key === sides[0].panel && slots.get(b)?.panel_key === sides[1].panel;
      const backward = slots.get(b)?.panel_key === sides[0].panel && slots.get(a)?.panel_key === sides[1].panel;
      if (!forward && !backward) return [];
      if (!forward || (backward && compare(a,b) > 0)) [a,b] = [b,a];
    }
    return [{ link, a, b }];
  }).sort((x,y) => compare(x.a,y.a) || compare(x.b,y.b));
}

export function BaseEndpointLinkWorkspace({ state, onChange, onClose, initialSelectedKeys, portTypes, wiringReadOnly }: {
  state: BlueprintEditorState;
  initialSelectedKeys?: string[];
  portTypes?: PortType[];
  wiringReadOnly?: boolean;
  onChange: (state: BlueprintEditorState) => void;
  onClose: () => void;
}) {
  const markers = blueprintMarkers(state);
  const initialSides = initialSelectedKeys?.length ? undefined : state.endpointNaming?.map(side => ({
    ...side, panel: state.panels.some(p => p.panel_key === side.panel) ? side.panel : state.activePanelKey,
  }));
  const typeById = new Map(portTypes?.map(type => [type.id, type]));
  return <EndpointLinkWorkspace
    endpoints={markers.map(marker => ({
      key: marker.key, display_name: marker.display_name, kind: marker.kind, panel: marker.panel_key,
      cardinality: 'cardinality' in marker ? marker.cardinality ?? 1 : marker.port_type_id ? 1 : 0,
      designations: marker.port_type_id ? typeById.get(marker.port_type_id)?.members : undefined,
      medium: marker.port_type_id ? typeById.get(marker.port_type_id)?.medium : undefined,
    }))}
    storedPairs={state.individualLinks.flatMap(linkMemberPairs)}
    validate={pairs => validateBlueprintMemberPairs(state, pairs)}
    onApply={pairs => onChange(applyMemberMappings(state, pairs))}
    onAssignFiber={(keys, fiberType) => onChange({ ...state, individualLinks: state.individualLinks.map(link =>
      ({ ...link, member_mappings: assignMemberFiberTypes(linkMemberPairs(link), keys, fiberType) })) })}
    onRemove={keys => onChange(removeMemberMappings(state, keys))}
    panelTools={{
      panels: state.panels.map(p => ({ key: p.panel_key, name: p.display_name })),
      defaultPanels: [state.activePanelKey, state.panels.find(p => p.panel_key !== state.activePanelKey)?.panel_key ?? state.activePanelKey],
      initialSides,
      onPreferencesChange: sides => {
        const endpointNaming = sides.map(({ selected: _selected, panel, ...side }) => ({ ...side, panel: panel! }));
        if (JSON.stringify(endpointNaming) !== JSON.stringify(state.endpointNaming)) onChange({ ...state, endpointNaming });
      },
      spatialOrder: (side, keys) => spatialOrderedKeys({ ...state, activePanelKey: side.panel! }, keys, side.horizontal, side.vertical),
      names: (side, keys) => bulkNamePreview({ ...state, activePanelKey: side.panel! }, keys, side.naming),
      rename: (side, keys) => {
        const renamed = applyBulkNames({ ...state, activePanelKey: side.panel! }, keys, side.naming);
        onChange({ ...renamed, activePanelKey: state.activePanelKey });
      },
      present: (sides, all) => presentedLinks(state, sides.map(side => ({ ...side, panel: side.panel! })), all)
        .flatMap(({ link, a }) => linkMemberPairs(link).map(pair => a === pair.a.endpointKey ? pair : { ...pair, a: pair.b, b: pair.a })
          .sort((first, second) => first.a.memberIndex - second.a.memberIndex || first.b.memberIndex - second.b.memberIndex)),
    }}
    initialSelectedKeys={initialSelectedKeys} wiringReadOnly={wiringReadOnly} onClose={onClose} />;
}
