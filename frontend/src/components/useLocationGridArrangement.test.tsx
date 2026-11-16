import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useLocationGridArrangement } from './useLocationGridArrangement';
import type { LocationDocument } from '../topology/locationTypes';
import type { AutomaticLocationLayout } from '../topology/savedMapTypes';
const settings:AutomaticLocationLayout={mode:'uniform_grid',version:1,hide_empty:true,tables:{root:[[null],['A'],['B'],['C']],B:[['child']]}};
const locations=[...['A','B','C'].map(id=>({location_ref:{entity_id:id}})),{location_ref:{entity_id:'child'},parent_location_ref:{entity_id:'B'}}] as LocationDocument[];
function setup(save=vi.fn().mockResolvedValue(undefined)) {
 const input={automatic:settings,locations,variantId:'one',onAutomaticLayout:save};
 const h=renderHook(({value})=>useLocationGridArrangement(value,'map'),{initialProps:{value:input}});
 return {...h,save,input};
}
it('starts off, normalizes only a working copy on entry and cancels a series without writes', () => {
 const h=setup(); const original=JSON.stringify(settings);
 expect(h.result.current.preview).toBeNull(); act(()=>h.result.current.enter());
 expect(h.result.current.preview?.tables.root).toEqual([['A'],['B'],['C']]);
 act(()=>h.result.current.select('B')); act(()=>h.result.current.move('RIGHT')); act(()=>h.result.current.move('UP'));
 expect(h.result.current.selected).toBe('B'); expect(h.result.current.preview?.tables.B).toEqual([['child']]);
 expect(h.result.current.preview?.hide_empty).toBe(true); expect(JSON.stringify(settings)).toBe(original);
 act(()=>h.result.current.cancel()); expect(h.result.current.preview).toBeNull(); expect(h.save).not.toHaveBeenCalled();
});
it('sends one complete preview on Done and blocks duplicates until confirmation', async () => {
 let resolve!:()=>void; const save=vi.fn((_settings:AutomaticLocationLayout)=>new Promise<void>(r=>resolve=r)); const h=setup(save);
 act(()=>h.result.current.enter()); act(()=>h.result.current.select('B')); act(()=>h.result.current.move('RIGHT'));
 const preview=h.result.current.preview;
 act(()=>{void h.result.current.finish(); void h.result.current.finish();});
 expect(save).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledWith(preview); expect(h.result.current.busy).toBe(true);
 await act(async()=>resolve()); expect(h.result.current.preview).toBeNull();
});
it('rolls back failed save and reports an error', async () => {
 const h=setup(vi.fn().mockRejectedValue(new Error('failed')));
 act(()=>h.result.current.enter()); act(()=>h.result.current.select('B')); act(()=>h.result.current.move('RIGHT'));
 await act(async()=>h.result.current.finish());
 await waitFor(()=>expect(h.result.current.error).toBe(true)); expect(h.result.current.preview).toBeNull();
 expect(settings.tables.root).toEqual([[null],['A'],['B'],['C']]);
});
it('discards on variant/layout changes without writes; manual and legacy cannot enter', () => {
 const h=setup(); act(()=>h.result.current.enter()); act(()=>h.result.current.select('A'));
 h.rerender({value:{...h.input,variantId:'two'}}); expect(h.result.current.preview).toBeNull(); expect(h.result.current.selected).toBeNull();
 for(const automatic of [null,{hide_empty:false,containers:{}}] as (AutomaticLocationLayout|null)[]) {
   h.rerender({value:{...h.input,automatic:automatic as AutomaticLocationLayout}});
   act(()=>h.result.current.enter()); expect(h.result.current.preview).toBeNull();
 }
 expect(h.save).not.toHaveBeenCalled();
});

it('atomically starts sorting with the full shape, combines moves, cancels or saves once',async()=>{
 const h=setup();
 act(()=>h.result.current.sort('root',{kind:'all',traversal:'rows'},true));
 expect(h.result.current.preview?.tables.root).toEqual([[null],['C'],['B'],['A']]);
 expect(h.result.current.preview?.tables.B).toEqual([['child']]);
 act(()=>h.result.current.select('B')); act(()=>h.result.current.move('RIGHT'));
 const moved=h.result.current.preview!;
 act(()=>h.result.current.sort('root',{kind:'row',index:1},false));
 expect(h.result.current.preview?.tables.B).toEqual(moved.tables.B);
 act(()=>h.result.current.cancel()); expect(h.save).not.toHaveBeenCalled();
 act(()=>h.result.current.sort('root',{kind:'all',traversal:'columns'},true));
 await act(async()=>h.result.current.finish()); expect(h.save).toHaveBeenCalledTimes(1);
});
