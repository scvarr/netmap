import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {I18nProvider} from '../i18n';
import {LocationSettingsDialog} from './LocationSettingsDialog';
import {LocationGridSorting} from './LocationGridSorting';
import {useLocationGridArrangement} from './useLocationGridArrangement';
import type {LocationDocument} from '../topology/locationTypes';
it('preserves collapse edits, sort scope and draft across tabs; close does not write',()=>{
 const close=vi.fn(),save=vi.fn(),collapseSave=vi.fn();
 const locations=Array.from({length:42},(_,i)=>({location_ref:{entity_id:String(i)},name:'U'+(42-i)})) as LocationDocument[];
 function App(){const arrangement=useLocationGridArrangement({automatic:{mode:'uniform_grid',version:1,hide_empty:false,tables:{root:locations.map(l=>[l.location_ref.entity_id])}},locations,onAutomaticLayout:save});
 return <LocationSettingsDialog name="823" onClose={close} layout={<LocationGridSorting parent="root" table={arrangement.preview?.tables.root ?? []} locations={locations} arrangement={arrangement}/>}><label><input type="checkbox"/>U01</label><button onClick={collapseSave}>Сохранить</button></LocationSettingsDialog>;}
 render(<I18nProvider><App/></I18nProvider>);
 fireEvent.click(screen.getByLabelText('U01'));fireEvent.click(screen.getByRole('tab',{name:'Компоновка'}));
 fireEvent.click(screen.getByText('По возрастанию'));fireEvent.click(screen.getByText('R1'));
 fireEvent.click(screen.getByRole('tab',{name:'Сворачивание'}));expect(screen.getByLabelText('U01')).toBeChecked();
 fireEvent.click(screen.getByRole('tab',{name:'Компоновка'}));expect(screen.getByText('R1')).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByText('Закрыть'));expect(close).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('tab',{name:'Сворачивание'}));fireEvent.click(screen.getByText('Сохранить'));expect(collapseSave).toHaveBeenCalledOnce();
});
