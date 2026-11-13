import type { BlueprintPresentation } from './types';

// Presentation-only fallback for legacy MapViewPosition rows. It is deliberately
// independent of Blueprint body's absolute intrinsic/design coordinates.
export const DEFAULT_BLUEPRINT_DISPLAY_WIDTH = 240;
export const MAX_BLUEPRINT_DISPLAY_WIDTH = 960;
export const MIN_BLUEPRINT_USABLE_PANEL_HEIGHT = 12;
export const MIN_BLUEPRINT_DISPLAY_WIDTH = 32;
export const BLUEPRINT_PORT_SIZE = 6;
export const BLUEPRINT_PORT_STROKE = 0.5;
export const BLUEPRINT_PORT_HIT_SIZE = 8;
export const MIN_BLUEPRINT_PORT_CENTER_SEPARATION = BLUEPRINT_PORT_HIT_SIZE + 2;
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
  const minimum = minimumBlueprintDisplayWidth(presentation);
  if (minimum > MAX_BLUEPRINT_DISPLAY_WIDTH) throw new Error('map.portGeometryUnsupported');
  const width = Math.max(displayWidth ?? DEFAULT_BLUEPRINT_DISPLAY_WIDTH, minimum);
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
  blueprintNodeDisplayDimensions(presentation, displayWidth).width * Math.min(...presentation.panels.map((panel) => panel.height)) / panelCompositionBounds(presentation.panels).width * BLUEPRINT_MAP_NAMEPLATE_HEIGHT_RATIO,
);

export const minimumBlueprintDisplayWidth = (presentation: BlueprintPresentation) => {
  const bounds = panelCompositionBounds(presentation.panels);
  // Use the pinned panel-local centres, including panel offsets and gaps.
  const centres = presentation.slots.map(port => {
    const panel = presentation.panels.find(panel => panel.panel_key === port.panel_key)!;
    return { x: panel.x + panel.width * port.panel_local_position.x,
      y: panel.y + panel.height * port.panel_local_position.y };
  });
  let minimum = Math.max(MIN_BLUEPRINT_DISPLAY_WIDTH,
    ...presentation.panels.map(panel => MIN_BLUEPRINT_USABLE_PANEL_HEIGHT * bounds.width / panel.height));
  centres.forEach((port, index) => centres.slice(index + 1).forEach(other => {
    // Axis-aligned hit squares must have a gap, even for diagonal neighbours.
    const distance = Math.max(Math.abs(port.x - other.x), Math.abs(port.y - other.y));
    if (distance === 0) throw new Error('map.portGeometryCoincident');
    minimum = Math.max(minimum, MIN_BLUEPRINT_PORT_CENTER_SEPARATION * bounds.width / distance);
  }));
  // No upper clamp: an unrepresentable template must not silently overlap.
  return minimum;
};

export const clampBlueprintDisplayWidth = (
  width: number,
  presentation?: BlueprintPresentation,
) => {
  const minimum = presentation ? minimumBlueprintDisplayWidth(presentation) : MIN_BLUEPRINT_DISPLAY_WIDTH;
  if (minimum > MAX_BLUEPRINT_DISPLAY_WIDTH) throw new Error('map.portGeometryUnsupported');
  return Math.min(MAX_BLUEPRINT_DISPLAY_WIDTH, Math.max(minimum, width));
};

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

/** Complete rendered card: pinned panel composition plus object nameplate. */
export const blueprintRenderedNodeDimensions = (presentation: BlueprintPresentation, displayWidth: number | undefined) => {
  const body = blueprintNodeDisplayDimensions(presentation, displayWidth);
  return { width: body.width, height: body.height + blueprintMapNameplateHeight(presentation, displayWidth) };
};
