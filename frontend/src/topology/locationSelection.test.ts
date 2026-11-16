import {expect,it} from 'vitest';
import {locationAtPoint} from './locationSelection';
import type {LocationDocument} from './locationTypes';
it('selects deepest canonical containment independent of frame order; ignores absent frames',()=>{
 const locations=[{location_ref:{entity_id:'parent'}},{location_ref:{entity_id:'child'},parent_location_ref:{entity_id:'parent'}},{location_ref:{entity_id:'hidden'},parent_location_ref:{entity_id:'child'}}] as LocationDocument[];
 const frames=[{locationId:'parent',bounds:{x:0,y:0,width:400,height:300}},{locationId:'child',bounds:{x:20,y:40,width:200,height:100}}];
 expect(locationAtPoint(locations,frames,{x:25,y:50})).toBe('child');
 expect(locationAtPoint(locations,[...frames].reverse(),{x:25,y:50})).toBe('child');
 expect(locationAtPoint(locations,frames,{x:350,y:250})).toBe('parent');
 expect(locationAtPoint(locations,frames,{x:450,y:250})).toBeNull();
});
