import type { BlueprintPresentation } from './types';

// Presentation-only fallback for legacy MapViewPosition rows. It is deliberately
// independent of Blueprint body's absolute intrinsic/design coordinates.
export const DEFAULT_BLUEPRINT_DISPLAY_WIDTH = 240;
export const MIN_BLUEPRINT_DISPLAY_WIDTH = 96;
export const MAX_BLUEPRINT_DISPLAY_WIDTH = 960;
// Runtime-only composition constants. They deliberately do not belong to the
// immutable Blueprint body or Port Block authoring geometry.
export const BLUEPRINT_NODE_HEADER_HEIGHT = 22;
export const BLUEPRINT_FACE_LABEL_HEIGHT = 18;
export const BLUEPRINT_FACE_GAP = 12;

export type BlueprintFace = 'FRONT' | 'REAR';

export const visibleBlueprintFaces = (
  presentation: Pick<BlueprintPresentation, 'slots'>,
): BlueprintFace[] => {
  const faces = new Set(presentation.slots.map((slot) => slot.face ?? 'FRONT'));
  return (['FRONT', 'REAR'] as const).filter((face) => faces.has(face));
};

export const blueprintDisplayDimensions = (
  body: BlueprintPresentation['body'],
  displayWidth: number | undefined,
) => {
  const width = displayWidth ?? DEFAULT_BLUEPRINT_DISPLAY_WIDTH;
  return { width, height: width * body.height / body.width };
};

export const blueprintNodeDisplayDimensions = (
  presentation: BlueprintPresentation,
  displayWidth: number | undefined,
) => {
  const face = blueprintDisplayDimensions(presentation.body, displayWidth);
  const faces = visibleBlueprintFaces(presentation);
  return {
    width: face.width,
    height: BLUEPRINT_NODE_HEADER_HEIGHT
      + faces.length * (BLUEPRINT_FACE_LABEL_HEIGHT + face.height)
      + Math.max(0, faces.length - 1) * BLUEPRINT_FACE_GAP,
  };
};

export const clampBlueprintDisplayWidth = (width: number) => Math.min(
  MAX_BLUEPRINT_DISPLAY_WIDTH,
  Math.max(MIN_BLUEPRINT_DISPLAY_WIDTH, width),
);
