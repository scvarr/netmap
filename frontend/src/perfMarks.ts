/** Passive PERF-001 seam. It is inert unless the real-browser harness enables it. */
declare global { interface Window { __NETMAP_PERF__?: boolean } }

export const perfMark = (name: string) => {
  if (!window.__NETMAP_PERF__) return;
  performance.mark(`netmap:${name}`);
};

export const perfMeasure = (name: string, start: string, end?: string) => {
  if (!window.__NETMAP_PERF__) return;
  performance.measure(`netmap:${name}`, `netmap:${start}`, end ? `netmap:${end}` : undefined);
  window.dispatchEvent(new CustomEvent('netmap-perf-measure', { detail: { name } }));
};
