import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MapTextAnnotationLayer } from './MapTextAnnotationLayer';

const annotation = { annotation_ref: { entity_type: 'MapTextAnnotation' as const, entity_id: 'annotation-a' }, text: 'First\nSecond', position: { x: 10, y: 20 }, text_color: '#123456', font_size: 18 };

describe('MapTextAnnotationLayer text annotations', () => {
  it('renders multiline text and exposes selected free-drag interaction', () => {
    const select = vi.fn(); const down = vi.fn();
    render(<MapTextAnnotationLayer annotations={[annotation]} selectedAnnotationId="annotation-a" interactiveAnnotationId="annotation-a" onAnnotationClick={select} onAnnotationPointerDown={down} />);
    const text = screen.getByTestId('map-text-annotation-annotation-a');
    expect(text).toHaveAttribute('x', '10'); expect(text).toHaveTextContent('FirstSecond'); expect(text.querySelectorAll('tspan')).toHaveLength(2);
    fireEvent.click(text); fireEvent.pointerDown(text); expect(select).toHaveBeenCalledWith('annotation-a'); expect(down).toHaveBeenCalledWith('annotation-a', expect.anything());
  });
});
