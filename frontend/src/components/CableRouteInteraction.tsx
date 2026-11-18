import { useViewport, type XYPosition } from '@xyflow/react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import type { LogicalFlowEdge } from '../topology/layout';

export interface CableTarget {
  key: string;
  from: XYPosition;
  to: XYPosition;
  maxHitWidth?: number;
  cables: ReadonlyMap<string, LogicalFlowEdge>;
}

export interface CablePortBounds extends XYPosition {
  radius: number;
}

// Form disjoint holes so overlapping ports (including overlapping objects)
// cannot punch a hit-testable island back into the SVG clip.
function portCutouts(ports: readonly CablePortBounds[]) {
  const bands = new Map<number, { start: CablePortBounds[]; end: CablePortBounds[] }>();
  for (const port of ports) {
    for (const [y, type] of [[port.y - port.radius, 'start'], [port.y + port.radius, 'end']] as const) {
      if (!bands.has(y)) bands.set(y, { start: [], end: [] });
      bands.get(y)![type].push(port);
    }
  }
  let path = '';
  let top = 0;
  const active = new Set<CablePortBounds>();
  for (const [bottom, changes] of [...bands].sort(([a], [b]) => a - b)) {
    let left = 0;
    let right = -Infinity;
    for (const port of [...active].sort((a, b) => (a.x - a.radius) - (b.x - b.radius))) {
      const start = port.x - port.radius;
      if (start > right) {
        if (right > left) path += rectanglePath(left, top, right, bottom);
        left = start;
        right = port.x + port.radius;
      } else right = Math.max(right, port.x + port.radius);
    }
    if (right > left) path += rectanglePath(left, top, right, bottom);
    for (const port of changes.end) active.delete(port);
    for (const port of changes.start) active.add(port);
    top = bottom;
  }
  return path;
}

const rectanglePath = (left: number, top: number, right: number, bottom: number) =>
  `M ${left} ${top} H ${right} V ${bottom} H ${left} Z `;

export function cableHitClip(targets: readonly CableTarget[], ports: readonly CablePortBounds[]) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const { x, y } of [...targets.flatMap(({ from, to }) => [from, to]), ...ports]) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return rectanglePath(left - 32, top - 32, right + 32, bottom + 32) + portCutouts(ports);
}

const midpoint = ({ from, to }: CableTarget) => ({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });

interface Anchor {
  key: string;
  trigger: SVGPathElement;
  x: number;
  y: number;
  chooser: boolean;
}

