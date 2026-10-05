import type { PresentationPanel } from './baseTemplateTypes';

export interface BlueprintThumbnailGeometry {
  originX: number;
  originY: number;
  intrinsicWidth: number;
  intrinsicHeight: number;
  width: number;
  height: number;
  scale: number;
}

export const blueprintThumbnailGeometry = (
  panels: readonly PresentationPanel[],
  viewport: { width: number; height: number },
): BlueprintThumbnailGeometry => {
  const originX = Math.min(...panels.map((panel) => panel.x));
  const originY = Math.min(...panels.map((panel) => panel.y));
  const intrinsicWidth = Math.max(...panels.map((panel) => panel.x + panel.width)) - originX;
  const intrinsicHeight = Math.max(...panels.map((panel) => panel.y + panel.height)) - originY;
  const scale = Math.min(viewport.width / intrinsicWidth, viewport.height / intrinsicHeight);
  return { originX, originY, intrinsicWidth, intrinsicHeight, width: intrinsicWidth * scale, height: intrinsicHeight * scale, scale };
};
