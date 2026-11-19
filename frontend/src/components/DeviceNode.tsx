import { useRef } from 'react';
import { useRuntimePortTypes } from './RuntimePortTypes';
import { Handle, NodeResizeControl, Position, type NodeProps } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import type { DeviceNodeData } from '../topology/layout';
import { displayNodeLabel, physicalClassPresentation } from '../topology/presentation';
import { genericConnectionPoints, genericEndpointOffset } from '../topology/genericEndpointPresentation';
import { internalL1Segments } from '../topology/internalL1Presentation';
import { physicalPortPaint, tracedPortIds } from '../topology/physicalPortPresentation';
import { PhysicalFaceIndicator } from './PhysicalFaceControls';
import { InternalL1Continuity } from './InternalL1Continuity';
import { BLUEPRINT_PORT_SIZE, BLUEPRINT_PORT_STROKE, OBJECT_NAME_ZONE_WIDTH, OBJECT_SIDE_ZONES_WIDTH, blueprintNodeDisplayDimensions, minimumBlueprintDisplayWidth, panelCompositionBounds } from '../topology/blueprintDisplaySize';

type DeviceFlowNode = Node<DeviceNodeData, 'device'>;

export function DeviceNode({ data, selected, width }: NodeProps<DeviceFlowNode>) {
  const resizeStart = useRef<{ frameWidth: number; displayWidth: number } | null>(null);
  const portTypes = useRuntimePortTypes();
  const { projection } = data;
  const physical = projection.kind === 'PHYSICAL_OBJECT';
  const classPresentation = physicalClassPresentation(projection.attributes.class);
  const blueprint = projection.attributes.blueprint_presentation;
  const singlePanelFace = blueprint?.panels.length === 1 ? blueprint.panels[0].face : undefined;
  const faceIndicator = data.resolvedFace && <PhysicalFaceIndicator resolved={data.resolvedFace}
    panelFace={singlePanelFace} onChange={data.onFaceChange} disabled={data.faceBusy} />;
  const objectId = projection.source_refs.find((ref) => ref.ref_type === 'CANONICAL_FACT' && ref.entity_type === 'PhysicalObject')?.entity_id;
  const tracedPorts = tracedPortIds(projection, data.traceHighlightedConnectionMemberIds);
  const portProps = (connectionPointId: string, label: string) => {
    const state = data.physicalPortStates?.[connectionPointId];
    return { role: 'button' as const, tabIndex: state === 'unavailable' ? -1 : 0, 'aria-label': `Порт ${label}`, 'aria-disabled': state === 'unavailable' || undefined, onClick: (event: React.MouseEvent) => { event.stopPropagation(); if (state !== 'unavailable' && objectId) data.onPhysicalPortClick?.({ physicalObjectId: objectId, connectionPointId, label }); }, onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); if (objectId) data.onPhysicalPortContextMenu?.({ physicalObjectId: objectId, connectionPointId, label }, { x: event.clientX, y: event.clientY }); }, onKeyDown: (event: React.KeyboardEvent) => { if ((event.key === 'Enter' || event.key === ' ') && state !== 'unavailable' && objectId) { event.preventDefault(); data.onPhysicalPortClick?.({ physicalObjectId: objectId, connectionPointId, label }); } } };
  };
  if (physical && blueprint) {
    const displayWidth = blueprintNodeDisplayDimensions(blueprint, data.compositionDisplayWidth).width;
    const displayHeight = blueprintNodeDisplayDimensions(blueprint, displayWidth).height;
    const frameWidth = Math.max(width ?? 0, displayWidth + OBJECT_SIDE_ZONES_WIDTH);
    const cableWidth = frameWidth - OBJECT_NAME_ZONE_WIDTH - displayWidth;
    const bounds = panelCompositionBounds(blueprint.panels);
    return <div data-testid="blueprint-map-node" className={`blueprint-map-node${selected ? ' blueprint-map-node--selected' : ''}${data.traceHighlighted ? ' blueprint-map-node--trace-highlighted' : ''}`} style={{ width: frameWidth, height: displayHeight, gridTemplateColumns: `${OBJECT_NAME_ZONE_WIDTH}px ${displayWidth}px ${cableWidth}px` }}>
    <NodeResizeControl
      position="right"
      resizeDirection="horizontal"
      style={{ display: selected && data.blueprintResizeEnabled ? undefined : "none" }}
      minWidth={minimumBlueprintDisplayWidth(blueprint) + OBJECT_SIDE_ZONES_WIDTH}
      maxWidth={960 + OBJECT_SIDE_ZONES_WIDTH}
      minHeight={blueprintNodeDisplayDimensions(blueprint, minimumBlueprintDisplayWidth(blueprint)).height}
      maxHeight={blueprintNodeDisplayDimensions(blueprint, 960).height}

      className="blueprint-map-node__resizer-handle"
      onResizeStart={() => { resizeStart.current = { frameWidth, displayWidth }; }}
      onResizeEnd={(_, dimensions) => {
        const start = resizeStart.current ?? { frameWidth, displayWidth };
        resizeStart.current = null;
        if (objectId) data.onBlueprintDisplayResize?.(objectId, start.displayWidth + dimensions.width - start.frameWidth);
      }}
    />
    <Handle type="target" position={Position.Top} className="device-node__handle" />
    <strong className="blueprint-map-node__identity" title={data.locationPresentationPath ? `${displayNodeLabel(projection)} — ${data.locationPresentationPath}` : displayNodeLabel(projection)}>
      <span className="blueprint-map-node__title">{displayNodeLabel(projection)}</span>
      {faceIndicator}
      {data.locationPresentationPath && <span className="blueprint-map-node__location">{data.locationPresentationPath}</span>}
    </strong>
    <div className="blueprint-map-node__body" style={{ height: displayHeight }}>
    <div className="blueprint-map-node__panels">
      {blueprint.panels.filter(panel => !data.facePresentation?.hiddenPanels.has(panel.panel_key)).map((panel) => {
        return <section key={panel.panel_key} className="blueprint-map-node__panel" data-testid={`blueprint-panel-${panel.panel_key}`} style={{ left: `${(panel.x - bounds.x) / bounds.width * 100}%`, top: `${(panel.y - bounds.y) / bounds.height * 100}%`, width: `${panel.width / bounds.width * 100}%`, height: `${panel.height / bounds.height * 100}%`, background: blueprint.body.fill_color ?? '#18383a' }}>
          <div className="blueprint-map-node__panel-surface" title={panel.display_name}>
            {blueprint.slots.filter((slot) => slot.panel_key === panel.panel_key).map((slot) => {
              const id = slot.connection_point_id;
              const portType = portTypes?.find(type => type.id === slot.port_type_id);
              const state = data.physicalPortStates?.[id];
              const occupied = data.cableOccupiedPortIds?.has(id) ?? false;
              const traced = tracedPorts.has(id);
              const { fill, outline } = physicalPortPaint(portType?.color, occupied, traced, state);
              const style = { '--port-size': `${BLUEPRINT_PORT_SIZE}px`, '--port-stroke': `${BLUEPRINT_PORT_STROKE}px`,
                backgroundColor: fill, borderColor: outline, left: `${slot.panel_local_position.x * 100}%`, top: `${slot.panel_local_position.y * 100}%` };
              return <span key={id} className={`blueprint-map-node__port blueprint-map-node__port--${slot.kind.toLowerCase()}${traced ? ' blueprint-map-node__port--trace-highlighted' : ''}${data.wiringContinuationConnectionPointIds?.has(id) ? ' blueprint-map-node__port--wiring-continuation' : ''}${state ? ` blueprint-map-node__port--wiring-${state}` : ''}`}
                style={style} data-connection-point-id={id} title={`${slot.display_name} · ${portType?.name ?? slot.kind}`} {...portProps(id, slot.display_name)}>
                <span className="blueprint-map-node__port-label">{slot.display_name}</span>
              </span>;
            })}
          </div>
        </section>;
      })}
    </div>
    <InternalL1Continuity width={displayWidth} height={displayHeight} segments={internalL1Segments(projection, selected, data.traceHighlightedConnectionMemberIds, data.wiringHighlightedConnectionMemberIds, displayWidth, data.facePresentation?.hiddenPorts)} />
    </div>
    <div className="blueprint-map-node__cable-zone" aria-hidden="true" />
    <Handle type="source" position={Position.Top} className="device-node__handle" />
  </div>;
  }
  const genericPoints = physical ? genericConnectionPoints(projection) : [];
  return (
    <div className={`device-node${physical ? ` device-node--physical device-node--class-${classPresentation.accent}` : ''}${selected ? ' device-node--selected' : ''}${data.traceHighlighted ? ' device-node--trace-highlighted' : ''}`}>
      <Handle type="target" position={Position.Top} className="device-node__handle" />
      <span className="device-node__kind">
        {physical ? classPresentation.label : projection.kind}
      </span>
      <div className="device-node__identity">
        <strong title={displayNodeLabel(projection)}>{displayNodeLabel(projection)}</strong>
        {faceIndicator}
        {physical && data.locationPresentationPath && <span className="device-node__location" title={data.locationPresentationPath}>{data.locationPresentationPath}</span>}
      </div>
      <span className="device-node__role">
        {physical
          ? `CP: ${String(projection.attributes.connection_point_count ?? '—')} · NI: ${String(projection.attributes.owned_interface_count ?? '—')}`
          : String(projection.attributes.role ?? 'DEVICE')}
      </span>
      <span className="device-node__status"><i /> {projection.status ?? 'UNKNOWN'}</span>
      {genericPoints.map((point, index) => {
        const offset = genericEndpointOffset(index, genericPoints.length);
        const id = point.connection_point_id;
        const state = data.physicalPortStates?.[id];
        const occupied = data.cableOccupiedPortIds?.has(id) ?? false;
        const traced = tracedPorts.has(id);
        const { fill, outline } = physicalPortPaint(undefined, occupied, traced, state);

        return <span key={id} className={`generic-map-node__endpoint${traced ? ' generic-map-node__endpoint--trace-highlighted' : ''}${state ? ` generic-map-node__endpoint--wiring-${state}` : ''}`}
          style={{ top: `${offset * 100}%`, backgroundColor: fill, borderColor: outline }}
          title={`${point.display_name} · внешних подключений: ${point.external_connection_count}`} data-connection-point-id={id} {...portProps(id, point.display_name)}>
          <Handle id={point.connection_point_id} type="source" position={Position.Right} className="generic-map-node__handle" />
          {genericPoints.length <= 8 && <small>{point.display_name}</small>}
        </span>;
      })}
      <Handle type="source" position={Position.Top} className="device-node__handle" />
    </div>
  );
}
