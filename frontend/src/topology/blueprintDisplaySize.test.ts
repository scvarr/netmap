import { describe, expect, it } from 'vitest';
import { DEFAULT_BLUEPRINT_DISPLAY_WIDTH, blueprintDisplayDimensions, clampBlueprintDisplayWidth } from './blueprintDisplaySize';

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
});
