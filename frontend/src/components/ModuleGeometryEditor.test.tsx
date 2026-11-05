import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { I18nProvider } from '../i18n';
import { ModuleGeometryEditor } from './ModuleGeometryEditor';
import type { ModuleGeometry } from '../topology/hardwareModules';
function Harness() {
 const [g,set] = useState<ModuleGeometry>({width:240,height:80,fill_color:'#64748b',endpoints:{a:{x:.1,y:.2},b:{x:.4,y:.6},c:{x:.9,y:.8}}});
 return <I18nProvider><ModuleGeometryEditor geometry={g} endpoints={['a','b','c'].map(key => ({key,display_name:key,kind:'NETWORK_PORT'}))} onChange={set}/><output data-testid="geometry">{JSON.stringify(g)}</output></I18nProvider>;
}
const value = () => JSON.parse(screen.getByTestId('geometry').textContent!);
describe('module geometry', () => {
 it('resizes and recolors without changing normalized coordinates', () => {
 render(<Harness/>); const positions=value().endpoints;
 fireEvent.change(screen.getByLabelText('Ширина'),{target:{value:'500'}});
 fireEvent.change(screen.getByLabelText('Высота'),{target:{value:'120'}});
 fireEvent.change(screen.getByLabelText('Цвет корпуса'),{target:{value:'#123456'}});
 expect(value()).toMatchObject({width:500,height:120,fill_color:'#123456',endpoints:positions});
 });
 it('aligns and distributes selected endpoints', () => {
 render(<Harness/>);
 // Selection uses the same pointer gesture as dragging; mock only SVG projection.
 Object.defineProperty(SVGSVGElement.prototype,'getScreenCTM',{configurable:true,value:()=>({inverse:()=>({})})});
 Object.defineProperty(globalThis,'DOMPoint',{configurable:true,value:class { constructor(public x=0, public y=0) {} matrixTransform(){return this;} }});
 Object.defineProperty(globalThis,'PointerEvent',{configurable:true,value:MouseEvent});
 SVGSVGElement.prototype.setPointerCapture=()=>{};
 fireEvent.pointerDown(screen.getByRole('button',{name:'a'})); fireEvent.pointerUp(screen.getByLabelText('Геометрия модуля',{selector:'svg'}));
 fireEvent.pointerDown(screen.getByRole('button',{name:'b'}),{shiftKey:true}); fireEvent.pointerUp(screen.getByLabelText('Геометрия модуля',{selector:'svg'}));
 fireEvent.pointerDown(screen.getByRole('button',{name:'c'}),{shiftKey:true}); fireEvent.pointerUp(screen.getByLabelText('Геометрия модуля',{selector:'svg'}));
 fireEvent.click(screen.getByText('Распределить по горизонтали'));
 expect(value().endpoints.b.x).toBeCloseTo(.5);
 fireEvent.click(screen.getByText('Выровнять по горизонтали'));
 expect(value().endpoints.a.y).toBeCloseTo(value().endpoints.c.y);
 const before=value().endpoints; const canvas=screen.getByLabelText('Геометрия модуля',{selector:'svg'});
 fireEvent.pointerDown(screen.getByRole('button',{name:'b'}),{clientX:0,clientY:0});
 fireEvent.pointerMove(canvas,{clientX:12,clientY:8}); fireEvent.pointerUp(canvas);
 expect(value().endpoints.a.x).toBeCloseTo(before.a.x+.05);
 expect(value().endpoints.c.y).toBeCloseTo(before.c.y+.1);
 fireEvent.pointerDown(screen.getByRole('button',{name:'b'}),{clientX:0,clientY:0});
 fireEvent.pointerMove(canvas,{clientX:99999,clientY:-99999}); fireEvent.pointerUp(canvas);
 for (const p of Object.values(value().endpoints) as {x:number;y:number}[]) {
   expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1);
   expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1);
 }
 const fit = canvas.getAttribute('viewBox');
 fireEvent.click(screen.getByRole('button',{name:'Приблизить'}));
 expect(canvas.getAttribute('viewBox')).not.toBe(fit);
 fireEvent.click(screen.getByRole('button',{name:'Общий вид'}));
 expect(canvas.getAttribute('viewBox')).toBe(fit);
 });
});
