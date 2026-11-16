import { expect, it } from 'vitest';
import { insertLocation, gridDropDirection, type GridDirection } from './locationGridInsertion';
it('inserts B between A and C without mutation or replacement', () => {
 const source = [['A'], ['C'], ['B']];
 expect(insertLocation(source, 'B', 'A', 'BELOW')).toEqual([['A'], ['B'], ['C'], [null]]);
 expect(source).toEqual([['A'], ['C'], ['B']]);
});
it('inserts D right of B as a new column', () => {
 expect(insertLocation([['A','B','C'],['D',null,null]], 'D','B','RIGHT')).toEqual([['A','B','D','C'],[null,null,null,null]]);
});
it.each<GridDirection>(['ABOVE','BELOW','LEFT','RIGHT'])('%s preserves every identity and sparse tracks deterministically', direction => {
 const source = [['A','B','C'],['D','E','F'],['G','H','I'],[null,null,null]];
 const next = insertLocation(source,'A','E',direction);
 expect(next.flat().filter(Boolean).sort()).toEqual(source.flat().filter(Boolean).sort());
 expect(insertLocation(source,'A','E',direction)).toEqual(next);
 expect(next.at(-1)?.every(x => x === null)).toBe(true);
});
it('uses the freed source cell; rejects missing/foreign/self/duplicate siblings', () => {
 expect(insertLocation([['A','B']], 'A','B','LEFT')).toEqual([['A','B']]);
 for(const table of [[['A']], [['A','A','B']]]) expect(() => insertLocation(table,'A','B','RIGHT')).toThrow();
 expect(() => insertLocation([['A']], 'A','A','RIGHT')).toThrow();
});
it('rejects center and outside; deterministically resolves corners', () => {
 const box = {x:100,y:200,width:200,height:100};
 expect(gridDropDirection(box,{x:200,y:250})).toBeNull();
 expect(gridDropDirection(box,{x:99,y:200})).toBeNull();
 expect(gridDropDirection(box,{x:100,y:200})).toBe('ABOVE');
 expect(gridDropDirection(box,{x:299,y:250})).toBe('RIGHT');
});
