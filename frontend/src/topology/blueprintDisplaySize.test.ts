import { describe, expect, it } from 'vitest';
import { BLUEPRINT_FACE_GAP, BLUEPRINT_FACE_LABEL_HEIGHT, BLUEPRINT_NODE_HEADER_HEIGHT, DEFAULT_BLUEPRINT_DISPLAY_WIDTH, blueprintDisplayDimensions, blueprintNodeDisplayDimensions, clampBlueprintDisplayWidth, visibleBlueprintFaces } from './blueprintDisplaySize';

describe('Blueprint Saved Map display dimensions', () => {
  it('uses the deterministic width for historical positions and derives height from intrinsic aspect ratio', () => {
    expect(blueprintDisplayDimensions({ kind: 'RECTANGLE', width: 480, height: 60 }, undefined)).toEqual({ width: DEFAULT_BLUEPRINT_DISPLAY_WIDTH, height: 30 });
  });
  it('gives equivalent intrinsic ratios the same runtime dimensions at one display width', () => {
    expect(blueprintDisplayDimensions({ kind: 'RECTANGLE', width: 480, height: 60 }, 320)).toEqual(blueprintDisplayDimensions({ kind: 'RECTANGLE', width: 8, height: 1 }, 320));
  });
  it('keeps resize width within usable presentation bounds', () => {
    expect(clampBlueprintDisplayWidth(20)).toBe(96);
    expect(clampBlueprintDisplayWidth(2000)).toBe(960);
  });
  it('derives visible faces from slots, treating historical missing face as FRONT', () => {
    expect(visibleBlueprintFaces({ slots: [{ face: undefined }, { face: 'REAR' }] } as any)).toEqual(['FRONT', 'REAR']);
    expect(visibleBlueprintFaces({ slots: [{ face: 'REAR' }] } as any)).toEqual(['REAR']);
  });
  it('includes both face panels and deterministic presentation gap in the node footprint', () => {
    const presentation = { body: { kind: 'RECTANGLE' as const, width: 8, height: 1 }, slots: [{ face: 'FRONT' }, { face: 'REAR' }] } as any;
    expect(blueprintNodeDisplayDimensions(presentation, 320)).toEqual({ width: 320, height: BLUEPRINT_NODE_HEADER_HEIGHT + 2 * (BLUEPRINT_FACE_LABEL_HEIGHT + 40) + BLUEPRINT_FACE_GAP });
  });
  it('keeps equivalent intrinsic ratios equivalent for two-face runtime geometry', () => {
    const faces = [{ face: 'FRONT' }, { face: 'REAR' }];
    expect(blueprintNodeDisplayDimensions({ body: { kind: 'RECTANGLE', width: 480, height: 60 }, slots: faces } as any, 320))
      .toEqual(blueprintNodeDisplayDimensions({ body: { kind: 'RECTANGLE', width: 8, height: 1 }, slots: faces } as any, 320));
  });
});
