import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ForegroundCableRoutes } from './FloatingTopologyEdge';

const cableRef = (id: string) => ({ ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: id });
const markerPoints = ['eligible', 'source', 'destination', 'unavailable'].map((id) => ({ connection_point_id: id, display_name: id, cardinality: 1, external_connection_count: 0 }));
const source = { internals: { positionAbsolute: { x: 0, y: 0 } }, measured: { width: 100, height: 100 }, data: { projection: { id: 'source', kind: 'PHYSICAL_OBJECT', label: 'source', source_refs: [], attributes: { connection_points: markerPoints } } } };
const target = { internals: { positionAbsolute: { x: 300, y: 0 } }, measured: { width: 100, height: 100 }, data: { projection: { id: 'target', kind: 'PHYSICAL_OBJECT', label: 'target', source_refs: [], attributes: { connection_points: markerPoints } } } };
let activeNodes: Record<string, any> = { source, target };

vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ zoom: 1 }),
  BaseEdge: ({ interactionWidth, path, style }: any) => <path data-testid="base-edge" data-interaction-width={interactionWidth} d={path} style={style} />,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  getStraightPath: () => ['straight'],
  useInternalNode: (id: string) => activeNodes[id],
  useNodes: () => Object.entries(activeNodes).map(([id, node]: [string, any]) => ({ id, data: node.data, position: node.internals.positionAbsolute, measured: node.measured })),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const blueprintNode = (id: string, x: number, physicalObjectId: string, slot: { connectionPointId: string; kind: 'CONNECTION_POINT' | 'NETWORK_PORT'; renderedX: number; attachmentX: number; side: 'LEFT' | 'RIGHT' }) => ({
  internals: { positionAbsolute: { x, y: 0 } },
  measured: { width: 100, height: 100 },
  data: { compositionDisplayWidth: 32, projection: {
    id,
    kind: 'PHYSICAL_OBJECT',
    label: id,
    source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: physicalObjectId }],
    attributes: { blueprint_presentation: { blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: `${id}-bp` }, version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: `${id}-v` }, body: { kind: 'RECTANGLE', width: 100, height: 100 }, panels: [{ panel_key: 'panel', panel_number: 1, display_name: 'Panel', x: 0, y: 0, width: 100, height: 100 }], slots: [{ slot_key: slot.connectionPointId, display_name: slot.connectionPointId, kind: slot.kind, connection_point_id: slot.connectionPointId, panel_key: 'panel', panel_local_position: { x: slot.renderedX, y: .5 }, rendered_position: { x: slot.renderedX, y: .5 }, external_attachment: { x: slot.attachmentX, y: .5, side: slot.side } }] } },
  } },
});

const withNodes = (nodes: Record<string, any>, run: () => void) => {
  const previous = activeNodes;
  activeNodes = nodes;
  try { run(); } finally { activeNodes = previous; }
};

