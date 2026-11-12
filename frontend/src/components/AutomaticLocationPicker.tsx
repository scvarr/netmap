import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n';
import { locationPath } from '../topology/locationPresentation';
import type { LocationDocument } from '../topology/locationTypes';

/** Container selection only: tree order never writes layout order or canonical parents. */
export function AutomaticLocationPicker({ locations, selected, onSelect }: {
  locations: readonly LocationDocument[]; selected: string; onSelect: (id: string) => void;
}) {
  const { t, collator } = useI18n();
  const treeId = useId();
  const tree = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState(() => new Set(['root']));
  const [focused, setFocused] = useState('root');
  const rootLabel = t('autoLocation.root');
  const byParent = new Map<string, LocationDocument[]>();
  for (const location of locations) {
    const parent = location.parent_location_ref?.entity_id ?? 'root';
    byParent.set(parent, [...(byParent.get(parent) ?? []), location]);
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => collator.compare(a.name, b.name) || a.location_ref.entity_id.localeCompare(b.location_ref.entity_id));
  const path = (id: string) => id === 'root' ? rootLabel : rootLabel + ' / ' + locationPath([...locations], id);
  const toggle = (id: string) => setExpanded(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, id: string, parent: string | null) => {
    const items = [...(tree.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])];
    const index = items.indexOf(event.currentTarget);
    let target: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') target = items[index + 1];
    else if (event.key === 'ArrowUp') target = items[index - 1];
    else if (event.key === 'Home') target = items[0];
    else if (event.key === 'End') target = items.at(-1);
    else if (event.key === 'ArrowRight') {
      if (byParent.has(id) && !expanded.has(id)) toggle(id);
      else if (byParent.has(id)) target = items[index + 1];
    } else if (event.key === 'ArrowLeft') {
      if (expanded.has(id)) toggle(id);
      else target = items.find(item => item.dataset.locationId === parent);
    } else return;
    event.preventDefault(); target?.focus();
  };
  const render = (id: string, label: string, parent: string | null): React.ReactNode => {
    const children = byParent.get(id) ?? [];
    const open = expanded.has(id);
    const fullPath = path(id);
    return <li key={id} role="none">
      <div className="object-location-picker-tree__row">
        <span className="object-location-picker-tree__toggle">{children.length > 0 && <button type="button" tabIndex={-1} aria-label={t(open ? 'location.pickerCollapse' : 'location.pickerExpand', { name: label })} onClick={() => { toggle(id); tree.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]').forEach(item => { if (item.dataset.locationId === id) item.focus(); }); }}>{open ? '−' : '+'}</button>}</span>
        <button type="button" role="treeitem" data-location-id={id} aria-label={fullPath} title={fullPath} aria-selected={selected === id} aria-owns={open && children.length ? treeId + id : undefined} aria-expanded={children.length ? open : undefined}
          className="object-location-picker-tree__choice" tabIndex={focused === id ? 0 : -1} onFocus={() => setFocused(id)} onKeyDown={event => keyboard(event, id, parent)} onClick={() => onSelect(id)}><strong>{label}</strong></button>
      </div>
      {open && children.length > 0 && <ul id={treeId + id} role="group" className="object-location-picker-tree">{children.map(child => render(child.location_ref.entity_id, child.name, id))}</ul>}
    </li>;
  };
  return <div className="automatic-location-picker">
    <ul ref={tree} role="tree" aria-label={t('autoLocation.container')} className="object-location-picker-tree">{render('root', rootLabel, null)}</ul>
    <output className="object-location-path" aria-live="polite">{path(selected)}</output>
  </div>;
}
