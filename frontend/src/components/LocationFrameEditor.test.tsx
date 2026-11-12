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

it('clamps child moves and parent resize to preserve padded containment', () => {
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
  fireEvent.pointerUp(heading);
  const frame = container.querySelector('.location-frame') as HTMLElement;
  expect(frame.style.left).toBe('20px'); expect(frame.style.top).toBe('40px');
  const resize = screen.getByLabelText('map.resizeLocation');
  fireEvent.pointerDown(resize, { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(resize, { clientX: -1000, clientY: -1000 });
  fireEvent.pointerUp(resize);
  expect(frame.style.width).toBe('340px'); expect(frame.style.height).toBe('260px');
  vi.unstubAllGlobals();
});
