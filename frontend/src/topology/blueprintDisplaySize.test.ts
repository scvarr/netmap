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
    expect(minimumBlueprintDisplayWidth(dense)).toBe(224);
    expect(clampBlueprintDisplayWidth(20, dense)).toBe(224);
    expect(clampBlueprintDisplayWidth(2000)).toBe(960);
  });
});
