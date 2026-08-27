import type { BlueprintPresentation } from './types';

// Presentation-only fallback for legacy MapViewPosition rows. It is deliberately
// independent of Blueprint body's absolute intrinsic/design coordinates.
export const DEFAULT_BLUEPRINT_DISPLAY_WIDTH = 240;
export const MAX_BLUEPRINT_DISPLAY_WIDTH = 960;
export const MIN_BLUEPRINT_USABLE_FACE_HEIGHT = 18;
export const MIN_BLUEPRINT_DISPLAY_WIDTH = 64;
export const MAX_MINIMUM_BLUEPRINT_DISPLAY_WIDTH = 240;
export const MIN_BLUEPRINT_LABEL_FONT_SIZE = 8;
export const MAX_BLUEPRINT_LABEL_FONT_SIZE = 32;

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
    height: faces.length * face.height,
  };
};

export const minimumBlueprintDisplayWidth = (body: BlueprintPresentation['body']) => Math.min(
  MAX_MINIMUM_BLUEPRINT_DISPLAY_WIDTH,
  Math.max(MIN_BLUEPRINT_DISPLAY_WIDTH, MIN_BLUEPRINT_USABLE_FACE_HEIGHT * body.width / body.height),
);

export const clampBlueprintDisplayWidth = (
  width: number,
  body?: BlueprintPresentation['body'],
) => Math.min(
  MAX_BLUEPRINT_DISPLAY_WIDTH,
  Math.max(body ? minimumBlueprintDisplayWidth(body) : MIN_BLUEPRINT_DISPLAY_WIDTH, width),
);

export const blueprintObjectLabelFontSize = (
  body: BlueprintPresentation['body'],
  displayWidth: number | undefined,
) => {
  const face = blueprintDisplayDimensions(body, displayWidth);
  return Math.min(
    MAX_BLUEPRINT_LABEL_FONT_SIZE,
    Math.max(MIN_BLUEPRINT_LABEL_FONT_SIZE, Math.min(face.width * 0.075, face.height * 0.6)),
  );
};
