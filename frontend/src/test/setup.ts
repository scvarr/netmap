import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverMock });
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  writable: true,
  value: () => Promise.resolve(new Response('{"status":"ok"}', { status: 200 })),
});
