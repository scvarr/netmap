import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TopologyCanvas } from '../src/components/TopologyCanvas';
import { I18nProvider, useI18n } from '../src/i18n';
import { LAYOUT_NODE_HEIGHT, LAYOUT_NODE_WIDTH, type TopologyLayoutEngine } from '../src/topology/layout';
import type { LocationDocument, LocationRef } from '../src/topology/locationTypes';
import type { MapLocationState, MapPlacement, UniformLocationGrid } from '../src/topology/savedMapTypes';
import type { BlueprintPresentation, TopologyProjectionDocument } from '../src/topology/types';
import '../src/styles.css';

const location = (entity_id: string): LocationRef => ({ ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id });
const object = (entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type: 'PhysicalObject', entity_id });
const locations: LocationDocument[] = [
  { location_ref: location('building'), name: 'Building', type: null, parent_location_ref: null },
  { location_ref: location('rack'), name: 'Rack', type: null, parent_location_ref: location('building') },
  { location_ref: location('empty'), name: 'Empty', type: null, parent_location_ref: location('building') },
];
const ids = ['switch', 'panel', 'server', 'root-object'];
const placements: MapPlacement[] = ids.map(id => ({
  physical_object_ref: object(id), location_ref: id === 'root-object' ? null : location('rack'), positions: {},
}));
const blueprint: BlueprintPresentation = {
  blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'server-template' },
  version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'server-revision' },
  body: { kind: 'RECTANGLE', width: 120, height: 24 },
  panels: [{ panel_key: 'front', panel_number: 1, display_name: 'Front', x: 0, y: 0, width: 120, height: 24 }],
  slots: [],
};
const topology: TopologyProjectionDocument = {
  schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT',
  edges: [], gaps: [], warnings: [],
  nodes: ids.map(id => ({
    id, kind: 'PHYSICAL_OBJECT', label: id, source_refs: [object(id)],
    attributes: id === 'server' ? { blueprint_presentation: blueprint } : {},
  })),
};
const engine: TopologyLayoutEngine = async scene => ({
  nodes: scene.nodes.map((projection, i) => ({
    id: projection.id, type: 'device', width: LAYOUT_NODE_WIDTH, height: LAYOUT_NODE_HEIGHT,
    position: i < 3 ? { x: 60, y: 90 + i * 170 } : { x: 630, y: 40 }, data: { projection },
  })),
  edges: [],
});
const store = { load: () => ({}), save: () => {}, clear: () => {} };
const settings = (alternate: boolean, reflow: boolean): UniformLocationGrid => ({
  mode: 'uniform_grid', version: 1, hide_empty: false,
  tables: { root: [[null, 'building']], building: reflow ? [['empty', 'rack']] : [['rack'], ['empty']] },
  object_sequences: { rack: { direction: alternate ? 'HORIZONTAL' : 'VERTICAL', order: ids.slice(0, 3) } },
});
const manualBounds = [
  { x: 0, y: 0, width: 560, height: 665 },
  { x: 32, y: 45, width: 310, height: 580 },
  { x: 390, y: 75, width: 130, height: 65 },
];

function Fixture() {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const [manual, setManual] = useState(false);
  const [alternate, setAlternate] = useState(false);
  const [reflow, setReflow] = useState(false);
  const [layouts, setLayouts] = useState([settings(false, false), settings(true, false)]);
  const [savedBoundary, setSavedBoundary] = useState<MapLocationState['geometry']>();
  const [collapsed, setCollapsed] = useState(false);
  const [partial, setPartial] = useState(false);
  const [wide, setWide] = useState(false);
  const [reassigned, setReassigned] = useState(false);
  const displayWidthOverrides = useMemo(() => ({ server: wide ? 145 : 120 }), [wide]);
  const activePlacements = reassigned ? placements.map(p =>
    p.physical_object_ref.entity_id === 'server' ? { ...p, location_ref: location('building') } : p,
  ) : placements;
  const flow = useReactFlow();
  const index = Number(alternate);
  const states: MapLocationState[] = locations.map(({ location_ref }, i) => ({
    location_ref, boundary_point_id: 'point-' + location_ref.entity_id,
    collapsed: location_ref.entity_id === 'rack' && collapsed,
    visible_direct_elements: location_ref.entity_id === 'rack' && partial
      ? [{ entity_type: 'PhysicalObject', entity_id: 'switch' }] : [],
    geometry: manual ? { ...manualBounds[i], edge: 'right', offset: 0.5 }
      : location_ref.entity_id === 'rack' && !alternate ? savedBoundary : undefined,
  }));
  return <>
    <button onClick={() => setShow(value => !value)}>{t('map.virtualChannels')}</button>
    <button onClick={() => {
      setLayouts(current => current.map((layout, i) => i === index ? settings(alternate, !reflow) : layout));
      setReflow(value => !value);
    }}>Reflow</button>
    <button onClick={() => setAlternate(value => !value)}>Switch variant</button>
    <button onClick={() => setManual(value => !value)}>Manual layout</button>
    <button onClick={() => setWide(value => !value)}>Resize equipment</button>
    <button onClick={() => setReassigned(value => !value)}>Reassign equipment</button>
    <button onClick={() => setLayouts(current => current.map((layout, i) => i === index ? { ...layout, hide_empty: !layout.hide_empty } : layout))}>Hide empty</button>
    <button onClick={() => { setCollapsed(true); setPartial(true); }}>Partial collapse</button>
    {[0.35, 1, 2].map(zoom => <button key={zoom} onClick={() => void flow.setViewport({ x: 65, y: 75, zoom })}>zoom {zoom}</button>)}
    <div style={{ width: 1350, height: 1000 }}>
      <TopologyCanvas document={topology} selection={null} onSelectionChange={() => {}}
        sceneKey={String(index)} layoutEngine={engine} layoutStore={store} disableAutoLayout showAllVirtualChannels={show}
        displayWidthOverrides={displayWidthOverrides}
        onPhysicalNodeDragStop={() => {}}
        locationFrameInput={{
          locations, placements: activePlacements, states, variantId: String(index), automatic: manual ? null : layouts[index],
          onCollapse: (id, value) => { if (id === 'rack') { setCollapsed(value); setPartial(false); } },
          onBoundaryPlacement: async (_, placement) => setSavedBoundary({ x: 0, y: 0, width: 0, height: 0, ...placement }),
        }} />
    </div>
  </>;
}

createRoot(document.getElementById('root')!).render(<I18nProvider><ReactFlowProvider><Fixture /></ReactFlowProvider></I18nProvider>);
