import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useLocationGridDrag } from './useLocationGridDrag';
import type { LocationDocument } from '../topology/locationTypes';
import type { UniformLocationGrid } from '../topology/savedMapTypes';
const settings: UniformLocationGrid = {mode:'uniform_grid',version:1,hide_empty:true,tables:{root:[['A'],['B'],['C']],A:[['child']]}};
const locations = ['A','B','C'].map(id => ({location_ref:{entity_id:id}})).concat([{location_ref:{entity_id:'child'},parent_location_ref:{entity_id:'A'}}] as never) as LocationDocument[];
const convert = (p: {x:number;y:number}) => ({x:p.x/2,y:p.y/2});
function setup(save = vi.fn().mockResolvedValue(undefined), foreign = false) {
 vi.stubGlobal('PointerEvent', MouseEvent);
 const input = {automatic:settings,variantId:'active',locations,onAutomaticLayout:save};
 const hook = renderHook(({value}) => useLocationGridDrag(value,convert,'scene'), {initialProps:{value:input}});
 hook.result.current.frames.current = ['A','B','C'].map((id,i) => ({locationId:id,parentLocationId:foreign && id === 'A' ? 'other' : null,pathLocationIds:[id],label:id,depth:0,bounds:{x:0,y:i*100,width:100,height:80}}));
 act(() => hook.result.current.start({button:0,pointerId:undefined,stopPropagation:vi.fn(),preventDefault:vi.fn()} as never,'C'));
 return {...hook,save,input};
}
it.each(['Escape','pointercancel','invalid'])('cancels %s without writes', kind => {
 const h=setup();
 fireEvent.pointerMove(window,{clientX:100,clientY:2});
 expect(h.result.current.preview).not.toBeNull();
 expect(settings.tables.root).toEqual([['A'],['B'],['C']]);
 if(kind==='Escape') fireEvent.keyDown(window,{key:'Escape'});
 else if(kind==='pointercancel') fireEvent.pointerCancel(window);
 else fireEvent.pointerUp(window,{clientX:900,clientY:900});
 expect(h.result.current.preview).toBeNull(); expect(h.save).not.toHaveBeenCalled(); h.unmount();
});
it('saves once on drop, preserves nested table/hide_empty, locks until response', async () => {
 let resolve!: () => void;
 const save=vi.fn((_settings: UniformLocationGrid) => new Promise<void>(r => {resolve=r;})); const h=setup(save);
 fireEvent.pointerMove(window,{clientX:100,clientY:2});
 expect(save).not.toHaveBeenCalled();
 const preview = h.result.current.preview;
 fireEvent.pointerUp(window,{clientX:100,clientY:2});
 expect(save).toHaveBeenCalledWith(preview);
 expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0]).toMatchObject({hide_empty:true,tables:{A:[['child']],root:[['C'],['A'],['B']]}});
 expect(h.result.current.busy).toBe(true);
 await act(async()=>resolve()); expect(h.result.current.preview).toBeNull(); h.unmount();
});
it('rolls back API errors and cancels on variant/settings change', async () => {
 const h=setup(vi.fn().mockRejectedValue(new Error('failed')));
 fireEvent.pointerUp(window,{clientX:100,clientY:2});
 await waitFor(()=>expect(h.result.current.error).toBe(true)); expect(h.result.current.preview).toBeNull();
 h.unmount();
 const next=setup(); fireEvent.pointerMove(window,{clientX:100,clientY:2});
 next.rerender({value:{...next.input,variantId:'other'}});
 expect(next.result.current.preview).toBeNull(); expect(next.save).not.toHaveBeenCalled(); next.unmount();
});



it('rejects another canonical parent', () => {
 const h=setup(vi.fn(),true); fireEvent.pointerUp(window,{clientX:100,clientY:2});
 expect(h.save).not.toHaveBeenCalled(); h.unmount();
});
