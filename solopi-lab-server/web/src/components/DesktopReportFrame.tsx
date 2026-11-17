import {useEffect,useRef,useState} from 'react';
// Transport only. The iframe bundles the original Desktop WorkflowEditor report,
// including its existing task report, flow canvas, node configuration and output.
export function DesktopReportFrame({task,caseId,onCase,onBack,onArtifact,onVisible,onImage}:{task:any;caseId?:string;onCase:(id:string)=>void;onBack:()=>void;onArtifact:(path:string)=>void;onVisible?:(id:string)=>void;onImage?:(path:string)=>Promise<string>}){
 const [loading,setLoading]=useState(true);
 const frame=useRef<HTMLIFrameElement>(null),ready=useRef(false);
 const send=()=>{if(ready.current)frame.current?.contentWindow?.postMessage({type:'desktop-report',caseId,task:{...task,readonly:true,imported:true,reportDetailLoaded:task.indexLoading!==true}},location.origin)};
 useEffect(()=>{send()},[task,caseId]);
 useEffect(()=>{const receive=(event:MessageEvent)=>{
  if(event.source!==frame.current?.contentWindow||event.origin!==location.origin)return;
  if(event.data?.type==='desktop-report-ready'){ready.current=true;setLoading(false);send();return}
  if(event.data?.taskId!==task.id||event.data?.caseId!==caseId)return;
  if(event.data.type==='desktop-report-visible-case'&&task.cases.some((c:any)=>c.caseId===event.data.selectedCaseId))onVisible?.(event.data.selectedCaseId);
  if(event.data.type==='desktop-report-read-image'&&typeof event.data.path==='string'&&typeof event.data.id==='string'&&onImage){const request=event.data;void onImage(request.path).then(dataUrl=>frame.current?.contentWindow?.postMessage({type:'desktop-report-image-result',id:request.id,result:{success:true,dataUrl}},location.origin),()=>frame.current?.contentWindow?.postMessage({type:'desktop-report-image-result',id:request.id,result:{success:false}},location.origin));}
  if(event.data.type==='desktop-report-case'&&typeof event.data.selectedCaseId==='string'&&task.cases.some((c:any)=>c.caseId===event.data.selectedCaseId))onCase(event.data.selectedCaseId);
  if(event.data.type==='desktop-report-back')onBack();
  if(event.data.type==='desktop-report-artifact'&&typeof event.data.path==='string')onArtifact(event.data.path);
 };window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[task,caseId,onCase,onBack,onArtifact,onVisible,onImage]);
 return <>{loading&&<div role="status" aria-live="polite" className="native-loading">正在加载报告内容…</div>}<iframe aria-busy={loading} className="native-desktop-report-frame" ref={frame} title="Desktop 原生测试报告" src="./desktop-report.html" onLoad={()=>{ready.current=true;send()}}/></>;
}
