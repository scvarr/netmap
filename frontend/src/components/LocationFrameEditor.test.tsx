import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LocationFrameEditor } from './LocationFrameEditor';
vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
it('edits only frame presentation and saves explicitly, preserving point identity', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  const save = vi.fn().mockResolvedValue(undefined);
  const geometry = { x: 0, y: 0, width: 300, height: 200, edge: 'right' as const, offset: .5 };
  const { container } = render(<LocationFrameEditor frame={{ locationId: 'room', parentLocationId: null, pathLocationIds: ['room'], label: 'Room', depth: 0, bounds: geometry }}
    state={{ location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: 'room' }, collapsed: false, visible_direct_elements: [], geometry, boundary_point_id: 'stable' }}
    screenToFlowPosition={p => p} onSave={save} actions={null} />);
  const heading = container.querySelector('.location-frame__heading')!;
  fireEvent.pointerDown(heading, { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(heading, { clientX: 50, clientY: 30 });
  fireEvent.pointerUp(heading);
  expect(save).not.toHaveBeenCalled();
  const resize = screen.getByLabelText('map.resizeLocation');
  fireEvent.pointerDown(resize, { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(resize, { clientX: 80, clientY: 40 });
  fireEvent.pointerUp(resize);
  const point = screen.getByLabelText('map.boundaryPoint');
  fireEvent.pointerDown(point, { clientX: 430, clientY: 150 });
  fireEvent.pointerMove(point, { clientX: 240, clientY: 270 });
  fireEvent.pointerUp(point);
  expect(point).toHaveAttribute('data-boundary-point-id', 'stable');
  fireEvent.click(screen.getByText('map.saveLocation'));
  await waitFor(() => expect(save).toHaveBeenCalledWith('room', { x: 50, y: 30, width: 380, height: 240, edge: 'bottom', offset: .5 }));
  vi.unstubAllGlobals();
});

it('allows child escape for ancestor expansion and preserves contained content when resizing', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  const geometry = { x: 20, y: 40, width: 400, height: 300, edge: 'right' as const, offset: .5 };
  const { container } = render(<LocationFrameEditor frame={{ locationId: 'room', parentLocationId: 'root', pathLocationIds: ['room'], label: 'Room', depth: 1, bounds: geometry }}
    parentBounds={{ x: 0, y: 0, width: 500, height: 400 }}
    childBounds={[{ x: 40, y: 80, width: 300, height: 200 }]}
    screenToFlowPosition={p => p} actions={null} />);
  const heading = container.querySelector('.location-frame__heading')!;
  fireEvent.pointerDown(heading, { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(heading, { clientX: -1000, clientY: -1000 });
  const frame = container.querySelector('.location-frame') as HTMLElement;
  expect(frame.style.left).toBe('-980px'); expect(frame.style.top).toBe('-960px');
  fireEvent.pointerCancel(heading);
  const resize = screen.getByLabelText('map.resizeLocation');
  fireEvent.pointerDown(resize, { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(resize, { clientX: -1000, clientY: -1000 });
  fireEvent.pointerUp(resize);
  expect(frame.style.width).toBe('340px'); expect(frame.style.height).toBe('260px');
  vi.unstubAllGlobals();
});

it('uses compact styled controls, capped scale and a canonical path tooltip', () => {
  const { container } = render(<LocationFrameEditor frame={{ locationId: 'U42', parentLocationId: '823', pathLocationIds: ['U42'], label: 'U42', canonicalPath: '808 / 823 / U42', depth: 2, bounds: { x: 0, y: 0, width: 140, height: 64 } }} uiScale={.5} screenToFlowPosition={p => p} actions={null} />);
  const heading = container.querySelector('.location-frame__heading') as HTMLElement;
  expect(heading).toHaveTextContent('U42');
  expect(heading).not.toHaveTextContent('808');
  expect(heading.title).toBe('808 / 823 / U42');
  expect(heading.style.transform).toContain('scale(0.5)');
  fireEvent.pointerDown(heading, { clientX: 0, clientY: 0 });
  for (const button of container.querySelectorAll('button')) expect(button.className).toMatch(/location-/);
});


it('edits automatic boundary only, cancels, rolls back errors and saves edge/offset', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  const save = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue(undefined);
  const geometry = { x: 10, y: 20, width: 300, height: 200, edge: 'right' as const, offset: .5 };
  const props = { automatic: true, frame: { locationId: 'room', parentLocationId: null, pathLocationIds: ['room'], label: 'Room', depth: 0, bounds: geometry }, screenToFlowPosition: (p: { x: number; y: number }) => p, onSaveBoundary: save, actions: null };
  const { container, rerender } = render(<LocationFrameEditor {...props} />);
  const heading = container.querySelector('.location-frame__heading')!;
  fireEvent.pointerDown(heading, { clientX: 10, clientY: 20 });
  fireEvent.pointerMove(heading, { clientX: 100, clientY: 100 });
  expect(screen.queryByText('map.saveLocation')).not.toBeInTheDocument();
  const point = screen.getByLabelText('map.boundaryPoint');
  const drag = () => { fireEvent.pointerDown(point, { clientX: 310, clientY: 120 }); fireEvent.pointerMove(point, { clientX: 85, clientY: 240 }); fireEvent.pointerUp(point); };
  drag();
  expect(point.style.top).toBe('200px'); expect(point.style.left).toBe('75px');
  expect(screen.queryByLabelText('map.resizeLocation')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('map.cancelLocation'));
  expect(point.style.left).toBe('300px');
  drag(); fireEvent.click(screen.getByText('map.saveLocation'));
  await screen.findByRole('alert');
  expect(point.style.left).toBe('300px');
  drag(); fireEvent.click(screen.getByText('map.saveLocation'));
  await waitFor(() => expect(save).toHaveBeenLastCalledWith('room', { edge: 'bottom', offset: .25 }));
  await waitFor(() => expect(screen.queryByText('map.saveLocation')).not.toBeInTheDocument());
  rerender(<LocationFrameEditor {...props} state={{ location_ref: { ref_type: 'CANONICAL_FACT', entity_type: 'Location', entity_id: 'room' }, collapsed: false, visible_direct_elements: [], geometry: { ...geometry, edge: 'bottom', offset: .25 } }} frame={{ ...props.frame, bounds: { ...geometry, width: 600, height: 400 } }} />);
  expect(point.style.left).toBe('150px'); expect(point.style.top).toBe('400px');
  vi.unstubAllGlobals();
});
