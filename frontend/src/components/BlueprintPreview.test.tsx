import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlueprintPreview } from './BlueprintPreview';
import { blueprintThumbnailGeometry } from '../topology/blueprintThumbnailGeometry';

describe('BlueprintPreview', () => {
  it('fits an 8:1 body as a wide, horizontal non-interactive thumbnail', () => {
    const geometry = blueprintThumbnailGeometry({ width: 8, height: 1 }, [], { width: 120, height: 120 });
    expect(geometry.width).toBeGreaterThan(geometry.height);
    expect(geometry).toMatchObject({ width: 120, height: 15, intrinsicWidth: 8, intrinsicHeight: 1 });
  });

  it('gives equivalent 480:60 and 8:1 bodies equal fitted geometry', () => {
    expect(blueprintThumbnailGeometry({ width: 480, height: 60 }, [], { width: 120, height: 120 }))
      .toMatchObject({ width: 120, height: 15, faces: ['FRONT'] });
    expect(blueprintThumbnailGeometry({ width: 8, height: 1 }, [], { width: 120, height: 120 }))
      .toMatchObject({ width: 120, height: 15, faces: ['FRONT'] });
  });

  it('renders one or two directly joined face surfaces without face controls', () => {
    const { rerender } = render(<BlueprintPreview body={{ kind: 'RECTANGLE', width: 8, height: 1 }} slots={[
      { key: 'front', display_name: 'Front', kind: 'CONNECTION_POINT', rendered_position: { x: .25, y: .5 } },
      { key: 'rear', display_name: 'Rear', kind: 'CONNECTION_POINT', face: 'REAR', rendered_position: { x: .75, y: .5 } },
    ]} />);
    const thumbnail = screen.getByTestId('blueprint-thumbnail');
    expect(screen.getAllByTestId(/blueprint-thumbnail-face-/)).toHaveLength(2);
    expect(screen.getByTestId('blueprint-thumbnail-face-FRONT').nextElementSibling).toBe(screen.getByTestId('blueprint-thumbnail-face-REAR'));
    expect(thumbnail).toHaveAttribute('data-preview-width', '120');
    expect(thumbnail).toHaveAttribute('data-preview-height', '30');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<BlueprintPreview body={{ kind: 'RECTANGLE', width: 8, height: 1 }} slots={[
      { key: 'front', display_name: 'Front', kind: 'CONNECTION_POINT', rendered_position: { x: .25, y: .5 } },
    ]} />);
    expect(screen.getAllByTestId(/blueprint-thumbnail-face-/)).toHaveLength(1);
    expect(screen.getByTestId('blueprint-thumbnail')).toHaveStyle({ width: '120px', height: '120px' });
  });

  it('renders derived positions inside the intrinsic body', () => {
    render(<BlueprintPreview body={{ kind: 'RECTANGLE', width: 100, height: 4, fill_color: '#123456' }} slots={[
      { key: 'left', display_name: 'A', kind: 'CONNECTION_POINT', rendered_position: { x: .2, y: .5 } },
      { key: 'right', display_name: 'B', kind: 'NETWORK_PORT', rendered_position: { x: .8, y: .5 } },
      { key: 'top', display_name: 'T', kind: 'CONNECTION_POINT', rendered_position: { x: .5, y: .2 } },
      { key: 'bottom', display_name: 'D', kind: 'CONNECTION_POINT', rendered_position: { x: .5, y: .8 } },
    ]} />);
    const preview = screen.getByRole('img'); expect(preview).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet'); expect(preview).toHaveAttribute('data-ratio', '25');
    expect(preview.querySelector('rect')).toHaveAttribute('width', '100'); expect(preview.querySelector('rect')).toHaveAttribute('height', '4');
    expect(preview.querySelector('[data-slot-key="left"] circle')).toHaveAttribute('cx', '20');
    expect(preview.querySelector('[data-slot-key="right"] circle')).toHaveAttribute('cx', '80');
  });
});
