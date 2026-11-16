import {expect,it} from 'vitest';
import {sortLocationTable} from './locationGridArrangement';
const names=new Map([['a','U42'],['b','U02'],['c','U10'],['d','U01'],['e','U03'],['f','U11']]);
it('sorts natural numbers in both directions without changing input',()=>{
 const table=[['a','b','c','d','e','f']];
 expect(sortLocationTable(table,names,{kind:'all',traversal:'rows'})).toEqual([['d','b','e','c','f','a']]);
 expect(sortLocationTable(table,names,{kind:'all',traversal:'rows'},true)).toEqual([['a','f','c','e','b','d']]);
 expect(table[0][0]).toBe('a');
});
it('uses arbitrary names and UUID ties deterministically',()=>{
 const labels=new Map([['a','Комната 10'],['b','Комната 2'],['c','Комната 2']]);
 expect(sortLocationTable([['c','a','b']],labels,{kind:'row',index:0})).toEqual([['b','c','a']]);
});
it('changes only selected row or column and sends empties to the end',()=>{
 const table=[['a',null,'b'],['c','d',null],['e','f',null]];
 expect(sortLocationTable(table,names,{kind:'row',index:0})).toEqual([['b','a',null],['c','d',null],['e','f',null]]);
 expect(sortLocationTable(table,names,{kind:'column',index:1})).toEqual([['a','d','b'],['c','f',null],['e',null,null]]);
});
it('retains shape and empty mask for both whole-table traversals',()=>{
 const table=[['a',null,'b'],[null,null,null],['c','d',null]];
 expect(sortLocationTable(table,names,{kind:'all',traversal:'rows'})).toEqual([['d',null,'b'],[null,null,null],['c','a',null]]);
 expect(sortLocationTable(table,names,{kind:'all',traversal:'columns'})).toEqual([['d',null,'a'],[null,null,null],['b','c',null]]);
});
