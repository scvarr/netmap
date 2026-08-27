import type { BlueprintPresentation } from './types';

// Presentation-only fallback for legacy MapViewPosition rows. It is deliberately
// independent of Blueprint body's absolute intrinsic/design coordinates.
export const DEFAULT_BLUEPRINT_DISPLAY_WIDTH = 240;
export const MIN_BLUEPRINT_DISPLAY_WIDTH = 96;
export const MAX_BLUEPRINT_DISPLAY_WIDTH = 960;

export const blueprintDisplayDimensions = (
  body: BlueprintPresentation['body'],
  displayWidth: number | undefined,
) => {
  const width = displayWidth ?? DEFAULT_BLUEPRINT_DISPLAY_WIDTH;
  return { width, height: width * body.height / body.width };
};

export const clampBlueprintDisplayWidth = (width: number) => Math.min(
  MAX_BLUEPRINT_DISPLAY_WIDTH,
  Math.max(MIN_BLUEPRINT_DISPLAY_WIDTH, width),
);
