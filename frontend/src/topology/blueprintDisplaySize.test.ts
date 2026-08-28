import { describe, expect, it } from 'vitest';
import { DEFAULT_BLUEPRINT_DISPLAY_WIDTH, MAX_BLUEPRINT_LABEL_FONT_SIZE, MIN_BLUEPRINT_LABEL_FONT_SIZE, blueprintDisplayDimensions, blueprintNodeDisplayDimensions, blueprintObjectLabelFontSize, clampBlueprintDisplayWidth, minimumBlueprintDisplayWidth, visibleBlueprintFaces } from './blueprintDisplaySize';

const presentation = (width: number, height: number, slots: Array<{ x: number; y: number }>) => ({
  body: { kind: 'RECTANGLE' as const, width, height },
  slots: slots.map(({ x, y }, index) => ({
    slot_key: `slot-${index}`, display_name: `Slot ${index}`, kind: 'CONNECTION_POINT' as const,
    rendered_position: { x, y }, external_attachment: { x, y, side: 'TOP' as const }, connection_point_id: `cp-${index}`,
  })),
}) as any;

describe('Blueprint Saved Map display dimensions', () => {
  it('uses the deterministic width for historical positions and derives height from intrinsic aspect ratio', () => {
    expect(blueprintDisplayDimensions({ kind: 'RECTANGLE', width: 480, height: 60 }, undefined)).toEqual({ width: DEFAULT_BLUEPRINT_DISPLAY_WIDTH, height: 30 });
  });
  it('gives equivalent intrinsic ratios the same runtime dimensions at one display width', () => {
    expect(blueprintDisplayDimensions({ kind: 'RECTANGLE', width: 480, height: 60 }, 320)).toEqual(blueprintDisplayDimensions({ kind: 'RECTANGLE', width: 8, height: 1 }, 320));
  });
  it('allows a one-port square Blueprint to resize to a compact minimum', () => {
    const pc = presentation(100, 100, [{ x: .5, y: .5 }]);
    expect(minimumBlueprintDisplayWidth(pc)).toBe(32);
    expect(clampBlueprintDisplayWidth(20, pc)).toBe(32);
  });
  it('keeps a dense multiport switch large enough for distinct ports', () => {
    const switchBlueprint = presentation(240, 48, Array.from({ length: 16 }, (_, index) => ({ x: (index + .5) / 16, y: .5 })));
    expect(minimumBlueprintDisplayWidth(switchBlueprint)).toBe(224);
    expect(clampBlueprintDisplayWidth(20, switchBlueprint)).toBe(224);
  });
  it('preserves aspect ratio while retaining display_width as the sole size contract', () => {
    const pc = presentation(100, 100, [{ x: .5, y: .5 }]);
    const switchBlueprint = presentation(240, 48, Array.from({ length: 16 }, (_, index) => ({ x: (index + .5) / 16, y: .5 })));
    expect(blueprintDisplayDimensions(switchBlueprint.body, clampBlueprintDisplayWidth(20, switchBlueprint))).toEqual({ width: 224, height: 44.8 });
    expect(blueprintNodeDisplayDimensions(pc, 32)).toEqual({ width: 32, height: 32 });
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
