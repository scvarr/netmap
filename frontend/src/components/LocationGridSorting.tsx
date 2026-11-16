import { useState } from 'react';
import { useI18n } from '../i18n';
import type { LocationDocument } from '../topology/locationTypes';
import type { GridSortScope, LocationTable } from '../topology/locationGridArrangement';
import type { LocationGridArrangement } from './useLocationGridArrangement';

export function LocationGridSorting({parent, table, locations, arrangement}: {parent:string; table:LocationTable; locations:readonly LocationDocument[]; arrangement:LocationGridArrangement}) {
  const {t} = useI18n();
  const [scope, setScope] = useState<GridSortScope>({kind:'all',traversal:'rows'});
  const names = new Map(locations.map(l => [l.location_ref.entity_id,l.name]));
  const width = Math.max(0,...table.map(row=>row.length));
  return <fieldset disabled={arrangement.busy}><legend>{t('gridSort.layout')}</legend>
    <button type="button" aria-pressed={scope.kind==='all'} onClick={()=>setScope({kind:'all',traversal:'rows'})}>{t('gridSort.all')}</button>
    <div style={{overflowX:'auto'}}><table><thead><tr><th></th>{Array.from({length:width},(_,c)=><th key={c}><button type="button" aria-pressed={scope.kind==='column' && scope.index===c} onClick={()=>setScope({kind:'column',index:c})}>C{c+1}</button></th>)}</tr></thead>
      <tbody>{table.map((row,r)=><tr key={r}><th><button type="button" aria-pressed={scope.kind==='row' && scope.index===r} onClick={()=>setScope({kind:'row',index:r})}>R{r+1}</button></th>{row.map((id,c)=><td key={c}>{id===null?t('gridSort.empty'):names.get(id) ?? id}</td>)}</tr>)}</tbody></table></div>
    {scope.kind==='all' && <select aria-label={t('gridSort.traversal')} value={scope.traversal} onChange={e=>setScope({kind:'all',traversal:e.target.value as 'rows'|'columns'})}><option value="rows">{t('gridSort.rows')}</option><option value="columns">{t('gridSort.columns')}</option></select>}
    <button type="button" onClick={()=>arrangement.sort(parent,scope,false)}>{t('gridSort.ascending')}</button>
    <button type="button" onClick={()=>arrangement.sort(parent,scope,true)}>{t('gridSort.descending')}</button>
  </fieldset>;
}
