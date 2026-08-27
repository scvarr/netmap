import type { BlueprintPortBlockPlacement } from '../topology/objectBlueprintTypes';
import type { BlueprintBlockInstance } from './editorModel';

export interface CompositionCanvas { width: number; height: number; }
export interface ScreenRect { left: number; top: number; width: number; height: number; }

export const compositionCanvas = (body: { width: number; height: number }): CompositionCanvas => ({ width: 1000, height: 1000 * body.height / body.width });
export const placementRect = (placement: BlueprintPortBlockPlacement, canvas: CompositionCanvas) => ({ x: placement.x * canvas.width, y: placement.y * canvas.height, width: placement.width * canvas.width, height: placement.height * canvas.height });
export const portCenter = (item: BlueprintBlockInstance, localId: string, placement: BlueprintPortBlockPlacement, canvas: CompositionCanvas) => {
  const port = item.ports.find((value) => value.local_id === localId); if (!port) return undefined;
  const columns = Math.max(...item.ports.filter((value) => value.row === port.row).map((value) => value.column), 1);
  const rows = Math.max(...item.ports.map((value) => value.row), 1); const rect = placementRect(placement, canvas);
  return { x: rect.x + rect.width * (port.column - .5) / columns, y: rect.y + rect.height * (port.row - .5) / rows };
};
/** Converts screen coordinates through preserveAspectRatio's centred meet viewport. */
export const screenToPlacementPoint = (clientX: number, clientY: number, rect: ScreenRect, canvas: CompositionCanvas) => {
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const renderedWidth = canvas.width * scale; const renderedHeight = canvas.height * scale;
  const left = rect.left + (rect.width - renderedWidth) / 2; const top = rect.top + (rect.height - renderedHeight) / 2;
  return { x: (clientX - left) / renderedWidth, y: (clientY - top) / renderedHeight };
};
