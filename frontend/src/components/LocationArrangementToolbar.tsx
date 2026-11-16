import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { LocationArrangementArrows } from './LocationArrangementArrows';
import type { FlowRectangle } from '../topology/nodeFootprint';
import type { GridDirection } from '../topology/locationGridArrangement';
/** Measure the actual heading, including its actions. Both placements share
 * the selected frame's top edge; narrow frames use a compact outside corner. */
export function LocationArrangementToolbar({canvasRef,frame,uiScale,canMove,onMove}:{
  canvasRef:RefObject<HTMLDivElement|null>; frame:{locationId:string;bounds:FlowRectangle}; uiScale:number;
  canMove:(direction:GridDirection)=>boolean; onMove:(direction:GridDirection)=>void;
}) {
  const {screenToFlowPosition}=useReactFlow();
  const viewport=useViewport();
  const toolbar=useRef<HTMLDivElement>(null);
  const [placement,setPlacement]=useState({x:frame.bounds.x+frame.bounds.width,compact:true});
  useLayoutEffect(()=>{
    const owner=canvasRef.current?.querySelector(`[data-location-id="${CSS.escape(frame.locationId)}"]`);
    const heading=owner?.querySelector('.location-frame__heading') ?? owner;
    if(!owner || !heading || !toolbar.current) return;
    const update=()=>{
      const box=owner.getBoundingClientRect(), head=heading.getBoundingClientRect();
      const scale=viewport.zoom*uiScale;
      // Measure the row independent of the compact presentation.
      const buttons=toolbar.current!.querySelectorAll('button');
      const rowWidth=[...buttons].reduce((sum,b)=>sum+b.offsetWidth,0)+3*(buttons.length-1)+10;
      const boundary=owner.querySelector('.location-boundary-point')?.getBoundingClientRect();
      const start=head.right+4*scale, end=start+rowWidth*scale;
      const touchesBoundary=boundary && boundary.left<end && boundary.right>start && boundary.top<box.top+16*scale && boundary.bottom>box.top-16*scale;
      const compact=end>box.right-8*scale || Boolean(touchesBoundary);
      const x=screenToFlowPosition({x:compact?Math.max(box.right,head.right)+8*scale:start,y:box.top}).x;
      setPlacement(previous=>previous.x===x && previous.compact===compact?previous:{x,compact});
    };
    update();
    const observer=new ResizeObserver(update);observer.observe(heading);observer.observe(owner);
    return ()=>observer.disconnect();
  },[canvasRef,frame.locationId,frame.bounds.x,frame.bounds.y,frame.bounds.width,frame.bounds.height,uiScale,viewport.x,viewport.y,viewport.zoom,screenToFlowPosition]);
  return <div ref={toolbar} data-arrangement-location-id={frame.locationId} className={'location-arrangement-arrows nodrag nopan'+(placement.compact?' location-arrangement-arrows--compact':'')} style={{left:placement.x,top:frame.bounds.y,transform:`scale(${uiScale}) translateY(-50%)`,transformOrigin:'left top'}}><LocationArrangementArrows canMove={canMove} onMove={onMove}/></div>;
}
