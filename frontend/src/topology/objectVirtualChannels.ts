import type { XYPosition } from '@xyflow/react';
import { blueprintNodeDisplayDimensions, OBJECT_NAME_ZONE_WIDTH, OBJECT_SIDE_ZONES_WIDTH } from './blueprintDisplaySize';
import type { BlueprintPresentation } from './types';

export const OBJECT_CHANNEL_RAIL_OFFSET = 8;
// Leave room beyond the centreline for highlighted strokes.
export const OBJECT_CHANNEL_GRID_INSET = OBJECT_CHANNEL_RAIL_OFFSET + 4;

export interface VirtualChannelSegment {
  readonly from: XYPosition;
  readonly to: XYPosition;
  readonly next: VirtualChannelSegment | null;
}

export interface ObjectVirtualChannels {
  readonly exit: XYPosition;
  readonly segments: readonly VirtualChannelSegment[];
  readonly paths: ReadonlyMap<string, VirtualChannelSegment>;
}

export function objectVirtualChannelExit(body: { width: number; height: number }, frameWidth: number): XYPosition {
  return { x: Math.max(frameWidth, body.width + OBJECT_SIDE_ZONES_WIDTH), y: body.height / 2 };
}

/** Object-local directed segments. A port points to its first segment and every
 * shared suffix is represented once. The keys are physical ConnectionPoint IDs. */
export function objectVirtualChannels(
  presentation: BlueprintPresentation,
  compositionDisplayWidth: number | undefined,
  frameWidth: number,
): ObjectVirtualChannels {
  const body = blueprintNodeDisplayDimensions(presentation, compositionDisplayWidth);
  const exit = objectVirtualChannelExit(body, frameWidth);
  const junction = { x: exit.x - OBJECT_CHANNEL_RAIL_OFFSET, y: exit.y };
  const segments: VirtualChannelSegment[] = [];
  const paths = new Map<string, VirtualChannelSegment>();
  const add = (from: XYPosition, to: XYPosition, next: VirtualChannelSegment | null) => {
    const segment = { from, to, next };
    segments.push(segment);
    return segment;
  };
  const ports = presentation.slots.map(slot => ({
    id: slot.connection_point_id,
    x: OBJECT_NAME_ZONE_WIDTH + body.width * slot.rendered_position.x,
    y: body.height * slot.rendered_position.y,
  }));
  if (!ports.length) return { exit, segments, paths };
  const outlet = add(junction, exit, null);
  for (const top of [true, false]) {
    const side = ports.filter(port => (port.y <= exit.y) === top);
    if (!side.length) continue;
    const railY = top ? -OBJECT_CHANNEL_RAIL_OFFSET : body.height + OBJECT_CHANNEL_RAIL_OFFSET;
    let railPoint = { x: junction.x, y: railY };
    let rail = add(railPoint, junction, outlet);
    const leadByX = new Map<number, VirtualChannelSegment>();
    // Start at the spine, then extend the rail and each lead away from it.
    side.sort((a, b) => b.x - a.x || (top ? a.y - b.y : b.y - a.y));
    for (const { id, x, y } of side) {
      if (x !== railPoint.x) {
        const tap = { x, y: railY };
        rail = add(tap, railPoint, rail);
        railPoint = tap;
      }
      const lead = leadByX.get(x) ?? rail;
      const attach = lead === rail ? railPoint : lead.from;
      const first = y === attach.y ? lead : add({ x, y }, attach, lead);
      leadByX.set(x, first);
      paths.set(id, first);
    }
  }
  return { exit, segments, paths };
}
