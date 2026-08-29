import type { BlueprintPresentation } from './types';

// Presentation-only fallback for legacy MapViewPosition rows. It is deliberately
// independent of Blueprint body's absolute intrinsic/design coordinates.
export const DEFAULT_BLUEPRINT_DISPLAY_WIDTH = 240;
export const MAX_BLUEPRINT_DISPLAY_WIDTH = 960;
export const MIN_BLUEPRINT_USABLE_FACE_HEIGHT = 12;
export const MIN_BLUEPRINT_DISPLAY_WIDTH = 32;
export const MAX_MINIMUM_BLUEPRINT_DISPLAY_WIDTH = 240;
export const MIN_BLUEPRINT_PORT_CENTER_SEPARATION = 14;
export const MIN_BLUEPRINT_LABEL_FONT_SIZE = 8;
export const MAX_BLUEPRINT_LABEL_FONT_SIZE = 32;
export const BLUEPRINT_MAP_NAMEPLATE_FACE_HEIGHT_RATIO = 0.12;
export const MIN_BLUEPRINT_MAP_NAMEPLATE_HEIGHT = 14;

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

// This is a card chrome dimension, deliberately derived from the rendered face
// so the React Flow card preserves the Blueprint body's resize aspect ratio.
export const blueprintMapNameplateHeight = (
  presentation: BlueprintPresentation,
  displayWidth: number | undefined,
) => Math.max(
  MIN_BLUEPRINT_MAP_NAMEPLATE_HEIGHT,
  blueprintDisplayDimensions(presentation.body, displayWidth).height * BLUEPRINT_MAP_NAMEPLATE_FACE_HEIGHT_RATIO,
);

export const minimumBlueprintDisplayWidth = (presentation: BlueprintPresentation) => {
  const { body } = presentation;
  const aspectRatio = body.width / body.height;
  const portSeparationWidth = visibleBlueprintFaces(presentation).flatMap((face) => {
    const ports = presentation.slots.filter((slot) => (slot.face ?? 'FRONT') === face);
    return ports.flatMap((port, index) => ports.slice(index + 1).map((other) => {
      const x = port.rendered_position.x - other.rendered_position.x;
      const y = (port.rendered_position.y - other.rendered_position.y) / aspectRatio;
      const normalizedDistance = Math.hypot(x, y);
      return normalizedDistance === 0
        ? MAX_MINIMUM_BLUEPRINT_DISPLAY_WIDTH
        : MIN_BLUEPRINT_PORT_CENTER_SEPARATION / normalizedDistance;
    }));
  });
  return Math.min(
    MAX_MINIMUM_BLUEPRINT_DISPLAY_WIDTH,
    Math.max(MIN_BLUEPRINT_DISPLAY_WIDTH, MIN_BLUEPRINT_USABLE_FACE_HEIGHT * aspectRatio, ...portSeparationWidth),
  );
};

export const clampBlueprintDisplayWidth = (
  width: number,
  presentation?: BlueprintPresentation,
) => Math.min(
  MAX_BLUEPRINT_DISPLAY_WIDTH,
  Math.max(presentation ? minimumBlueprintDisplayWidth(presentation) : MIN_BLUEPRINT_DISPLAY_WIDTH, width),
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
