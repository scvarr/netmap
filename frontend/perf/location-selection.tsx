import { AutomaticLocationControls } from '../src/components/AutomaticLocationControls';
import { useLocationGridArrangement } from '../src/components/useLocationGridArrangement';
// Isolated integrated canvas fixture: real React Flow, TopologyCanvas and rendering;
// persistence is in-memory so this browser check never touches a user map.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ReactFlowProvider,useReactFlow} from '@xyflow/react';
import {TopologyCanvas} from '../src/components/TopologyCanvas';
import {I18nProvider} from '../src/i18n';
import '../src/styles.css';
const ref=(id:string,type='Location')=>({ref_type:'CANONICAL_FACT',entity_type:type,entity_id:id});
const locations=[['A',null],['inner','A'],['inner2','A'],['B',null],['C',null]].map(([id,parent])=>({location_ref:ref(id!),name:id==='inner'?'U16':id==='inner2'?'U20':id!,parent_location_ref:parent?ref(parent):null}));
const topologyDocument={schema_version:'1.0',layer:'L1',detail_level:'PHYSICAL_OBJECT',nodes:['one','two'].map(id=>({id,kind:'PHYSICAL_OBJECT',label:id,source_refs:[ref(id,'PhysicalObject')],attributes:{}})),edges:[],gaps:[],warnings:[]};
const placements=[{physical_object_ref:ref('one','PhysicalObject'),location_ref:ref('inner'),positions:{}},{physical_object_ref:ref('two','PhysicalObject'),location_ref:ref('C'),positions:{}}];
const engine=async(scene:any)=>({nodes:scene.nodes.map((projection:any)=>({id:projection.id,type:'device',width:212,height:144,position:{x:0,y:0},data:{projection}})),edges:[]});
const store={load:()=>null,save:()=>{},clear:()=>{}};
function App(){
 const [settings,setSettings]=useState<any>({mode:'uniform_grid',version:1,hide_empty:false,tables:{root:[['A'],['B'],['C']],A:[['inner'],['inner2']]}});
 const [selection,setSelection]=useState<any>(null),[saves,setSaves]=useState(0),[actions,setActions]=useState(''),[variant,setVariant]=useState('one');
 const flow=useReactFlow();
 const save=async(next:any)=>{setSaves(n=>n+1);setSettings(next);};
 const arrangement=useLocationGridArrangement({automatic:settings,variantId:variant,locations:locations as any,onAutomaticLayout:save},'selection-smoke');
 const map={active_variant_ref:{entity_id:variant},variants:[{variant_ref:{entity_id:variant},automatic_layout:settings}],placements};
 return <><div style={{height:40}}>{[.35,1,4].map(zoom=><button key={zoom} onClick={()=>{const owner=window.document.querySelector('.location-frame--arrangement-selected,.location-proxy--arrangement-selected');const box=(owner?.querySelector('.location-frame__heading')??owner)?.getBoundingClientRect();const p=box?flow.screenToFlowPosition({x:box.right,y:box.top}):{x:0,y:0};flow.setViewport({x:box?700-p.x*zoom:150,y:box?350-p.y*zoom:150,zoom});}}>zoom {zoom}</button>)}<button onClick={()=>setVariant(v=>v==='one'?'two':'one')}>variant</button><output data-testid="object">{selection?.item?.id??''}</output><output data-testid="actions">{actions}</output><output data-testid="saves">{saves}</output><output data-testid="saved">{JSON.stringify(settings.tables)}</output></div><section aria-label="Компоновка" style={{position:"relative",zIndex:20,background:"#0a1518",height:150}}><AutomaticLocationControls map={map as any} locations={locations as any} onSave={save} arrangement={arrangement}/></section><div style={{height:1000,width:1400}}><TopologyCanvas arrangement={arrangement} document={topologyDocument as any} sceneKey="selection-smoke" selection={selection} onSelectionChange={setSelection} layoutEngine={engine} layoutStore={store as any} disableAutoLayout locationFrameInput={{automatic:settings,variantId:variant,locations:locations as any,placements,states:[{location_ref:ref('B'),collapsed:true,visible_direct_elements:[]}],onCollapse:id=>setActions('collapse:'+id),onConfigure:id=>setActions('configure:'+id),onBoundaryPlacement:async()=>{setActions('boundary');}}}/></div></>;
}
createRoot(document.getElementById('root')!).render(<I18nProvider><ReactFlowProvider><App/></ReactFlowProvider></I18nProvider>);
