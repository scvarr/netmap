import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlueprintPreview } from './BlueprintPreview';

describe('BlueprintPreview', () => {
  it('keeps the supplied presentation ratio and exposes ports at their requested borders', () => {
    render(<BlueprintPreview body={{ kind: 'RECTANGLE', width: 100, height: 4, fill_color: '#123456' }} slots={[
      { key: 'left', display_name: 'A', kind: 'CONNECTION_POINT', anchor: { side: 'LEFT', offset: .5 } },
      { key: 'right', display_name: 'B', kind: 'NETWORK_PORT', anchor: { side: 'RIGHT', offset: .5 } },
      { key: 'top', display_name: 'T', kind: 'CONNECTION_POINT', anchor: { side: 'TOP', offset: .5 } },
      { key: 'bottom', display_name: 'D', kind: 'CONNECTION_POINT', anchor: { side: 'BOTTOM', offset: .5 } },
    ]} />);
    const preview = screen.getByRole('img'); expect(preview).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet'); expect(preview).toHaveAttribute('data-ratio', '25');
    expect(preview.querySelector('rect')).toHaveAttribute('width', '100'); expect(preview.querySelector('rect')).toHaveAttribute('height', '4');
    expect(preview.querySelector('[data-slot-key="left"]')).toHaveAttribute('data-anchor-side', 'LEFT');
    expect(preview.querySelector('[data-slot-key="right"]')).toHaveAttribute('data-anchor-side', 'RIGHT');
    expect(preview.querySelector('[data-slot-key="top"]')).toHaveAttribute('data-anchor-side', 'TOP');
    expect(preview.querySelector('[data-slot-key="bottom"]')).toHaveAttribute('data-anchor-side', 'BOTTOM');
  });
});
