import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MapRegionLayer } from './MapRegionLayer';

const region = { region_ref: { entity_type: 'MapRegion' as const, entity_id: 'region-a' }, label: 'A', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], style: { fill_color: '#123456', fill_opacity: .2, stroke_color: '#abcdef', stroke_width: 2, stroke_style: 'solid' as const }, z_order: 0 };

describe('MapRegionLayer', () => {
  it('adds a presentation-only selected decoration without changing Region data', () => {
    const before = structuredClone(region);
    render(<MapRegionLayer regions={[region]} referenceOutlines={[]} showReferenceOutlines={false} selectedRegionId="region-a" />);
    expect(screen.getByTestId('map-region-region-a')).toHaveClass('map-region-layer__region--selected');
    expect(screen.getByTestId('map-region-region-a')).toHaveAttribute('data-selected', 'true');
    expect(region).toEqual(before);
  });

  it('exposes pointer interaction only for the active local properties label', () => {
    const onLabelPointerDown = vi.fn();
    render(<MapRegionLayer regions={[region]} referenceOutlines={[]} showReferenceOutlines={false} interactiveLabelRegionId="region-a" onLabelPointerDown={onLabelPointerDown} />);
    fireEvent.pointerDown(screen.getByTestId('map-region-label-region-a'));
    expect(onLabelPointerDown).toHaveBeenCalledTimes(1);
  });
});
