import type { PortType } from './PortTypeSelect';
import { EndpointMarker } from './EndpointMarker';
import { useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { BlueprintBody, BaseInternalLink, BlueprintSlot, PresentationPanel } from '../topology/baseTemplateTypes';
import { isPlacedBay, type ModuleBay } from '../topology/hardwareModules';

interface Props {
  portTypes?: PortType[];
  body: BlueprintBody;
  panels: PresentationPanel[];
  slots: BlueprintSlot[];
  internalLinks?: BaseInternalLink[];
  bays?: ModuleBay[];
  label: string;
}

const padding = 20;

export function BlueprintPreview({ portTypes, body, panels, slots, internalLinks = [], bays = [], label }: Props) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 768, height: 440 });
  const [zoom, setZoom] = useState(1);

  useLayoutEffect(() => {
    const element = container.current!;
    const update = () => {
      if (element.clientWidth > 0) {
        setAvailable({ width: element.clientWidth, height: Math.min(window.innerHeight * .55, 480) });
      }
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  const panelsByKey = new Map(panels.map(panel => [panel.panel_key, panel]));
  const ports = slots.map(slot => {
    const panel = panelsByKey.get(slot.panel_key)!;
    return {
      ...slot,
      x: panel.x + slot.rendered_position.x * panel.width,
      y: panel.y + slot.rendered_position.y * panel.height,
    };
  });
  const portsByKey = new Map(ports.map(port => [port.key, port]));
  const placedBays = bays.filter(isPlacedBay).map(bay => {
    const panel = panelsByKey.get(bay.panel_key)!;
    return { ...bay, x: panel.x + bay.x * panel.width, y: panel.y + bay.y * panel.height,
      width: bay.width * panel.width, height: bay.height * panel.height };
  });
  const rectangles = [...panels, ...placedBays];
  const left = Math.min(...rectangles.map(rect => rect.x), ...ports.map(port => port.x));
  const top = Math.min(...rectangles.map(rect => rect.y), ...ports.map(port => port.y));
  const width = Math.max(...rectangles.map(rect => rect.x + rect.width), ...ports.map(port => port.x)) - left;
  const height = Math.max(...rectangles.map(rect => rect.y + rect.height), ...ports.map(port => port.y)) - top;
  const fitScale = Math.min(Math.max(1, available.width - 2 * padding - 2) / width,
    Math.max(1, available.height - 2 * padding - 2) / height);
  const scale = zoom * fitScale;
  const screenWidth = width * scale;
  const screenHeight = height * scale;

  // Size dense markers at fit so zoom changes spacing but preserves screen size.
  const markers = ports.map(port => {
    let radius = 5;
    for (const other of ports) {
      const distance = Math.hypot(other.x - port.x, other.y - port.y);
      if (distance > 0) radius = Math.min(radius, distance * fitScale / 3);
    }
    const panel = panelsByKey.get(port.panel_key)!;
    const clearance = Math.min(port.x - panel.x, panel.x + panel.width - port.x,
      port.y - panel.y, panel.y + panel.height - port.y);
    // Ports authored on an edge still need a visible marker centered on that edge.
    if (clearance > 0) radius = Math.min(radius, clearance * fitScale / 1.2);
    return { ...port, radius };
  });
  return <div ref={container} className="blueprint-preview">
    <div className="blueprint-preview__controls" role="group" aria-label={t('moduleGeometry.zoom')}>
      <button type="button" className="secondary-action" aria-label={t('moduleGeometry.zoomIn')}
        disabled={zoom === 8} onClick={() => setZoom(value => Math.min(8, value * 2))}>+</button>
      <button type="button" className="secondary-action" aria-label={t('moduleGeometry.zoomOut')}
        disabled={zoom === 1} onClick={() => setZoom(value => Math.max(1, value / 2))}>−</button>
      <button type="button" className="secondary-action" disabled={zoom === 1} onClick={() => {
        setZoom(1);
        if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0; }
      }}>{t('moduleGeometry.fit')}</button>
    </div>
    <div ref={viewport} className="blueprint-preview__viewport" tabIndex={zoom > 1 ? 0 : undefined} aria-label={label} role="region">
      <div className="blueprint-preview__surface" style={{ padding, minWidth: screenWidth + 2 * padding }}>
        <svg role="img" aria-label={label} viewBox={`${left} ${top} ${width} ${height}`}
          width={screenWidth} height={screenHeight} preserveAspectRatio="xMidYMid meet">
          {panels.map(panel => <rect key={panel.panel_key} data-panel-key={panel.panel_key} x={panel.x} y={panel.y}
            width={panel.width} height={panel.height} fill={body.fill_color || '#18383a'} stroke="#6ba89b"
            vectorEffect="non-scaling-stroke"><title>{panel.display_name}</title></rect>)}
          {placedBays.map(bay => <rect key={bay.bay_key} data-bay-key={bay.bay_key} x={bay.x} y={bay.y}
            width={bay.width} height={bay.height} fill="#85cdbb" fillOpacity=".12" stroke="#85cdbb"
            strokeDasharray="6 3" vectorEffect="non-scaling-stroke"><title>{bay.display_name}</title></rect>)}
          {internalLinks.map(link => {
            const from = portsByKey.get(link.from_slot_key);
            const to = portsByKey.get(link.to_slot_key);
            return from && to ? <line key={`${from.key}:${to.key}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke="#b6dfd3" opacity=".8" vectorEffect="non-scaling-stroke" /> : null;
          })}
          {markers.map(port => <g key={port.key} data-slot-key={port.key}>
            <EndpointMarker fill={portTypes?.find(type => type.id === port.port_type_id)?.color} kind={port.kind} label={port.display_name} cx={port.x} cy={port.y} r={port.radius / scale}
              stroke="#1c3135" strokeWidth={port.radius * .4 / scale} />
          </g>)}
        </svg>
      </div>
    </div>
  </div>;
}
