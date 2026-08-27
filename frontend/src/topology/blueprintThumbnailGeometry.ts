import type { BlueprintBody, BlueprintSlot } from './objectBlueprintTypes';

export type BlueprintThumbnailFace = 'FRONT' | 'REAR';

export interface BlueprintThumbnailGeometry {
  faces: BlueprintThumbnailFace[];
  intrinsicWidth: number;
  intrinsicHeight: number;
  width: number;
  height: number;
  scale: number;
}

export const visibleBlueprintThumbnailFaces = (slots: readonly Pick<BlueprintSlot, 'face'>[]): BlueprintThumbnailFace[] => {
  const faces = new Set(slots.map((slot) => slot.face ?? 'FRONT'));
  return faces.size === 0 ? ['FRONT'] : (['FRONT', 'REAR'] as const).filter((face) => faces.has(face));
};

export const blueprintThumbnailGeometry = (
  body: Pick<BlueprintBody, 'width' | 'height'>,
  slots: readonly Pick<BlueprintSlot, 'face'>[],
  viewport: { width: number; height: number },
): BlueprintThumbnailGeometry => {
  const faces = visibleBlueprintThumbnailFaces(slots);
  const intrinsicWidth = body.width;
  const intrinsicHeight = body.height * faces.length;
  const scale = Math.min(viewport.width / intrinsicWidth, viewport.height / intrinsicHeight);
  return { faces, intrinsicWidth, intrinsicHeight, width: intrinsicWidth * scale, height: intrinsicHeight * scale, scale };
};
