import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MapObjectSearchPanel } from './MapObjectSearchPanel';

afterEach(() => vi.unstubAllGlobals());

it('drags only by its heading, isolates pointer input, and clamps after moving and resizing', () => {
  let resize!: () => void;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('PointerEvent', MouseEvent);
  const pan = vi.fn();
  const select = vi.fn();
  render(<div onPointerDown={pan}><MapObjectSearchPanel title="Поиск объекта"><input aria-label="Поиск" /><button onClick={select}>Объект</button></MapObjectSearchPanel></div>);
  const panel = screen.getByRole('region');
  const handle = screen.getByRole('heading');
  Object.defineProperties(panel.parentElement!, { clientWidth: { value: 700, configurable: true }, clientHeight: { value: 500, configurable: true } });
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ width: 260, height: 120 } as DOMRect);
  handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(screen.getByRole('textbox'), { button: 0, clientX: 30, clientY: 50 });
  fireEvent.pointerMove(handle, { clientX: 200, clientY: 200 });
  expect(panel).toHaveStyle({ left: '16px', top: '16px' });
  fireEvent.pointerDown(handle, { button: 0, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(handle, { clientX: 204, clientY: 154 });
  expect(panel).toHaveStyle({ left: '200px', top: '150px' });
  fireEvent.pointerMove(handle, { clientX: 1000, clientY: 1000 });
  expect(panel).toHaveStyle({ left: '440px', top: '380px' });
  Object.defineProperty(panel.parentElement!, 'clientWidth', { value: 400 });
  act(() => resize());
  expect(panel).toHaveStyle({ left: '140px' });
  fireEvent.pointerMove(handle, { clientX: -10, clientY: -10 });
  expect(panel).toHaveStyle({ left: '0px', top: '0px' });
  fireEvent.pointerUp(handle);
  fireEvent.pointerMove(handle, { clientX: 100, clientY: 100 });
  expect(panel).toHaveStyle({ left: '0px', top: '0px' });
  fireEvent.click(screen.getByRole('button'));
  expect(select).toHaveBeenCalledOnce();
  expect(pan).not.toHaveBeenCalled();
});
