import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import type { DeviceNodeData } from '../topology/layout';
import { displayNodeLabel, physicalClassPresentation } from '../topology/presentation';
import { genericConnectionPoints, genericEndpointOffset } from '../topology/genericEndpointPresentation';
import { internalL1Segments } from '../topology/internalL1Presentation';
import { InternalL1Continuity } from './InternalL1Continuity';
import { blueprintDisplayDimensions, blueprintMapNameplateHeight, blueprintNodeDisplayDimensions, minimumBlueprintDisplayWidth, visibleBlueprintFaces } from '../topology/blueprintDisplaySize';

type DeviceFlowNode = Node<DeviceNodeData, 'device'>;

export function DeviceNode({ data, selected, width }: NodeProps<DeviceFlowNode>) {
  const { projection } = data;
  const physical = projection.kind === 'PHYSICAL_OBJECT';
  const classPresentation = physicalClassPresentation(projection.attributes.class);
  const blueprint = projection.attributes.blueprint_presentation;
  const objectId = projection.source_refs.find((ref) => ref.ref_type === 'CANONICAL_FACT' && ref.entity_type === 'PhysicalObject')?.entity_id;
  const portProps = (connectionPointId: string, label: string) => {
    const state = data.physicalPortStates?.[connectionPointId];
    return { role: 'button' as const, tabIndex: state === 'unavailable' ? -1 : 0, 'aria-label': `Порт ${label}`, 'aria-disabled': state === 'unavailable' || undefined, onClick: (event: React.MouseEvent) => { event.stopPropagation(); if (state !== 'unavailable' && objectId) data.onPhysicalPortClick?.({ physicalObjectId: objectId, connectionPointId, label }); }, onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); if (objectId) data.onPhysicalPortContextMenu?.({ physicalObjectId: objectId, connectionPointId, label }, { x: event.clientX, y: event.clientY }); }, onKeyDown: (event: React.KeyboardEvent) => { if ((event.key === 'Enter' || event.key === ' ') && state !== 'unavailable' && objectId) { event.preventDefault(); data.onPhysicalPortClick?.({ physicalObjectId: objectId, connectionPointId, label }); } } };
  };
  if (physical && blueprint) {
    const displayWidth = width ?? blueprintNodeDisplayDimensions(blueprint, undefined).width;
    const displayHeight = blueprintNodeDisplayDimensions(blueprint, displayWidth).height;
    const nameplateHeight = blueprintMapNameplateHeight(blueprint, displayWidth);
    const faceDimensions = blueprintDisplayDimensions(blueprint.body, displayWidth);
    const faces = visibleBlueprintFaces(blueprint);
    const traceHighlightedConnectionPointIds = new Set(
      (projection.attributes.internal_l1_links ?? [])
        .filter((link) => data.traceHighlightedConnectionMemberIds?.has(link.connection_member_id))
        .flatMap((link) => [link.from_connection_point_id, link.to_connection_point_id]),
    );
    return <div data-testid="blueprint-map-node" className={`blueprint-map-node${selected ? ' blueprint-map-node--selected' : ''}${data.compositeMemberSelected ? ' blueprint-map-node--composite-member-selected' : ''}${data.traceHighlighted ? ' blueprint-map-node--trace-highlighted' : ''}${data.locationFocus === 'match' ? ' blueprint-map-node--location-focus' : ''}${data.locationFocus === 'dim' ? ' blueprint-map-node--location-dim' : ''}`} style={{ width: displayWidth, height: displayHeight + nameplateHeight, gridTemplateRows: `${nameplateHeight}px ${displayHeight}px` }}>
    <NodeResizer
      isVisible={Boolean(selected && data.blueprintResizeEnabled)}
      minWidth={minimumBlueprintDisplayWidth(blueprint)}
      maxWidth={960}
      minHeight={blueprintNodeDisplayDimensions(blueprint, minimumBlueprintDisplayWidth(blueprint)).height + blueprintMapNameplateHeight(blueprint, minimumBlueprintDisplayWidth(blueprint))}
      maxHeight={blueprintNodeDisplayDimensions(blueprint, 960).height + blueprintMapNameplateHeight(blueprint, 960)}
      keepAspectRatio
      lineClassName="blueprint-map-node__resizer-line"
      handleClassName="blueprint-map-node__resizer-handle"
      onResizeEnd={(_, dimensions) => { if (objectId) data.onBlueprintDisplayResize?.(objectId, dimensions.width); }}
    />
    <Handle type="target" position={Position.Top} className="device-node__handle" />
    <strong className="blueprint-map-node__nameplate" style={{ height: nameplateHeight }} title={displayNodeLabel(projection)}>{displayNodeLabel(projection)}</strong>
    <div className="blueprint-map-node__body" style={{ height: displayHeight }}>
    <div className="blueprint-map-node__panels">
      {faces.map((face) => {
        return <section key={face} className="blueprint-map-node__face" data-testid={`blueprint-face-${face}`}>
          <div className="blueprint-map-node__face-surface" style={{ height: faceDimensions.height, background: blueprint.body.fill_color ?? '#18383a' }}>
            {blueprint.slots.filter((slot) => (slot.face ?? 'FRONT') === face).map((slot) => { const style = { left: `${slot.rendered_position.x * 100}%`, top: `${slot.rendered_position.y * 100}%`, transform: 'translate(-50%, -50%)' }; const state = data.physicalPortStates?.[slot.connection_point_id]; return <span key={slot.connection_point_id} className={`blueprint-map-node__port blueprint-map-node__port--${slot.kind.toLowerCase()}${traceHighlightedConnectionPointIds.has(slot.connection_point_id) ? ' blueprint-map-node__port--trace-highlighted' : ''}${data.wiringContinuationConnectionPointIds?.has(slot.connection_point_id) ? ' blueprint-map-node__port--wiring-continuation' : ''}${state ? ` blueprint-map-node__port--wiring-${state}` : ''}`} style={style} data-connection-point-id={slot.connection_point_id} title={`${slot.display_name} · ${slot.kind}`} {...portProps(slot.connection_point_id, slot.display_name)} />; })}
          </div>
        </section>;
      })}
    </div>
    <InternalL1Continuity width={displayWidth} height={displayHeight} segments={internalL1Segments(projection, selected, data.traceHighlightedConnectionMemberIds, data.wiringHighlightedConnectionMemberIds, displayWidth)} />
    </div>
    <Handle type="source" position={Position.Top} className="device-node__handle" />
  </div>;
  }
  const genericPoints = physical ? genericConnectionPoints(projection) : [];
  return (
    <div className={`device-node${physical ? ` device-node--physical device-node--class-${classPresentation.accent}` : ''}${selected ? ' device-node--selected' : ''}${data.compositeMemberSelected ? ' device-node--composite-member-selected' : ''}${data.traceHighlighted ? ' device-node--trace-highlighted' : ''}${data.locationFocus === 'match' ? ' device-node--location-focus' : ''}${data.locationFocus === 'dim' ? ' device-node--location-dim' : ''}`}>
      <Handle type="target" position={Position.Top} className="device-node__handle" />
      <span className="device-node__kind">
        {physical ? classPresentation.label : projection.kind}
      </span>
      <strong>{displayNodeLabel(projection)}</strong>
      <span className="device-node__role">
        {physical
          ? `CP: ${String(projection.attributes.connection_point_count ?? '—')} · NI: ${String(projection.attributes.owned_interface_count ?? '—')}`
          : String(projection.attributes.role ?? 'DEVICE')}
      </span>
      <span className="device-node__status"><i /> {projection.status ?? 'UNKNOWN'}</span>
      {genericPoints.map((point, index) => {
        const offset = genericEndpointOffset(index, genericPoints.length);
        const state = data.physicalPortStates?.[point.connection_point_id];
        return <span key={point.connection_point_id} className={`generic-map-node__endpoint${state ? ` generic-map-node__endpoint--wiring-${state}` : ''}`} style={{ top: `${offset * 100}%` }} title={`${point.display_name} · внешних подключений: ${point.external_connection_count}`} data-connection-point-id={point.connection_point_id} {...portProps(point.connection_point_id, point.display_name)}>
          <Handle id={point.connection_point_id} type="source" position={Position.Right} className="generic-map-node__handle" />
          {genericPoints.length <= 8 && <small>{point.display_name}</small>}
        </span>;
      })}
      <Handle type="source" position={Position.Top} className="device-node__handle" />
    </div>
  );
}
