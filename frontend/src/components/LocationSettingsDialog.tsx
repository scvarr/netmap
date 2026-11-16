import {useId, useState, type ReactNode} from 'react';
import {useI18n} from '../i18n';

export function LocationSettingsDialog({name, layout, children, onClose}: {name:string; layout?:ReactNode; children:ReactNode; onClose:()=>void}) {
  const {t}=useI18n();
  const [tab,setTab]=useState<'collapse'|'layout'>('collapse');
  const id=useId();
  const title=t('gridSort.settings',{name});
  return <div className="map-dialog" role="dialog" aria-modal="true" aria-label={title}><section className="map-dialog__surface map-location-dialog">
    <h2>{title}</h2>
    <div role="tablist" aria-label={title} className="endpoint-workspace__tabs">
      {(['collapse',...(layout ? ['layout'] as const : [])] as const).map(value=><button key={value} id={`${id}-${value}`} type="button" role="tab" aria-selected={tab===value} aria-controls={`${id}-${value}-panel`} onClick={()=>setTab(value)}>{t(value==='collapse'?'gridSort.collapse':'gridSort.layout')}</button>)}
    </div>
    <div className="map-location-dialog__panel" role="tabpanel" id={`${id}-collapse-panel`} aria-labelledby={`${id}-collapse`} hidden={tab!=='collapse'}>{children}</div>
    {layout && <div className="map-location-dialog__panel" role="tabpanel" id={`${id}-layout-panel`} aria-labelledby={`${id}-layout`} hidden={tab!=='layout'}>
      <p>{t('gridSort.draftHelp')}</p>{layout}
    </div>}
    <div className="map-dialog__actions"><button type="button" onClick={onClose}>{t('gridSort.close')}</button></div>
  </section></div>;
}
