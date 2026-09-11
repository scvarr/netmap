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
  angleFamilies = [{ step: ANGLE_STEP_DEGREES, capturePx }],
}: {
  anchor: XYPosition;
  pointerScreen: ScreenPosition;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  screenToFlowPosition: (point: ScreenPosition) => XYPosition;
  flowToScreenPosition: (point: XYPosition) => ScreenPosition;
  capturePx?: number;
  angleFamilies?: readonly { step: number; capturePx: number }[];
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

  const targetLength = Math.max(LENGTH_STEP, Math.round(rawLength / LENGTH_STEP) * LENGTH_STEP);
  const lengthPoint = pointAt(anchor, rawAngle, targetLength);
  const angularCandidate = !shiftKey
    ? angleFamilies
      .map((family) => {
        const angle = Math.round(rawAngle / family.step) * family.step % 360;
        const point = pointAt(anchor, angle, rawLength);
        return { point, distance: screenDistance(constrainedScreen, flowToScreenPosition(point)), capturePx: family.capturePx };
      })
      .find((candidate) => candidate.distance <= candidate.capturePx)
    : undefined;
  const anglePoint = angularCandidate?.point;
  const combinedPoint = anglePoint && pointAt(anchor, segmentAngle(anchor, anglePoint), targetLength);
  const anglePlausible = Boolean(anglePoint);
  const lengthPlausible = screenDistance(constrainedScreen, flowToScreenPosition(lengthPoint)) <= capturePx;
  const combinedPlausible = Boolean(combinedPoint) && anglePlausible && lengthPlausible && screenDistance(constrainedScreen, flowToScreenPosition(combinedPoint!)) <= capturePx;

  const point = combinedPlausible ? combinedPoint! : anglePlausible ? anglePoint! : lengthPlausible ? lengthPoint : rawPoint;
  const snappedAngle = combinedPlausible || anglePlausible;
  const snappedLength = combinedPlausible || (!anglePlausible && lengthPlausible);
  return { point, angle: segmentAngle(anchor, point), length: segmentLength(anchor, point), snappedAngle, snappedLength };
};
