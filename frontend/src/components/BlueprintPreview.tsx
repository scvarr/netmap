import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { BlueprintBody, BaseInternalLink, BlueprintSlot, PresentationPanel } from '../topology/baseTemplateTypes';
import { useI18n } from '../i18n';
import { blueprintThumbnailGeometry } from '../topology/blueprintThumbnailGeometry';

interface BlueprintPreviewProps { body: BlueprintBody; panels: PresentationPanel[]; slots: BlueprintSlot[]; internalLinks?: BaseInternalLink[]; label?: string; style?: CSSProperties; viewportWidth?: number; viewportHeight?: number; }
const pointFor = (slot: BlueprintSlot, panels: PresentationPanel[]) => {
  const panel = panels.find((item) => item.panel_key === slot.panel_key);
  if (!panel) throw new Error(`Unknown Blueprint panel ${slot.panel_key}`);
  return { x: panel.x + slot.rendered_position.x * panel.width, y: panel.y + slot.rendered_position.y * panel.height };
};

/** Non-interactive, intrinsic-aspect library thumbnail. */
export function BlueprintPreview({ body, panels, slots, internalLinks = [], label, style, viewportWidth = 120, viewportHeight = 120 }: BlueprintPreviewProps) {
  const { t } = useI18n();
  const geometry = blueprintThumbnailGeometry(panels, { width: viewportWidth, height: viewportHeight });
  const points = new Map(slots.map((slot) => [slot.key, pointFor(slot, panels)]));
  return <div className="blueprint-thumbnail" style={{ width: viewportWidth, height: viewportHeight, ...style }} data-testid="blueprint-thumbnail" data-preview-width={geometry.width} data-preview-height={geometry.height}>
    <svg className="blueprint-preview" style={{ width: geometry.width, height: geometry.height }} viewBox={`${geometry.originX} ${geometry.originY} ${geometry.intrinsicWidth} ${geometry.intrinsicHeight}`} role="img" aria-label={label ?? t('blueprint.editor.preview')} preserveAspectRatio="xMidYMid meet" data-ratio={geometry.intrinsicWidth / geometry.intrinsicHeight}>
      {panels.map((panel) => <rect key={panel.panel_key} className="blueprint-preview__body" data-panel-key={panel.panel_key} x={panel.x} y={panel.y} width={panel.width} height={panel.height} rx={Math.min(panel.width, panel.height) * .04} fill={body.fill_color || '#18383a'} />)}
      {internalLinks.map((link) => { const from = points.get(link.from_slot_key); const to = points.get(link.to_slot_key); return from && to ? <line key={`${link.from_slot_key}-${link.to_slot_key}`} className="blueprint-preview__link" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null; })}
      {slots.map((slot) => { const point = points.get(slot.key)!; return <g key={slot.key} data-slot-key={slot.key}><circle className={`blueprint-preview__port blueprint-preview__port--${slot.kind.toLowerCase()}`} cx={point.x} cy={point.y} r={Math.max(geometry.intrinsicWidth, geometry.intrinsicHeight) * .018} /><title>{slot.display_name}</title></g>; })}
    </svg>
  </div>;
}

interface BlueprintPreviewViewportProps extends Omit<BlueprintPreviewProps, 'style' | 'viewportWidth' | 'viewportHeight'> { scale: number; }

export function BlueprintPreviewViewport({ body, scale, ...preview }: BlueprintPreviewViewportProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => setBounds({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  const viewportWidth = Math.max(1, (bounds.width - 32) * scale);
  const viewportHeight = Math.max(1, (bounds.height - 32) * scale);
  return <div ref={ref} className="blueprint-preview-viewport" data-preview-scale={scale}>
    <BlueprintPreview {...preview} body={body} viewportWidth={viewportWidth} viewportHeight={viewportHeight} />
  </div>;
}
