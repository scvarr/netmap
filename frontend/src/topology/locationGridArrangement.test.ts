import { expect, it } from 'vitest';
import { moveGridLocation, normalizeLocationTable, type GridDirection } from './locationGridArrangement';
it.each<[GridDirection,string[][],string[][]]>([
 ['UP',[['B'],['A']],[['A'],['B']]],
 ['DOWN',[['A'],['B']],[['B'],['A']]],
 ['LEFT',[['B','A']],[['A','B']]],
 ['RIGHT',[['A','B']],[['B','A']]],
])('swaps %s by cell address', (direction,table,expected) => {
 expect(moveGridLocation(table,'A',direction)).toEqual(expected);
});
it('moves into a free cell and retains holes in active tracks', () => {
 const table=[['A',null],['B','D'],['C',null]];
 expect(moveGridLocation(table,'A','RIGHT')).toEqual([[null,'A'],['B','D'],['C',null]]);
 expect(table[0]).toEqual(['A',null]);
});
it('creates a second column and a new row only for a real structural change', () => {
 expect(moveGridLocation([['A'],['B']], 'A','RIGHT')).toEqual([[null,'A'],['B',null]]);
 expect(moveGridLocation([['A','B']], 'A','UP')).toEqual([['A',null],[null,'B']]);
 for(const direction of ['UP','DOWN','LEFT','RIGHT'] as const) expect(moveGridLocation([['A']], 'A',direction)).toBeNull();
 expect(moveGridLocation([['A'],['B']], 'A','UP')).toBeNull();
});
it('cleans old empty tracks without deleting holes, identity or order', () => {
 const table=[[null,null,null],[null,'A',null],[null,null,null],[null,'B','D'],[null,'C',null]];
 expect(normalizeLocationTable(table)).toEqual([['A',null],['B','D'],['C',null]]);
 expect(normalizeLocationTable([[],[null]])).toEqual([]);
 expect(moveGridLocation(table,'missing','UP')).toBeNull();
});
it('repeated moves preserve identities and bound the table dimensions', () => {
 let table:(string|null)[][]=[['A'],['B'],['C']];
 for(let i=0;i<30;i++) {
   table=moveGridLocation(table,'B','RIGHT')!;
   expect(table).toEqual([['A',null],[null,'B'],['C',null]]);
   table=moveGridLocation(table,'B','LEFT')!;
   expect(table).toEqual([['A'],['B'],['C']]);
 }
});
