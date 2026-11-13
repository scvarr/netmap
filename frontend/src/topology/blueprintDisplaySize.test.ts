import { describe, expect, it } from 'vitest';
import { DEFAULT_BLUEPRINT_DISPLAY_WIDTH, blueprintNodeDisplayDimensions, clampBlueprintDisplayWidth, minimumBlueprintDisplayWidth, panelCompositionBounds } from './blueprintDisplaySize';
import type { BlueprintPresentation } from './types';

const presentation = (panels: BlueprintPresentation['panels'], positions: Array<{ x: number; y: number }> = []): BlueprintPresentation => ({
  blueprint_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplate', entity_id: 'bp' },
  version_ref: { ref_type: 'LIBRARY_RECORD', entity_type: 'BaseTemplateRevision', entity_id: 'v' },
  body: { kind: 'RECTANGLE', width: panels[0].width, height: panels[0].height }, panels,
  slots: positions.map((point, index) => ({ slot_key: `${index}`, display_name: `${index}`, kind: 'CONNECTION_POINT', panel_key: panels[0].panel_key, panel_local_position: point, rendered_position: point, external_attachment: { ...point, side: 'TOP' }, connection_point_id: `${index}` })),
});
const first = { panel_key: 'a', panel_number: 1, display_name: 'Panel 1', x: 0, y: 0, width: 8, height: 1 };

describe('Blueprint composition display dimensions', () => {
  it('sizes one panel from its composition aspect ratio', () => {
    expect(blueprintNodeDisplayDimensions(presentation([first]), undefined)).toEqual({ width: DEFAULT_BLUEPRINT_DISPLAY_WIDTH, height: 30 });
  });
  it('sizes adjacent and offset panels from their full bounds', () => {
    const panels = [first, { ...first, panel_key: 'b', panel_number: 2, x: 8 }];
    expect(panelCompositionBounds(panels)).toEqual({ x: 0, y: 0, width: 16, height: 1 });
    expect(blueprintNodeDisplayDimensions(presentation(panels), 320)).toEqual({ width: 320, height: 20 });
    expect(panelCompositionBounds([{ ...first, x: -2, y: 3 }])).toEqual({ x: -2, y: 3, width: 8, height: 1 });
  });
  it('keeps dense endpoints apart while bounding display width', () => {
    const dense = presentation([{ ...first, width: 240, height: 48 }], Array.from({ length: 16 }, (_, index) => ({ x: (index + .5) / 16, y: .5 })));
    expect(minimumBlueprintDisplayWidth(dense)).toBeCloseTo(160);
    expect(clampBlueprintDisplayWidth(20, dense)).toBeCloseTo(160);
    expect(clampBlueprintDisplayWidth(2000)).toBe(960);
  });
});

describe('compact port geometry', () => {
  it.each(['CONNECTION_POINT', 'NETWORK_PORT'] as const)('separates 48 %s markers in two rows and resolves old widths without mutation', kind => {
    const dense = presentation([first], Array.from({ length: 48 }, (_, i) => ({ x: (i % 24 + .5) / 24, y: i < 24 ? .25 : .75 })));
    dense.slots.forEach(slot => { slot.kind = kind; });
    const before = JSON.stringify(dense);
    const minimum = minimumBlueprintDisplayWidth(dense);
    expect(minimum).toBeCloseTo(240);
    expect(blueprintNodeDisplayDimensions(dense, 40).width).toBe(minimum);
    expect(clampBlueprintDisplayWidth(40, dense)).toBe(minimum);
    expect(JSON.stringify(dense)).toBe(before);
  });
  it('does not cap the density minimum at 240', () => {
    const dense = presentation([first], [{ x: .1, y: .5 }, { x: .12, y: .5 }]);
    expect(minimumBlueprintDisplayWidth(dense)).toBeCloseTo(500);
  });
  it('reports geometry outside the supported range instead of clamping it', () => {
    const dense = presentation([first], [{ x: .1, y: .5 }, { x: .101, y: .5 }]);
    expect(() => clampBlueprintDisplayWidth(240, dense)).toThrow('map.portGeometryUnsupported');
    dense.slots[1].panel_local_position = { ...dense.slots[0].panel_local_position };
    expect(() => minimumBlueprintDisplayWidth(dense)).toThrow('map.portGeometryCoincident');
  });
});
