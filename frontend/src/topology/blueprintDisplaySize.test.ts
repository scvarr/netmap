import { describe, expect, it } from 'vitest';
import { DEFAULT_BLUEPRINT_DISPLAY_WIDTH, MAX_BLUEPRINT_LABEL_FONT_SIZE, MIN_BLUEPRINT_LABEL_FONT_SIZE, blueprintDisplayDimensions, blueprintNodeDisplayDimensions, blueprintObjectLabelFontSize, clampBlueprintDisplayWidth, minimumBlueprintDisplayWidth, visibleBlueprintFaces } from './blueprintDisplaySize';

describe('Blueprint Saved Map display dimensions', () => {
  it('uses the deterministic width for historical positions and derives height from intrinsic aspect ratio', () => {
    expect(blueprintDisplayDimensions({ kind: 'RECTANGLE', width: 480, height: 60 }, undefined)).toEqual({ width: DEFAULT_BLUEPRINT_DISPLAY_WIDTH, height: 30 });
  });
  it('gives equivalent intrinsic ratios the same runtime dimensions at one display width', () => {
    expect(blueprintDisplayDimensions({ kind: 'RECTANGLE', width: 480, height: 60 }, 320)).toEqual(blueprintDisplayDimensions({ kind: 'RECTANGLE', width: 8, height: 1 }, 320));
  });
  it('derives the resize minimum from a bounded usable face height', () => {
    expect(minimumBlueprintDisplayWidth({ kind: 'RECTANGLE', width: 8, height: 1 })).toBe(144);
    expect(clampBlueprintDisplayWidth(20, { kind: 'RECTANGLE', width: 8, height: 1 })).toBe(144);
    expect(clampBlueprintDisplayWidth(2000)).toBe(960);
  });
  it('derives visible faces from slots, treating historical missing face as FRONT', () => {
    expect(visibleBlueprintFaces({ slots: [{ face: undefined }, { face: 'REAR' }] } as any)).toEqual(['FRONT', 'REAR']);
    expect(visibleBlueprintFaces({ slots: [{ face: 'REAR' }] } as any)).toEqual(['REAR']);
  });
  it('uses only compact body geometry for one and two visible faces', () => {
    const presentation = { body: { kind: 'RECTANGLE' as const, width: 8, height: 1 }, slots: [{ face: 'FRONT' }, { face: 'REAR' }] } as any;
    expect(blueprintNodeDisplayDimensions({ ...presentation, slots: [{ face: 'FRONT' }] }, 320)).toEqual({ width: 320, height: 40 });
    expect(blueprintNodeDisplayDimensions(presentation, 320)).toEqual({ width: 320, height: 80 });
  });
  it('keeps equivalent intrinsic ratios equivalent for two-face runtime geometry', () => {
    const faces = [{ face: 'FRONT' }, { face: 'REAR' }];
    expect(blueprintNodeDisplayDimensions({ body: { kind: 'RECTANGLE', width: 480, height: 60 }, slots: faces } as any, 320))
      .toEqual(blueprintNodeDisplayDimensions({ body: { kind: 'RECTANGLE', width: 8, height: 1 }, slots: faces } as any, 320));
  });
  it('scales the overlay label with presentation geometry and bounds it by face height', () => {
    const body = { kind: 'RECTANGLE' as const, width: 8, height: 1 };
    expect(blueprintObjectLabelFontSize(body, 160)).toBeLessThan(blueprintObjectLabelFontSize(body, 320));
    expect(blueprintObjectLabelFontSize(body, 960)).toBeLessThanOrEqual(MAX_BLUEPRINT_LABEL_FONT_SIZE);
    expect(blueprintObjectLabelFontSize({ kind: 'RECTANGLE', width: 100, height: 1 }, 64)).toBe(MIN_BLUEPRINT_LABEL_FONT_SIZE);
  });
});
