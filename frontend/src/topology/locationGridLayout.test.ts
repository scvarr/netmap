import { describe, expect, it } from 'vitest';
import { layoutLocationGrid, type LocationGridNode, type LocationGridResult } from './locationGridLayout';
const node = (id: string, children: LocationGridNode['children'] = [], directObjects: LocationGridNode['directObjects'] = []): LocationGridNode => ({ id, minimum: { width: 100, height: 32 }, children, directObjects });
const full = (id: string, width = 150, height = 70) => node(id, [], [{ width, height }]);
const fixture = () => node('root', [[full('A'), null], [full('B', 300), full('D', 120, 180)], [full('C'), node('empty')]]);
const child = (r: LocationGridResult, id: string) => r.children.find(c => c.id === id)!;
const size = (r: LocationGridResult) => ({ width: r.bounds.width, height: r.bounds.height });

describe('uniform Location table core', () => {
  it('retains explicit blank tracks and recovers them after hide empty', () => {
    const input = node('root', [[full('a'), null, full('b')], [null], [full('c')]]);
    const r = layoutLocationGrid(input);
    expect(child(r, 'b').bounds.x - child(r, 'a').bounds.x).toBe(174 + 20 + 100 + 20);
    expect(child(r, 'c').bounds.y - child(r, 'a').bounds.y).toBe(94 + 12 + 32 + 12);
    expect(child(layoutLocationGrid(input, true), 'b').bounds.x).toBeLessThan(child(r, 'b').bounds.x);
    expect(layoutLocationGrid(input)).toEqual(r);
  });
  it('keeps A/B/C vertical and D right of B with table-wide maxima in both dimensions', () => {
    const r = layoutLocationGrid(fixture());
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(id => child(r, id));
    expect(a.bounds.x).toBe(b.bounds.x); expect(c.bounds.x).toBe(b.bounds.x);
    expect(a.bounds.y).toBeLessThan(b.bounds.y); expect(b.bounds.y).toBeLessThan(c.bounds.y);
    expect(d.bounds.y).toBe(b.bounds.y); expect(d.bounds.x).toBe(b.bounds.x + b.bounds.width + 20);
    for (const frame of [a, b, c, d]) expect(size(frame)).toEqual({ width: 324, height: 204 });
    expect(size(child(r, 'empty'))).toEqual({ width: 100, height: 32 });
  });
  it('joins uniform sizing after the first object appears', () => {
    const input = fixture();
    const added = node('root', input.children.map(row => row.map(n => n?.id === 'empty' ? full('empty', 500) : n)));
    const r = layoutLocationGrid(added);
    for (const c of r.children) expect(size(c)).toEqual({ width: 524, height: 204 });
  });
  it('does not count empty canonical descendants as equipment', () => {
    const empty = node('empty', [[node('leaf')]]);
    const input = node('root', [[empty, full('filled')]]);
    expect(child(layoutLocationGrid(input), 'empty').populated).toBe(false);
    expect(layoutLocationGrid(input, true).children.map(c => c.id)).toEqual(['filled']);
    expect(layoutLocationGrid(empty, true).populated).toBe(false);
  });
  it('measures nested tables independently and contains their requirements', () => {
    const nested = node('nested', [[full('small'), full('small2')]]);
    const r = layoutLocationGrid(node('root', [[nested, full('large', 900, 500)]]));
    const n = child(r, 'nested');
    expect(size(n)).toEqual(size(child(r, 'large')));
    expect(size(child(n, 'small'))).toEqual({ width: 174, height: 94 });
    expect(child(n, 'small2').bounds.x + child(n, 'small2').bounds.width).toBeLessThan(n.bounds.width);
  });
  it('filters visibility without destroying slots and measures collapse before equalization', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const shown = layoutLocationGrid(input), hidden = layoutLocationGrid(input, true);
    expect(child(hidden, 'D').bounds.x).toBe(child(shown, 'D').bounds.x);
    expect(hidden.children.some(c => c.id === 'empty')).toBe(false);
    const collapsed = layoutLocationGrid({ ...input, collapsed: true });
    expect(collapsed.populated).toBe(true); expect(collapsed.children).toEqual([]);
    expect(size(collapsed)).toEqual(input.minimum);
    expect(layoutLocationGrid(input)).toEqual(shown);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('is repeatable, does not mutate frozen inputs, overlap siblings or scale equipment', () => {
    const input = fixture();
    const freeze = (v: unknown): void => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } };
    freeze(input);
    const r = layoutLocationGrid(input);
    expect(layoutLocationGrid(input)).toEqual(r);
    const check = (result: LocationGridResult): void => {
      const boxes = [...result.children.map(c => c.bounds), ...result.objects];
      for (const [i, a] of boxes.entries()) {
        expect(a.x + a.width).toBeLessThanOrEqual(result.bounds.width);
        expect(a.y + a.height).toBeLessThanOrEqual(result.bounds.height);
        for (const b of boxes.slice(i + 1)) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
      }
      result.children.forEach(check);
    };
    check(r);
    expect(child(r, 'A').objects[0]).toMatchObject({ width: 150, height: 70 });
    expect(child(r, 'D').objects[0]).toMatchObject({ width: 120, height: 180 });
  });
  it('rejects repeated identity and invalid measurements', () => {
    expect(() => layoutLocationGrid(node('root', [[node('x'), node('x')]]))).toThrow('Repeated Location');
    expect(() => layoutLocationGrid(full('bad', NaN))).toThrow('Invalid footprint');
  });
});
