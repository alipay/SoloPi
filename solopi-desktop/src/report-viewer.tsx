import { LanguageProvider } from './language';
import {createRoot} from 'react-dom/client';
import WorkflowEditor, {type WorkflowReportHost} from './components/WorkflowEditor';
import './index.css';

const pendingImages=new Map<string,{resolve:(value:unknown)=>void;timer:ReturnType<typeof setTimeout>}>();
let visibleTask:any;const observedCases=new Set<string>();
const observer=new IntersectionObserver(entries=>{for(const entry of entries){const id=(entry.target as HTMLElement).dataset.reportCaseId;if(!entry.isIntersecting){if(id)observedCases.delete(id);continue;}if(!id||observedCases.has(id))continue;observedCases.add(id);window.parent.postMessage({type:'desktop-report-visible-case',taskId:visibleTask?.id,selectedCaseId:id},location.origin)}},{rootMargin:'120px'});
new MutationObserver(()=>document.querySelectorAll('[data-report-case-id]').forEach(el=>observer.observe(el))).observe(document.getElementById('root')!,{childList:true,subtree:true});
const root=createRoot(document.getElementById('root')!);
// Same-origin, parent-only messaging. This host intentionally exposes no Electron
// bridge: report viewing cannot load/save a library, submit tasks or control devices.
window.addEventListener('message', event=>{
 if(event.source!==window.parent || event.origin!==location.origin)return;
 if(event.data?.type==='desktop-report-image-result'){const p=pendingImages.get(event.data.id);if(p){clearTimeout(p.timer);pendingImages.delete(event.data.id);p.resolve(event.data.result)}return}
 if(event.data?.type!=='desktop-report')return;
 const {task,caseId}=event.data;
 if(visibleTask?.id!==task?.id||visibleTask?.evidenceRevision!==task?.evidenceRevision){observedCases.clear();observer.disconnect();requestAnimationFrame(()=>document.querySelectorAll('[data-report-case-id]').forEach(el=>observer.observe(el)));}visibleTask=task;
 if(!task?.id || !Array.isArray(task.cases) || caseId && !task.cases.some((c:any)=>c.caseId===caseId&&c.caseSnapshot))return;
 const send=(type:string,path?:string,selectedCaseId?:string)=>window.parent.postMessage({type,taskId:task.id,caseId,path,selectedCaseId},location.origin);
 const host:WorkflowReportHost={task:{...task,readonly:true,imported:true},caseId,onCase:id=>send('desktop-report-case',undefined,id),onBack:()=>send('desktop-report-back'),onArtifact:path=>send('desktop-report-artifact',path),readImage:async(_channel,{path})=>{const id=crypto.randomUUID();return new Promise(resolve=>{const timer=setTimeout(()=>{pendingImages.delete(id);resolve({success:false})},30000);pendingImages.set(id,{resolve,timer});window.parent.postMessage({type:'desktop-report-read-image',taskId:task.id,caseId,path,id},location.origin)})}};
 root.render(<LanguageProvider><WorkflowEditor key={task.id+':'+caseId} reportHost={host}/></LanguageProvider>);
});
window.parent.postMessage({type:'desktop-report-ready'},location.origin);
