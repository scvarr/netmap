import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { BlueprintPreview } from './BlueprintPreview';
import type { BlueprintSlot } from '../topology/baseTemplateTypes';

const panel = (panel_key: string, x: number, y: number, width: number, height: number, panel_number = 1) =>
  ({ panel_key, panel_number, display_name: panel_key, x, y, width, height });

it('keeps all 48 ports and 24 links distinct on a low, two-sided CPP24-24 composition', async () => {
  const panels = [panel('front', 0, 0, 480, 16), panel('rear', 0, 28, 480, 16, 2)];
  const slots: BlueprintSlot[] = panels.flatMap(side => Array.from({ length: 24 }, (_, index) => ({
    key: `${side.panel_key}-${index}`, panel_key: side.panel_key, kind: 'CONNECTION_POINT',
    display_name: `P${String(index + 1).padStart(2, '0')}`,
    rendered_position: { x: (index + .5) / 24, y: .5 },
  })));
  const links = Array.from({ length: 24 }, (_, index) => ({ from_slot_key: `front-${index}`, to_slot_key: `rear-${index}` }));
  render(<BlueprintPreview label="CPP24-24" body={{ kind: 'RECTANGLE', width: 480, height: 44, fill_color: '#28565a' }}
    panels={panels} slots={slots} internalLinks={links} />);
  const svg = screen.getByRole('img', { name: 'CPP24-24' });
  expect(svg).toHaveAttribute('viewBox', '0 0 480 44');
  expect(Number(svg.getAttribute('width'))).toBeGreaterThan(640);
  expect(Number(svg.getAttribute('height')) / Number(svg.getAttribute('width'))).toBeCloseTo(44 / 480);
  expect(svg.querySelectorAll('[data-panel-key]')).toHaveLength(2);
  expect(svg.querySelector('[data-panel-key="rear"]')).toHaveAttribute('y', '28');
  expect(svg.querySelector('[data-panel-key="front"]')).toHaveAttribute('fill', '#28565a');
  const circles = [...svg.querySelectorAll('circle')];
  expect(circles).toHaveLength(48);
  expect(new Set(circles.map(port => port.getAttribute('cy')))).toEqual(new Set(['8', '36']));
  const lines = [...svg.querySelectorAll('line')];
  expect(lines).toHaveLength(24);
  expect(lines[0]).toHaveAttribute('y1', '8');
  expect(lines[0]).toHaveAttribute('y2', '36');
  expect(lines[0]).toHaveAttribute('x1', circles[0].getAttribute('cx'));
  expect(lines[0]).toHaveAttribute('x2', circles[24].getAttribute('cx'));

  for (const [index, a] of circles.entries()) {
    for (const b of circles.slice(index + 1)) {
      const gap = Math.hypot(Number(a.getAttribute('cx')) - Number(b.getAttribute('cx')),
        Number(a.getAttribute('cy')) - Number(b.getAttribute('cy')));
      const extent = (port: SVGCircleElement) => Number(port.getAttribute('r')) + Number(port.getAttribute('stroke-width')) / 2;
      expect(extent(a) + extent(b)).toBeLessThan(gap);
    }
  }

  const user = userEvent.setup();
  const zoom = screen.getByRole('button', { name: 'Приблизить' });
  await user.click(zoom);
  await user.click(zoom);
  const labels = [...svg.querySelectorAll('[data-port-label]')];
  expect(labels).toHaveLength(48);
  for (const [index, a] of labels.entries()) {
    for (const b of labels.slice(index + 1)) {
      const font = Number(a.getAttribute('font-size'));
      const dx = Math.abs(Number(a.getAttribute('x')) - Number(b.getAttribute('x')));
      const dy = Math.abs(Number(a.getAttribute('y')) - Number(b.getAttribute('y')));
      expect(dx >= 3 * font || dy >= font).toBe(true);
    }
  }
  expect(within(svg).queryByRole('button')).not.toBeInTheDocument();
  expect(svg.querySelector('[data-selected], [data-endpoint-hit-target], [data-panel-resize]')).toBeNull();
  const scroller = screen.getByRole('region', { name: 'CPP24-24' });
  expect(scroller).toHaveAttribute('tabindex', '0');
  await user.click(screen.getByRole('button', { name: 'Общий вид' }));
  expect(scroller).not.toHaveAttribute('tabindex');
  expect(svg.querySelectorAll('circle')).toHaveLength(48);
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
