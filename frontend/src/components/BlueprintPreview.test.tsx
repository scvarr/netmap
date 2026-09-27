import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlueprintPreview } from './BlueprintPreview';
import { blueprintThumbnailGeometry } from '../topology/blueprintThumbnailGeometry';

const panel = (panel_key: string, x: number, y: number, width: number, height: number, panel_number = 1) => ({ panel_key, panel_number, display_name: `Panel ${panel_number}`, x, y, width, height });

describe('BlueprintPreview', () => {
  it('fits one wide panel into the thumbnail viewport', () => {
    expect(blueprintThumbnailGeometry([panel('a', 0, 0, 8, 1)], { width: 120, height: 120 }))
      .toMatchObject({ width: 120, height: 15, intrinsicWidth: 8, intrinsicHeight: 1 });
  });

  it('renders all persisted panels and endpoints at composition coordinates', () => {
    const panels = [panel('a', 0, 0, 8, 1), panel('b', 8, 0, 8, 1, 2)];
    render(<BlueprintPreview body={{ kind: 'RECTANGLE', width: 8, height: 1 }} panels={panels} slots={[
      { key: 'a1', display_name: 'A', kind: 'CONNECTION_POINT', panel_key: 'a', rendered_position: { x: .5, y: .5 } },
      { key: 'b1', display_name: 'B', kind: 'NETWORK_PORT', panel_key: 'b', rendered_position: { x: .5, y: .5 } },
    ]} internalLinks={[{ from_slot_key: 'a1', to_slot_key: 'b1' }]} />);
    const preview = screen.getByRole('img');
    expect(preview).toHaveAttribute('viewBox', '0 0 16 1');
    expect(preview.querySelectorAll('[data-panel-key]')).toHaveLength(2);
    expect(preview.querySelector('[data-slot-key="a1"] circle')).toHaveAttribute('cx', '4');
    expect(preview.querySelector('[data-slot-key="b1"] circle')).toHaveAttribute('cx', '12');
    expect(preview.querySelector('line')).toHaveAttribute('x2', '12');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