export function CableRouteInteraction({ targets, clip, selectedMarkers, labelFor, onHover, onSelect, onContextMenu }: {
  targets: readonly CableTarget[];
  clip: string;
  selectedMarkers: readonly CableTarget[];
  labelFor: (edge: LogicalFlowEdge) => { name: string; endpoints: string };
  onHover: (cableId: string | null) => void;
  onSelect?: (edge: LogicalFlowEdge) => void;
  onContextMenu?: (event: React.MouseEvent<SVGElement>, edge: LogicalFlowEdge) => void;
}) {
  const { t, locale } = useI18n();
  const { zoom } = useViewport();
  const clipId = useId();
  const popup = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const active = anchor ? targets.find(target => target.key === anchor.key) : undefined;
  const activeSingle = active?.cables.size === 1 ? labelFor(active.cables.values().next().value!) : undefined;
  const [position, setPosition] = useState<XYPosition>({ x: 0, y: 0 });

  function close(restoreFocus = false) {
    if (restoreFocus) anchor?.trigger.focus();
    setAnchor(null);
    onHover(null);
  }

  useEffect(() => {
    if (!anchor) return;
    const dismiss = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(anchor.chooser);
    };
    const resize = () => close();
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('wheel', dismiss, { capture: true, passive: true });
    window.addEventListener('keydown', escape, true);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('wheel', dismiss, true);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', resize);
    };
  }, [anchor, onHover]);

  useEffect(() => { if (anchor && !active) close(); }, [anchor, active]);
  useLayoutEffect(() => {
    if (!active || !anchor || !popup.current) return;
    const { width, height } = popup.current.getBoundingClientRect();
    const margin = 8;
    const gap = 14;
    const x = anchor.x + gap + width <= window.innerWidth - margin ? anchor.x + gap : anchor.x - gap - width;
    const y = anchor.y + gap + height <= window.innerHeight - margin ? anchor.y + gap : anchor.y - gap - height;
    setPosition({
      x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    });
  }, [anchor, active, locale]);
  useLayoutEffect(() => {
    if (anchor?.chooser) popup.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [anchor]);

  const countLabel = (count: number) => t('map.cableSegment.count', { count });
  const tabs = new Set<string>();
  const marker = (target: CableTarget, key: string, hovered: boolean) => {
    const { x, y } = midpoint(target);
    return <circle key={key} className={`cable-route-marker${hovered ? ' cable-route-marker--hovered' : ''}`}
      cx={x} cy={y} r={3 / zoom} strokeWidth={1.5 / zoom} aria-hidden="true" />;
  };
  return <>
    {targets.length > 0 && <defs><clipPath id={clipId}><path d={clip} clipRule="evenodd" /></clipPath></defs>}
    <g clipPath={targets.length ? `url(#${clipId})` : undefined}>
      {targets.map(({ key, from, to, cables, maxHitWidth }) => {
        const ids = [...cables.keys()].sort();
        const single = ids.length === 1 ? cables.get(ids[0]) : undefined;
        const label = single ? labelFor(single) : null;
        const tabKey = JSON.stringify(ids);
        const tabbable = Boolean(onSelect && !tabs.has(tabKey));
        tabs.add(tabKey);
        const show = (trigger: SVGPathElement, x: number, y: number, chooser = false) => {
          setAnchor({ key, trigger, x, y, chooser });
          onHover(!chooser && single ? ids[0] : null);
        };
        const activate = (trigger: SVGPathElement, x: number, y: number) => {
          if (single) {
            close();
            onSelect?.(single);
          } else show(trigger, x, y, true);
        };
        const keyboardAnchor = (trigger: SVGPathElement) => {
          const box = trigger.getBoundingClientRect();
          return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
        };
        const leave = () => {
          if (anchor?.key === key && !anchor.chooser) close();
        };
        return <path key={key} className="cable-route-hit" d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
          data-cable-count={ids.length} strokeWidth={Math.min(12 / zoom, maxHitWidth ?? Infinity)}
          role={onSelect ? 'button' : undefined} tabIndex={onSelect ? (tabbable ? 0 : -1) : undefined}
          aria-label={label ? [label.name, label.endpoints].filter(Boolean).join(' · ') : countLabel(ids.length)}
          aria-haspopup={onSelect && !single ? 'dialog' : undefined}
          aria-expanded={onSelect && !single ? anchor?.key === key && anchor.chooser : undefined}
          onPointerEnter={event => {
            if (!anchor?.chooser && !event.buttons) show(event.currentTarget, event.clientX, event.clientY);
          }}
          onPointerLeave={leave}
          onFocus={event => {
            if (!event.currentTarget.matches(':focus-visible') || anchor?.chooser) return;
            const { x, y } = keyboardAnchor(event.currentTarget);
            show(event.currentTarget, x, y);
          }}
          onBlur={event => { if (!popup.current?.contains(event.relatedTarget)) leave(); }}
          onKeyDown={onSelect ? event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            const { x, y } = keyboardAnchor(event.currentTarget);
            activate(event.currentTarget, x, y);
          } : undefined}
          onClick={onSelect ? event => {
            event.stopPropagation();
            activate(event.currentTarget, event.clientX, event.clientY);
          } : undefined}
          onContextMenu={single && onContextMenu ? event => {
            event.stopPropagation();
            close();
            onContextMenu(event, single);
          } : undefined} />;
      })}
    </g>
    {selectedMarkers.map(target => marker(target, target.key, false))}
    {active && marker(active, 'hover', true)}
    {active && anchor && createPortal(
      <div ref={popup} role={anchor.chooser ? 'dialog' : 'tooltip'}
        aria-label={anchor.chooser ? t('map.cableSegment.choose') : undefined}
        className={`map-context-menu cable-route-popup${anchor.chooser ? '' : ' cable-route-popup--tooltip'}`}
        style={{ left: position.x, top: position.y }}>
        {anchor.chooser
          ? [...active.cables].map(([id, edge]) => ({ id, edge, ...labelFor(edge) }))
            .sort((a, b) => a.name.localeCompare(b.name, locale) || a.endpoints.localeCompare(b.endpoints, locale) || a.id.localeCompare(b.id))
            .map(({ id, edge, name, endpoints }, _, items) => <button key={id} type="button" onClick={event => {
              event.stopPropagation();
              close(true);
              onSelect?.(edge);
            }}><strong>{name}</strong>{endpoints && <small>{endpoints}</small>}
              {items.some(other => other.id !== id && other.name === name && other.endpoints === endpoints) && <small>{id}</small>}
            </button>)
          : activeSingle
            ? <><strong>{activeSingle.name}</strong>{activeSingle.endpoints && <small>{activeSingle.endpoints}</small>}</>
            : countLabel(active.cables.size)}
      </div>, document.body)}
  </>;
}
