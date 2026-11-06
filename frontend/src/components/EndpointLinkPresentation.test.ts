import { describe,it,expect } from 'vitest';
import { presentedLinks } from './EndpointLinkWorkspace';
import { newBlueprintEditorState } from '../pages/BaseTemplateEditor';
it('orients and sorts undirected links without mutating storage',()=>{
 const s=newBlueprintEditorState(); const p=s.panels[0];s.panels=[p,{...p,panel_key:'b',panel_number:2},{...p,panel_key:'c',panel_number:3}];
 s.slots=['1','2','10'].flatMap(n=>[p.panel_key,'b','c'].map(panel=>({key:panel+n,panel_key:panel,display_name:n,port_type_id:'test-type',kind:'CONNECTION_POINT' as const,rendered_position:{x:0,y:0}})));
 const a=(n:string)=>p.panel_key+n;s.individualLinks=[{from_slot_key:'b10',to_slot_key:a('10')},{from_slot_key:'c1',to_slot_key:'c2'},{from_slot_key:'b2',to_slot_key:a('1')},{from_slot_key:a('1'),to_slot_key:'b1'},{from_slot_key:a('2'),to_slot_key:a('1')}];
 const before=JSON.stringify(s);const sides=[{panel:p.panel_key,order:['1','2','10'].map(a)},{panel:'b',order:['b1','b2','b10']}];
 expect(presentedLinks(s,sides,false).map(x=>[x.a,x.b])).toEqual([[a('1'),'b1'],[a('1'),'b2'],[a('10'),'b10']]);
 expect(presentedLinks(s,[sides[0],sides[0]],false)).toHaveLength(1);
 expect(presentedLinks(s,sides,true)).toHaveLength(5);expect(JSON.stringify(s)).toBe(before);
 expect(presentedLinks(s,sides,true).filter(x=>x.b.startsWith('b')).map(x=>x.b)).toEqual(['b1','b2','b10']);
});
