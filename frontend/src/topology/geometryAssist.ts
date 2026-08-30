import type { XYPosition } from '@xyflow/react';

export interface ScreenPosition { x: number; y: number; }
export interface SegmentAssistResult {
  point: XYPosition;
  angle: number;
  length: number;
  snappedAngle: boolean;
  snappedLength: boolean;
}

const ANGLE_STEP_DEGREES = 10;
const LENGTH_STEP = 10;
export const GEOMETRY_ASSIST_CAPTURE_PX = 4;

export const segmentLength = (start: XYPosition, end: XYPosition) => Math.hypot(end.x - start.x, end.y - start.y);

/** Canvas direction in degrees, clockwise from its positive X axis. */
export const segmentAngle = (start: XYPosition, end: XYPosition) => {
  const degrees = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
  return (degrees + 360) % 360;
};

const pointAt = (anchor: XYPosition, angle: number, length: number): XYPosition => {
  const radians = angle * Math.PI / 180;
  return { x: anchor.x + Math.cos(radians) * length, y: anchor.y + Math.sin(radians) * length };
};

const screenDistance = (left: ScreenPosition, right: ScreenPosition) => Math.hypot(left.x - right.x, left.y - right.y);

/**
 * Computes transient magnetic assistance for any directed schematic segment.
 * Capture is intentionally evaluated in screen space so its perceived strength
 * stays stable while a canvas is zoomed.
 */
export const assistSegment = ({
  anchor,
  pointerScreen,
  shiftKey = false,
  ctrlKey = false,
  screenToFlowPosition,
  flowToScreenPosition,
  capturePx = GEOMETRY_ASSIST_CAPTURE_PX,
}: {
  anchor: XYPosition;
  pointerScreen: ScreenPosition;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  screenToFlowPosition: (point: ScreenPosition) => XYPosition;
  flowToScreenPosition: (point: XYPosition) => ScreenPosition;
  capturePx?: number;
}): SegmentAssistResult => {
  const anchorScreen = flowToScreenPosition(anchor);
  const constrainedScreen = shiftKey
    ? Math.abs(pointerScreen.x - anchorScreen.x) >= Math.abs(pointerScreen.y - anchorScreen.y)
      ? { x: pointerScreen.x, y: anchorScreen.y }
      : { x: anchorScreen.x, y: pointerScreen.y }
    : pointerScreen;
  const rawPoint = screenToFlowPosition(constrainedScreen);
  const rawAngle = segmentAngle(anchor, rawPoint);
  const rawLength = segmentLength(anchor, rawPoint);
  if (ctrlKey || rawLength === 0) return { point: rawPoint, angle: rawAngle, length: rawLength, snappedAngle: false, snappedLength: false };

  const targetAngle = Math.round(rawAngle / ANGLE_STEP_DEGREES) * ANGLE_STEP_DEGREES % 360;
  const targetLength = Math.round(rawLength / LENGTH_STEP) * LENGTH_STEP;
  const anglePoint = pointAt(anchor, targetAngle, rawLength);
  const lengthPoint = pointAt(anchor, rawAngle, targetLength);
  const combinedPoint = pointAt(anchor, targetAngle, targetLength);
  const anglePlausible = !shiftKey && screenDistance(constrainedScreen, flowToScreenPosition(anglePoint)) <= capturePx;
  const lengthPlausible = screenDistance(constrainedScreen, flowToScreenPosition(lengthPoint)) <= capturePx;
  const combinedPlausible = anglePlausible && lengthPlausible && screenDistance(constrainedScreen, flowToScreenPosition(combinedPoint)) <= capturePx;

  const point = combinedPlausible ? combinedPoint : anglePlausible ? anglePoint : lengthPlausible ? lengthPoint : rawPoint;
  const snappedAngle = combinedPlausible || anglePlausible;
  const snappedLength = combinedPlausible || (!anglePlausible && lengthPlausible);
  return { point, angle: segmentAngle(anchor, point), length: segmentLength(anchor, point), snappedAngle, snappedLength };
};
