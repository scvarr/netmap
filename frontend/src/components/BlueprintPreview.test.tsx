import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { BlueprintPreview } from './BlueprintPreview';
import type { BlueprintSlot } from '../topology/baseTemplateTypes';

const panel = (panel_key: string, x: number, y: number, width: number, height: number, panel_number = 1) =>
  ({ panel_key, panel_number, display_name: panel_key, x, y, width, height });

it('keeps all 48 ports and 24 links distinct on a low, two-sided CPP24-24 composition', async () => {
  const panels = [panel('front', 0, 0, 480, 16), panel('rear', 0, 28, 480, 16, 2)];
  const slots: BlueprintSlot[] = panels.flatMap(side => Array.from({ length: 24 }, (_, index) => ({
    key: `${side.panel_key}-${index}`, panel_key: side.panel_key, port_type_id: 'test-type', kind: index % 2 ? 'CONNECTION_POINT' : 'NETWORK_PORT',
    display_name: `P${String(index + 1).padStart(2, '0')}`,
    rendered_position: { x: (index + .5) / 24, y: .5 },
  })));
  const links = Array.from({ length: 24 }, (_, index) => ({ from_slot_key: `front-${index}`, to_slot_key: `rear-${index}` }));
  const widthMock = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  render(<BlueprintPreview label="CPP24-24" body={{ kind: 'RECTANGLE', width: 480, height: 44, fill_color: '#28565a' }}
    panels={panels} slots={slots} internalLinks={links} />);
  const svg = screen.getByRole('img', { name: 'CPP24-24' });
  expect(svg).toHaveAttribute('viewBox', '0 0 480 44');
  widthMock.mockRestore();
  expect(Number(svg.getAttribute('width'))).toBe(258);
  expect(Number(svg.getAttribute('height')) / Number(svg.getAttribute('width'))).toBeCloseTo(44 / 480);
  expect(svg.querySelectorAll('[data-panel-key]')).toHaveLength(2);
  expect(svg.querySelector('[data-panel-key="rear"]')).toHaveAttribute('y', '28');
  expect(svg.querySelector('[data-panel-key="front"]')).toHaveAttribute('fill', '#28565a');
  const markers = [...svg.querySelectorAll('[data-endpoint-marker]')];
  const attr = (port: Element, name: string) => Number(port.getAttribute(name));
  const square = (port: Element) => port.tagName === 'rect';
  const x = (port: Element) => square(port) ? attr(port, 'x') + attr(port, 'width') / 2 : attr(port, 'cx');
  const y = (port: Element) => square(port) ? attr(port, 'y') + attr(port, 'height') / 2 : attr(port, 'cy');
  const extent = (port: Element) => (square(port) ? attr(port, 'width') / Math.SQRT2 : attr(port, 'r')) + attr(port, 'stroke-width') / 2;
  expect(markers[0].tagName).toBe('rect');
  expect(markers[0]).toHaveAttribute('fill', '#60d4c9');
  expect(markers[1].tagName).toBe('circle');
  expect(markers[1]).toHaveAttribute('fill', '#f2d081');
  expect(markers).toHaveLength(48);
  expect(new Set(markers.map(y))).toEqual(new Set([8, 36]));
  const lines = [...svg.querySelectorAll('line')];
  expect(lines).toHaveLength(24);
  expect(lines[0]).toHaveAttribute('y1', '8');
  expect(lines[0]).toHaveAttribute('y2', '36');
  expect(attr(lines[0], 'x1')).toBeCloseTo(x(markers[0]));
  expect(attr(lines[0], 'x2')).toBeCloseTo(x(markers[24]));

  for (const [index, a] of markers.entries()) {
    expect(extent(a)).toBeLessThanOrEqual(Math.min(x(a), 480 - x(a), 8));
    for (const b of markers.slice(index + 1)) {
      const gap = Math.hypot(x(a) - x(b), y(a) - y(b));
      expect(extent(a) + extent(b)).toBeLessThan(gap);
    }
  }

  expect(svg.querySelectorAll('text')).toHaveLength(0);
  const screenExtent = (marker: Element) => extent(marker) * attr(svg, 'width') / 480;
  const fitExtents = markers.slice(0, 2).map(screenExtent);
  const user = userEvent.setup();
  const zoom = screen.getByRole('button', { name: 'Приблизить' });
  await user.click(zoom);
  await user.click(zoom);
  expect(svg.querySelectorAll('text')).toHaveLength(0);
  for (const [index, marker] of markers.slice(0, 2).entries()) {
    expect(screenExtent(marker)).toBeCloseTo(fitExtents[index]);
  }
  expect([...svg.querySelectorAll('[data-endpoint-marker] title')].map(title => title.textContent))
    .toEqual(slots.map(slot => slot.display_name));
  expect(within(svg).queryByRole('button')).not.toBeInTheDocument();
  expect(svg.querySelector('[data-selected], [data-endpoint-hit-target], [data-panel-resize]')).toBeNull();
  const scroller = screen.getByRole('region', { name: 'CPP24-24' });
  expect(scroller).toHaveAttribute('tabindex', '0');
  await user.click(screen.getByRole('button', { name: 'Общий вид' }));
  expect(scroller).not.toHaveAttribute('tabindex');
  expect(svg.querySelectorAll('[data-endpoint-marker]')).toHaveLength(48);
});

it('fits a tall, narrow composition and draws only the placed bay in panel coordinates', () => {
  render(<BlueprintPreview label="Narrow" body={{ kind: 'RECTANGLE', width: 40, height: 480 }}
    panels={[panel('upper', -10, 20, 40, 200), panel('lower', -10, 260, 40, 240, 2)]} slots={[]}
    bays={[
      { kind: 'PLACED', bay_key: 'placed', display_name: 'OCP', compatibility: 'OCP3', panel_key: 'lower', x: .25, y: .5, width: .5, height: .25 },
      { kind: 'LOGICAL', bay_key: 'logical', display_name: 'Logical', compatibility: 'OCP3', panel_key: 'upper' },
    ]} />);
  const svg = screen.getByRole('img', { name: 'Narrow' });
  expect(svg).toHaveAttribute('viewBox', '-10 20 40 480');
  expect(Number(svg.getAttribute('height'))).toBeLessThan(440);
  expect(Number(svg.getAttribute('width')) / Number(svg.getAttribute('height'))).toBeCloseTo(1 / 12);
  const bay = svg.querySelector('[data-bay-key="placed"]');
  expect(bay).toHaveAttribute('x', '0');
  expect(bay).toHaveAttribute('y', '380');
  expect(bay).toHaveAttribute('width', '20');
  expect(bay).toHaveAttribute('height', '60');
  expect(svg.querySelector('[data-bay-key="logical"]')).toBeNull();
});
