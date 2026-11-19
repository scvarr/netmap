import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QuickInspector } from '../src/components/QuickInspector';
import { TopologyCanvas } from '../src/components/TopologyCanvas';
import { I18nProvider } from '../src/i18n';
import { toFlowProjection, type TopologyLayoutEngine } from '../src/topology/layout';
import type { TopologyProjectionDocument, TopologySelection } from '../src/topology/types';
import '../src/styles.css';

const ref = (entity_type: string, entity_id: string) => ({ ref_type: 'CANONICAL_FACT' as const, entity_type, entity_id });
const panel = (id: string) => ({
  id, label: id, kind: 'PHYSICAL_OBJECT', source_refs: [ref('PhysicalObject', id)],
  attributes: {
    blueprint_presentation: {
      blueprint_ref: ref('BaseTemplate', 'dense'), version_ref: ref('BaseTemplateRevision', 'dense-1'),
      body: { kind: 'RECTANGLE' as const, width: 180, height: 32 },
      panels: [{ panel_key: 'front', panel_number: 1, display_name: 'Front', x: 0, y: 0, width: 180, height: 32 }],
      slots: Array.from({ length: 10 }, (_, index) => {
        // Two free ports sit one minimum pitch below the second and third leads.
        const secondRow = index === 5 || index === 6;
        const position = { x: (12 + (secondRow ? index - 4 : index) * 14) / 180, y: secondRow ? 14 / 32 : .125 };
        return {
          slot_key: `p${index + 1}`, panel_key: 'front', kind: 'NETWORK_PORT' as const,
          display_name: `P${index + 1}`, connection_point_id: `${id}-p${index + 1}`,
          panel_local_position: position, rendered_position: position, external_attachment: { ...position, side: 'TOP' as const },
        };
      }),
    },
  },
});
const topology: TopologyProjectionDocument = {
  schema_version: '1.0', layer: 'L1', detail_level: 'PHYSICAL_OBJECT',
  nodes: [panel('PP1'), panel('SW1')], gaps: [], warnings: [],
  edges: [{
    id: 'parallel', from_node_id: 'PP1', to_node_id: 'SW1', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [],
    attributes: { endpoint_pairs: [1, 2, 3, 4].map(n => ({
      from_connection_point_id: `PP1-p${n}`, to_connection_point_id: `SW1-p${n}`, from_member_index: 1, to_member_index: 1,
      connection_id: `conn-${n}`, connection_member_id: `member-${n}`, cable_ref: ref('Cable', `cable-${n}`), cable_display_name: 'Patch',
    })) },
  }],
};
const layoutEngine: TopologyLayoutEngine = async scene => {
  const projection = await toFlowProjection(scene);
  return { ...projection, nodes: projection.nodes.map((node, index) => ({
    ...node, position: { x: index * 340, y: index * 100 }, data: { ...node.data, compositionDisplayWidth: 180 },
  })) };
};
const displayWidthOverrides = { PP1: 180, SW1: 180 };
const layoutStore = { load: () => null, save: () => {}, clear: () => {} };

function Fixture() {
  const [selection, setSelection] = useState<TopologySelection>(null);
  const [trace, setTrace] = useState(false);
  const [free, setFree] = useState(false);
  const [wiring, setWiring] = useState(false);
  const [clickedPort, setClickedPort] = useState('');
  const flow = useReactFlow();
  return <>
    <div style={{ height: 40 }}>
      {[0.35, 0.6, 1, 2].map(zoom => <button key={zoom} onClick={() => void flow.setViewport({ x: 35, y: 115, zoom })}>zoom {zoom}</button>)}
      <button onClick={() => setTrace(value => !value)}>Trace Cable 1</button>
      <button onClick={() => setFree(value => !value)}>Free channels</button>
      <button onClick={() => setWiring(value => !value)}>Wiring mode</button>
      <output data-testid="clicked-port">{clickedPort}</output>
    </div>
    <div style={{ height: 580 }}>
      <TopologyCanvas document={topology} selection={selection} onSelectionChange={setSelection}
        layoutEngine={layoutEngine} layoutStore={layoutStore} disableAutoLayout
        displayWidthOverrides={displayWidthOverrides} showAllVirtualChannels={free}
        physicalPortStates={wiring ? { 'PP1-p5': 'eligible' } : undefined}
        onPhysicalPortClick={port => setClickedPort(port.connectionPointId)}
        traceOverlay={trace ? {
          highlightedCableIds: new Set(['cable-1']), highlightedConnectionMemberIds: new Set(['member-1']),
          highlightedEdgeIds: new Set(), highlightedNodeIds: new Set(),
        } : undefined} />
    </div>
    <QuickInspector document={topology} selection={selection} onClose={() => setSelection(null)}
      onSelectNode={item => setSelection({ type: 'node', item })} />
  </>;
}

createRoot(document.getElementById('root')!).render(
  <I18nProvider><BrowserRouter><ReactFlowProvider><Fixture /></ReactFlowProvider></BrowserRouter></I18nProvider>,
);
