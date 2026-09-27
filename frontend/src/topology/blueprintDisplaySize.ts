import type { BlueprintPresentation } from './types';

// Presentation-only fallback for legacy MapViewPosition rows. It is deliberately
// independent of Blueprint body's absolute intrinsic/design coordinates.
export const DEFAULT_BLUEPRINT_DISPLAY_WIDTH = 240;
export const MAX_BLUEPRINT_DISPLAY_WIDTH = 960;
export const MIN_BLUEPRINT_USABLE_PANEL_HEIGHT = 12;
export const MIN_BLUEPRINT_DISPLAY_WIDTH = 32;
export const MAX_MINIMUM_BLUEPRINT_DISPLAY_WIDTH = 240;
export const MIN_BLUEPRINT_PORT_CENTER_SEPARATION = 14;
export const MIN_BLUEPRINT_LABEL_FONT_SIZE = 8;
export const MAX_BLUEPRINT_LABEL_FONT_SIZE = 32;
export const BLUEPRINT_MAP_NAMEPLATE_HEIGHT_RATIO = 0.12;
export const MIN_BLUEPRINT_MAP_NAMEPLATE_HEIGHT = 14;

export const panelCompositionBounds = (panels: BlueprintPresentation['panels']) => {
  const x = Math.min(...panels.map((panel) => panel.x));
  const y = Math.min(...panels.map((panel) => panel.y));
  return { x, y, width: Math.max(...panels.map((panel) => panel.x + panel.width)) - x, height: Math.max(...panels.map((panel) => panel.y + panel.height)) - y };
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
  const bounds = panelCompositionBounds(presentation.panels);
  const width = displayWidth ?? DEFAULT_BLUEPRINT_DISPLAY_WIDTH;
  return {
    width,
    height: width * bounds.height / bounds.width,
  };
};

// This is a card chrome dimension, deliberately derived from the composition
// so the React Flow card preserves the Blueprint body's resize aspect ratio.
export const blueprintMapNameplateHeight = (
  presentation: BlueprintPresentation,
  displayWidth: number | undefined,
) => Math.max(
  MIN_BLUEPRINT_MAP_NAMEPLATE_HEIGHT,
  (displayWidth ?? DEFAULT_BLUEPRINT_DISPLAY_WIDTH) * Math.min(...presentation.panels.map((panel) => panel.height)) / panelCompositionBounds(presentation.panels).width * BLUEPRINT_MAP_NAMEPLATE_HEIGHT_RATIO,
);

export const minimumBlueprintDisplayWidth = (presentation: BlueprintPresentation) => {
  const bounds = panelCompositionBounds(presentation.panels);
  const aspectRatio = bounds.width / bounds.height;
  const portSeparationWidth = presentation.slots.flatMap((port, index) => presentation.slots.slice(index + 1).map((other) => {
      const x = port.rendered_position.x - other.rendered_position.x;
      const y = (port.rendered_position.y - other.rendered_position.y) / aspectRatio;
      const normalizedDistance = Math.hypot(x, y);
      return normalizedDistance === 0
        ? MAX_MINIMUM_BLUEPRINT_DISPLAY_WIDTH
        : MIN_BLUEPRINT_PORT_CENTER_SEPARATION / normalizedDistance;
    }));
  return Math.min(
    MAX_MINIMUM_BLUEPRINT_DISPLAY_WIDTH,
    Math.max(MIN_BLUEPRINT_DISPLAY_WIDTH, MIN_BLUEPRINT_USABLE_PANEL_HEIGHT * aspectRatio, ...portSeparationWidth),
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
  const dimensions = blueprintDisplayDimensions(body, displayWidth);
  return Math.min(
    MAX_BLUEPRINT_LABEL_FONT_SIZE,
    Math.max(MIN_BLUEPRINT_LABEL_FONT_SIZE, Math.min(dimensions.width * 0.075, dimensions.height * 0.6)),
  );
};