describe('direct cable route edge interaction', () => {
  it('uses shared geometry for hover, selection, trace, and cable choice', () => {
    const fixture = (id: string, x: number) => blueprintNode(id, x, id, {
      connectionPointId: id + '-a', kind: 'CONNECTION_POINT', renderedX: .1, attachmentX: 0, side: 'LEFT',
    });
    const left = fixture('left', 0);
    const right = fixture('right', 300);
    for (const node of [left, right]) {
      const slots = node.data.projection.attributes.blueprint_presentation.slots;
      slots.push({ ...slots[0], connection_point_id: node.data.projection.id + '-b', display_name: 'Port B', rendered_position: { x: .8, y: .8 }, panel_local_position: { x: .8, y: .8 } });
      slots.push({ ...slots[0], connection_point_id: node.data.projection.id + '-free', rendered_position: { x: .8, y: .15 }, panel_local_position: { x: .8, y: .15 } });
    }
    const cable = (id: string, emphasis: string) => ({
      id, source: 'left', target: 'right', data: {
        cableNode: { id, label: 'Patch', attributes: {}, source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: id }] },
        endpointPair: { from_connection_point_id: 'left-' + id, to_connection_point_id: 'right-' + id },
        cablePresentationEmphasis: emphasis,
      },
    });
    const a = cable('a', 'normal'), b = cable('b', 'normal');
    const onCableSelect = vi.fn();
    withNodes({ left, right }, () => {
      const view = render(<ForegroundCableRoutes edges={[]} virtualChannels />);
      const channels = () => [...view.container.querySelectorAll('.object-virtual-channel')];
      expect(channels()).toHaveLength(0);
      view.rerender(<ForegroundCableRoutes edges={[]} virtualChannels showAllVirtualChannels />);
      const fullCount = channels().length;
      expect(fullCount).toBeGreaterThan(0);
      expect(channels().every(p => p.classList.contains('cable-route-foreground--free'))).toBe(true);
      view.rerender(<ForegroundCableRoutes edges={[a] as any} virtualChannels onCableSelect={onCableSelect} />);
      const oneCableCount = channels().length;
      expect(oneCableCount).toBeGreaterThan(0);
      view.rerender(<ForegroundCableRoutes edges={[a, b] as any} virtualChannels onCableSelect={onCableSelect} />);
      expect(channels().length).toBeGreaterThan(oneCableCount);
      expect(channels().length).toBeLessThan(fullCount);
      expect(channels().filter(p => p.getAttribute('d') === 'M 116 16 L 124 16')).toHaveLength(1);
      expect(view.container.querySelectorAll('.cable-route-foreground')).toHaveLength(1);
      const single = view.container.querySelector('.cable-route-hit[data-cable-count="1"][aria-label*="Port B"]')!;
      const shared = view.container.querySelector('.cable-route-hit[data-cable-count="2"]')!;
      fireEvent.pointerEnter(single);
      expect(view.getByRole('tooltip')).toHaveTextContent('Patch');
      expect(view.getByRole('tooltip')).toHaveTextContent('left / Port B');
      expect(view.container.querySelectorAll('.cable-route-foreground--hovered')).toHaveLength(9);
      expect(onCableSelect).not.toHaveBeenCalled();
      fireEvent.pointerLeave(single);
      expect(view.queryByRole('tooltip')).toBeNull();
      expect(view.container.querySelector('.cable-route-foreground--hovered')).toBeNull();
      fireEvent.click(single);
      expect(onCableSelect).toHaveBeenLastCalledWith(b);

      fireEvent.pointerEnter(shared);
      expect(view.getByRole('tooltip')).toHaveTextContent('Кабелей на участке: 2');
      fireEvent.keyDown(shared, { key: 'Escape' });
      expect(view.queryByRole('tooltip')).toBeNull();
      fireEvent.keyDown(shared, { key: 'Enter' });
      expect(view.getByRole('dialog')).toBeInTheDocument();
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(view.queryByRole('dialog')).toBeNull();
      fireEvent.click(shared);
      fireEvent.pointerDown(document.body);
      expect(view.queryByRole('dialog')).toBeNull();
      fireEvent.click(shared);
      fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: /Patch.*Port B/ }));
      expect(onCableSelect).toHaveBeenLastCalledWith(b);
      expect(view.queryByRole('dialog')).toBeNull();

      const traced = cable('a', 'traced');
      const selected = cable('b', 'selected');
      view.rerender(<ForegroundCableRoutes edges={[traced, selected] as any} virtualChannels traceActive onCableSelect={onCableSelect} />);
      fireEvent.pointerEnter(single);
      expect(view.container.querySelector('.cable-route-foreground--hovered')).toBeNull();
      expect(view.container.querySelector('.cable-route-foreground--traced')).toBeInTheDocument();
      expect(view.container.querySelectorAll('.cable-route-marker:not(.cable-route-marker--hovered)')).toHaveLength(1);
      expect(onCableSelect).toHaveBeenCalledTimes(2);
      right.internals.positionAbsolute = { x: 450, y: 70 };
      right.data.compositionDisplayWidth = 48;
      view.rerender(<ForegroundCableRoutes edges={[a, b] as any} virtualChannels showAllVirtualChannels />);
      expect(view.container.querySelector('.cable-route-foreground')).toHaveAttribute('d', 'M 124 16 L 590 94');
    });
  });
  it('renders a cable to a Location proxy without treating the proxy as a port-bearing object', () => {
    const proxy = { internals: { positionAbsolute: { x: 0, y: 0 } }, measured: { width: 110, height: 30 }, data: { projection: null, locationProxy: { locationId: 'room', label: 'Room', hiddenObjectCount: 1 } } };
    const cable = { id: "real-cable", source: "proxy", target: "target", data: { cableNode: { source_refs: [cableRef("canonical-cable")], id: "canonical-cable" } } };
    withNodes({ proxy, target }, () => {
      const { container } = render(<ForegroundCableRoutes edges={[cable] as any} />);
      expect(container.querySelector('[data-testid="foreground-cable-real-cable"]')).not.toBeNull();
      expect(container.querySelectorAll('.cable-route-port-marker')).toHaveLength(markerPoints.length);
      const anchor = container.querySelector('.cable-route-foreground')?.getAttribute('d')?.match(/^M ([\d.]+) ([\d.]+) /);
      expect(anchor).not.toBeNull();
      expect(Number(anchor![1])).toBe(proxy.measured.width);
      expect(Number(anchor![2])).toBeGreaterThanOrEqual(0);
      expect(Number(anchor![2])).toBeLessThanOrEqual(proxy.measured.height);
    });
  });
  it('anchors a real cable between two compact Location proxies', () => {
    const proxy = (id: string, x: number) => ({ internals: { positionAbsolute: { x, y: 0 } }, measured: { width: 110, height: 30 }, data: { projection: null, locationProxy: { locationId: id, label: id, hiddenObjectCount: 1 } } });
    const cable = { id: 'between-proxies', source: 'left', target: 'right', data: { cableNode: { source_refs: [cableRef('canonical-cable')], id: 'canonical-cable' } } };
    withNodes({ left: proxy('left', 0), right: proxy('right', 300) }, () => {
      const { container } = render(<ForegroundCableRoutes edges={[cable] as any} />);
      expect(container.querySelector('.cable-route-foreground')).toHaveAttribute('d', 'M 110 15 L 300 15');
    });
  });
  it('preserves every wiring port state in the foreground repaint', () => {
    const edge = { id: 'cable', source: 'source', target: 'target', data: { cableNode: { source_refs: [cableRef('cable-node')], id: 'cable-node' } } };
    const { container } = render(<ForegroundCableRoutes edges={[edge] as any} physicalPortStates={{ eligible: 'eligible', source: 'source', destination: 'destination', unavailable: 'unavailable' }} />);
    for (const state of ['eligible', 'source', 'destination', 'unavailable']) {
      expect(container.querySelector(`.cable-route-port-marker--wiring-${state}`)).toBeInTheDocument();
    }
  });

  it('centers compact bulk numbers above both marker shapes', () => {
    const blueprintSource = blueprintNode('source', 0, 'source-object', { connectionPointId: 'source-port', kind: 'NETWORK_PORT', renderedX: .25, attachmentX: 1, side: 'RIGHT' });
    const blueprintTarget = blueprintNode('target', 300, 'target-object', { connectionPointId: 'target-port', kind: 'CONNECTION_POINT', renderedX: .75, attachmentX: 0, side: 'LEFT' });
    withNodes({ source: blueprintSource, target: blueprintTarget }, () => {
      const { container } = render(<ForegroundCableRoutes edges={[]} bulkPortNumbers={{ 'source-port': 1, 'target-port': 12 }} />);
      for (const [number, shape] of [['1', 'rect'], ['12', 'circle']] as const) {
        const label = [...container.querySelectorAll('text')].find((item) => item.textContent === number);
        const marker = label?.parentElement?.querySelector(shape);
        expect(label).toBeInTheDocument();
        expect(marker).toBeInTheDocument();
        const centerX = shape === 'rect' ? Number(marker?.getAttribute('x')) + Number(marker?.getAttribute('width')) / 2 : Number(marker?.getAttribute('cx'));
        const centerY = shape === 'rect' ? Number(marker?.getAttribute('y')) + Number(marker?.getAttribute('height')) / 2 : Number(marker?.getAttribute('cy'));
        expect(Number(label?.getAttribute('x'))).toBe(centerX);
        expect(Number(label?.getAttribute('y'))).toBe(centerY - 8);
        expect(label).toHaveAttribute('text-anchor', 'middle');
        expect(label).toHaveAttribute('font-size', '8');
        expect(label).toHaveAttribute('font-weight', '700');
        expect(label).toHaveAttribute('stroke-width', '1');
      }
    });
  });

  it('uses Blueprint rendered ports directly when virtual channels are disabled', () => {
    const blueprintSource = blueprintNode('source', 0, 'source-object', { connectionPointId: 'source-port', kind: 'NETWORK_PORT', renderedX: .25, attachmentX: 1, side: 'RIGHT' });
    const blueprintTarget = blueprintNode('target', 300, 'target-object', { connectionPointId: 'target-port', kind: 'CONNECTION_POINT', renderedX: .75, attachmentX: 0, side: 'LEFT' });
    withNodes({ source: blueprintSource, target: blueprintTarget }, () => {
      const edge = { id: 'blueprint-cable', source: 'source', target: 'target', data: { projection: { id: 'edge', from_node_id: 'source', to_node_id: 'target', kind: 'L1_PHYSICAL_LINK', aggregate: true, source_refs: [], attributes: {} }, cableNode: { source_refs: [cableRef('cable-node')], id: 'cable-node' }, endpointPair: { from_connection_point_id: 'source-port', to_connection_point_id: 'target-port' } } };
      const { container } = render(<ForegroundCableRoutes edges={[edge] as any} physicalPortStates={{ 'source-port': 'source', 'target-port': 'destination' }} />);
      const markers = container.querySelectorAll('.cable-route-port-marker');
      expect(markers).toHaveLength(2);
      expect(markers[0]).toHaveAttribute('x', '77.25');
      expect(markers[0].tagName).toBe('rect');
      expect(markers[0]).toHaveClass('cable-route-port-marker--network', 'cable-route-port-marker--wiring-source');
      expect(markers[0]).toHaveAttribute('pointer-events', 'none');
      expect(markers[1]).toHaveAttribute('cx', '396');
      expect(markers[1].tagName).toBe('circle');
      expect(markers[1]).toHaveClass('cable-route-port-marker--wiring-destination');
      expect(container.querySelector('.cable-route-port-marker[cx="100"]')).toBeNull();
      expect(container.querySelector('.cable-route-port-marker[cx="300"]')).toBeNull();
      expect(container.querySelector('.cable-route-foreground')).toHaveAttribute('d', 'M 80 16 L 396 16');
    });
  });

  it('shares occupied channels with the wiring draft through source, target, cancel and confirmation', () => {
    const blueprintSource = blueprintNode('source', 0, 'source-object', { connectionPointId: 'source-port', kind: 'NETWORK_PORT', renderedX: .25, attachmentX: 1, side: 'RIGHT' });
    const blueprintTarget = blueprintNode('target', 300, 'target-object', { connectionPointId: 'target-port', kind: 'CONNECTION_POINT', renderedX: .75, attachmentX: 0, side: 'LEFT' });
    for (const [node, x] of [[blueprintSource, .75], [blueprintTarget, .25]] as const) {
      const slots = node.data.projection.attributes.blueprint_presentation.slots;
      slots.push({ ...slots[0], connection_point_id: node.data.projection.id + '-occupied', panel_local_position: {x, y: .5}, rendered_position: {x, y: .5} });
    }
    const wiring = {
      source: { physicalObjectId: 'source-object', connectionPointId: 'source-port' },
      target: { physicalObjectId: 'target-object', connectionPointId: 'target-port' },
    };
    const cable = (id: string, suffix: string) => ({
      id, source: 'source', target: 'target', data: {
        cableNode: { id, label: 'Patch', attributes: {}, source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'Cable', entity_id: id }] },
        endpointPair: { from_connection_point_id: `source-${suffix}`, to_connection_point_id: `target-${suffix}` },
        cablePresentationEmphasis: 'normal',
      },
    });
    const occupied = cable('occupied', 'occupied');
    const edges = [occupied] as any;
    const onCableSelect = vi.fn();
    withNodes({ source: blueprintSource, target: blueprintTarget }, () => {
      const view = render(<ForegroundCableRoutes edges={edges} virtualChannels onCableSelect={onCableSelect} />);
      const segments = () => [...view.container.querySelectorAll('.object-virtual-channel')]
        .map(p => `${p.parentElement?.getAttribute('transform')} ${p.getAttribute('d')}`).sort();
      const preview = () => view.container.querySelector('[data-testid="foreground-wiring-route"] path');
      const occupiedPath = () => view.container.querySelector('[data-testid="foreground-cable-occupied"] path');
      const original = segments();
      view.rerender(<ForegroundCableRoutes edges={edges} virtualChannels physicalPortStates={{'source-port': 'eligible'}} />);
      expect(segments()).toEqual(original);
      expect(occupiedPath()).toHaveAttribute('d', 'M 124 16 L 424 16');
      view.rerender(<ForegroundCableRoutes edges={edges} virtualChannels wiringRoute={{ ...wiring, target: undefined }} onCableSelect={onCableSelect} />);
      expect(view.container.querySelector('.object-virtual-channel.wiring-route-preview')).toBeInTheDocument();
      expect(preview()).toBeNull();
      view.rerender(<ForegroundCableRoutes edges={edges} virtualChannels wiringRoute={wiring} onCableSelect={onCableSelect} />);
      const confirmed = segments();
      expect(confirmed).toHaveLength(new Set(confirmed).size);
      expect(confirmed).toEqual(expect.arrayContaining(original));
      expect(view.container.querySelector('.cable-route-hit')).toBeNull();
      expect(onCableSelect).not.toHaveBeenCalled();
      const connector = preview()!.getAttribute('d');
      expect(connector).toBe('M 124 16 L 424 16');
      view.rerender(<ForegroundCableRoutes edges={edges} virtualChannels />);
      expect(segments()).toEqual(original);
      expect(preview()).toBeNull();
      view.rerender(<ForegroundCableRoutes edges={[occupied, cable('new', 'port')] as any} virtualChannels />);
      expect(segments()).toEqual(confirmed);
      expect(view.container.querySelector('.cable-route-foreground')).toHaveAttribute('d', connector);
    });
  });

  it('uses the rendered Generic endpoint when wiring from a Blueprint beside a Location proxy', () => {
    const blueprint = blueprintNode('source', 0, 'source-object', { connectionPointId: 'source-port', kind: 'NETWORK_PORT', renderedX: .25, attachmentX: 1, side: 'RIGHT' });
    const generic = { ...target, data: { projection: { ...target.data.projection, source_refs: [{ ref_type: 'CANONICAL_FACT', entity_type: 'PhysicalObject', entity_id: 'generic' }] } } };
    const proxy = { ...target, data: { projection: null, locationProxy: { locationId: 'room' } } };
    withNodes({ proxy, source: blueprint, target: generic }, () => {
      const { container } = render(<ForegroundCableRoutes edges={[]} virtualChannels wiringRoute={{
        source: { physicalObjectId: 'source-object', connectionPointId: 'source-port' },
        target: { physicalObjectId: 'generic', connectionPointId: 'source' },
      }} />);
      expect(container.querySelector('[data-testid="foreground-wiring-route"] path')).toHaveAttribute('d', 'M 124 16 L 400 60');
    });
  });

  it('forwards a right click on the foreground Cable to its context menu handler', () => {
    const bare = { id: "cable", source: "source", target: "target", data: {} };
    const edge = { ...bare, data: { ...bare.data, cableNode: { source_refs: [cableRef('cable')], id: 'cable', label: 'Cable' } }, style: { strokeWidth: 2 } };
    const onCableContextMenu = vi.fn((event: React.MouseEvent<SVGElement>) => event.preventDefault());
    const onAncestorContextMenu = vi.fn();
    const { container } = render(<div onContextMenu={onAncestorContextMenu}><ForegroundCableRoutes edges={[edge] as any} onCableContextMenu={onCableContextMenu} /></div>);
    const path = container.querySelector('.cable-route-hit')!;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 50 });
    fireEvent(path, event);
    expect(onCableContextMenu).toHaveBeenCalledWith(expect.anything(), edge);
    expect(event.defaultPrevented).toBe(true);
    expect(onAncestorContextMenu).not.toHaveBeenCalled();
  });

  it('orders visual Cable states independently of edges order and follows selection changes', () => {
    const bare = { id: "cable", source: "source", target: "target", data: {} };
    const make = (id: string, emphasis: string, selected = false) => ({ ...bare, id, selected, data: { ...bare.data, cableNode: { source_refs: [cableRef(id)], id }, endpointPair: { from_connection_point_id: markerPoints[['normal', 'traced', 'attached', 'selected'].indexOf(id)].connection_point_id }, cablePresentationEmphasis: emphasis } });
    const normal = make('normal', 'normal');
    const selected = make('selected', 'selected', true);
    const attached = make('attached', 'attached');
    const traced = make('traced', 'traced');
    const wiring = { source: { physicalObjectId: 'source-object', connectionPointId: 'source-port' } };
    const order = (root: HTMLElement) => [...root.querySelectorAll('[data-testid^="foreground-cable-"]')].map((node) => node.getAttribute('data-testid'));
    const view = render(<ForegroundCableRoutes edges={[selected, traced, normal, attached] as any} wiringRoute={wiring} />);
    expect(order(view.container)).toEqual(['foreground-cable-normal', 'foreground-cable-traced', 'foreground-cable-attached', 'foreground-cable-selected']);
    view.rerender(<ForegroundCableRoutes edges={[make('selected', 'normal'), traced, make('normal', 'selected', true), attached] as any} wiringRoute={wiring} />);
    expect(order(view.container).at(-1)).toBe('foreground-cable-normal');
  });
});
