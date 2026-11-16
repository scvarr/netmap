import { expect, it } from 'vitest';
import { insertLocation, gridDropDirection, type GridDirection } from './locationGridInsertion';
it('inserts B between A and C without mutation or replacement', () => {
 const source = [['A'], ['C'], ['B']];
 expect(insertLocation(source, 'B', 'A', 'BELOW')).toEqual([['A'], ['B'], ['C']]);
 expect(source).toEqual([['A'], ['C'], ['B']]);
});
it('inserts D right of B as a new column', () => {
 expect(insertLocation([['A','B','C'],['D',null,null]], 'D','B','RIGHT')).toEqual([['A','B','D','C']]);
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

it('moves C above A without leaving an empty source row', () => {
 expect(insertLocation([['A'],['B'],['C']], 'C','A','ABOVE')).toEqual([['C'],['A'],['B']]);
});
it('removes a vacated column before inserting into another row and recalculates the anchor', () => {
 expect(insertLocation([['A','B','C']], 'A','C','ABOVE')).toEqual([[null,'A'],['B','C']]);
 expect(insertLocation([['A','B','C']], 'C','A','BELOW')).toEqual([['A','B'],['C',null]]);
});
it('retains a source hole when both its tracks still contain siblings', () => {
 expect(insertLocation([['A','B'],['C','D']], 'A','D','BELOW')).toEqual([[null,'B'],['C','D'],[null,'A']]);
});
it('preserves pre-existing empty rows and columns while removing both newly empty source tracks', () => {
 const source = [['A',null,null],[null,null,null],[null,null,'B']];
 expect(insertLocation(source,'A','B','ABOVE')).toEqual([[null,'A'],[null,'B']]);
 expect(source).toEqual([['A',null,null],[null,null,null],[null,null,'B']]);
});
it.each<GridDirection>(['ABOVE','BELOW','LEFT','RIGHT'])('%s inserts after both source tracks are removed without duplicates', direction => {
 const source = [['M',null,null],[null,'A','B'],[null,'C','D']];
 const next = insertLocation(source,'M','D',direction);
 const expected = {
   ABOVE: [['A','B'],[null,'M'],['C','D']],
   BELOW: [['A','B'],['C','D'],[null,'M']],
   LEFT: [['A',null,'B'],['C','M','D']],
   RIGHT: [['A','B',null],['C','D','M']],
 };
 expect(next).toEqual(expected[direction]);
 expect(next.flat().filter(Boolean).sort()).toEqual(['A','B','C','D','M']);
});
it('repeated back-and-forth moves do not accumulate tracks on either axis', () => {
 let column: (string|null)[][] = [['A'],['B'],['C']];
 let row: (string|null)[][] = [['A','B','C']];
 for (let i=0;i<30;i++) {
   column = insertLocation(column,'C','A','ABOVE');
   expect(column).toEqual([['C'],['A'],['B']]);
   column = insertLocation(column,'C','B','BELOW');
   row = insertLocation(row,'C','A','LEFT');
   expect(row).toEqual([['C','A','B']]);
   row = insertLocation(row,'C','B','RIGHT');
   expect(column).toEqual([['A'],['B'],['C']]);
   expect(row).toEqual([['A','B','C']]);
 }
});
