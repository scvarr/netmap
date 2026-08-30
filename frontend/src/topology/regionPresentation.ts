import type { MapRegion, MapRegionStyle } from './savedMapTypes';

/** Bounded creation presentation, deliberately without a Region style authoring surface. */
export const defaultMapRegionStyle = (): MapRegionStyle => ({
  fill_color: '#54e3b4',
  fill_opacity: 0.16,
  stroke_color: '#54e3b4',
  stroke_width: 2,
  stroke_style: 'solid',
  label_color: '#dff7ef',
});

export const nextMapRegionZOrder = (regions: readonly MapRegion[]) =>
  Math.max(-1, ...regions.map((region) => region.z_order)) + 1;
