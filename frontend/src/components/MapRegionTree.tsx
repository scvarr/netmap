import { useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { deriveRegionHierarchy, type RegionHierarchyNode } from '../topology/regionHierarchy';
import type { MapRegion } from '../topology/savedMapTypes';

export function MapRegionTree({ regions, selectedRegionId, onSelect, selectionDisabled = false }: { regions: readonly MapRegion[]; selectedRegionId: string | null; onSelect: (regionId: string) => void; selectionDisabled?: boolean }) {
  const { t } = useI18n(); const tree = deriveRegionHierarchy(regions); const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  if (tree.length === 0) return <p className="map-region-tree__empty">{t('map.regionEmpty')}</p>;
  const renderNode = (node: RegionHierarchyNode, depth: number): ReactNode => {
    const id = node.region.region_ref.entity_id; const hasChildren = node.children.length > 0; const isCollapsed = collapsed.has(id);
    return <li key={id}><div className="map-region-tree__row" style={{ paddingInlineStart: `${depth * 16}px` }}>
      {hasChildren ? <button type="button" className="map-region-tree__toggle" aria-label={isCollapsed ? t('map.regionExpand', { label: node.region.label }) : t('map.regionCollapse', { label: node.region.label })} onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })}>{isCollapsed ? '▶' : '▼'}</button> : <span className="map-region-tree__spacer" aria-hidden="true" />}
      <button type="button" className="map-region-tree__select" aria-pressed={selectedRegionId === id} disabled={selectionDisabled} onClick={() => onSelect(id)}>{node.region.label}</button>
    </div>{hasChildren && !isCollapsed && <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>}</li>;
  };
  return <section className="map-region-tree" aria-label={t('map.regionTree')}><ul>{tree.map((node) => renderNode(node, 0))}</ul></section>;
}
