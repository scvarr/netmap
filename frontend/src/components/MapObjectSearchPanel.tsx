import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Temporary workspace position; deliberately independent of map presentation. */
export function MapObjectSearchPanel({ title, children }: { title: string; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ x: 16, y: 16 });
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const clamp = (point: { x: number; y: number }) => {
    const element = panel.current;
    const workspace = element?.parentElement;
    if (!element || !workspace) return point;
    const bounds = element.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(point.x, workspace.clientWidth - bounds.width)),
      y: Math.max(0, Math.min(point.y, workspace.clientHeight - bounds.height)),
    };
  };
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element?.parentElement) return;
    const observer = new ResizeObserver(() => setPosition((current) => {
      const next = clamp(current);
      return next.x === current.x && next.y === current.y ? current : next;
    }));
    observer.observe(element);
    observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, []);
  return <section ref={panel} className="map-object-search nodrag nopan nowheel" aria-label={title}
    style={{ left: position.x, top: position.y }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
    <h2 className="map-object-search__handle" onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      drag.current = { pointerId: event.pointerId, x: event.clientX - position.x, y: event.clientY - position.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      event.stopPropagation();
      setPosition(clamp({ x: event.clientX - drag.current.x, y: event.clientY - drag.current.y }));
    }} onPointerUp={(event) => {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      drag.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>{title}</h2>
    {children}
  </section>;
}
