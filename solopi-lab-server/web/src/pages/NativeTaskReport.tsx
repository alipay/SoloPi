import {readSubmissionFailure,type SubmissionFailure as Failure} from '../api/submission-failure';
import {SubmissionFailure} from '../components/SubmissionFailure';
import {PageHeaderActions} from '../components/PageHeaderActions';
import {TaskLiveScreens} from '../components/TaskLiveScreens';
import {BackLink} from '../components/BackLink';
import {useEffect,useMemo,useRef,useState} from 'react';
import {firstTaskPage,taskSeed,clearTaskNavigation} from '../api/task-navigation';
import {readCaseLogDownload,clearLogDownloadCache} from '../api/support-export';
import {lab} from '../api/lab';
import {readDesktop} from '../api/client-task-read';
import {loadTaskPerformance} from '../api/task-performance';
import {DesktopReportFrame} from '../components/DesktopReportFrame';
import {DesktopReportArtifact} from '../components/DesktopReportArtifact';
import {completedMediaCache,invalidateCompletedReport,isCompletedReport,readCompletedReport,saveCompletedReport} from '../api/report-cache';
import {createEvidenceReader} from '@desktop-report/evidence-reader';
// Bounded, short lived cache for navigation within the same report. Manual
// refresh bypasses it; running reports continue their normal polling.
const reportCache=new Map<string,{at:number;value:any}>();
export const clearNativeReportCache=(persistent=true)=>{reportCache.clear();clearTaskNavigation();if(persistent)invalidateCompletedReport();};
const remember=(key:string,value:any)=>{if(isCompletedReport(value.status||value.identity?.status))saveCompletedReport(key,value);reportCache.delete(key);reportCache.set(key,{at:Date.now(),value});while(reportCache.size>100)reportCache.delete(reportCache.keys().next().value!);};
const cached=(key:string)=>{const entry=reportCache.get(key);if(entry&&Date.now()-entry.at<(isCompletedReport(entry.value.status||entry.value.identity?.status)?7*86400000:10000))return entry.value;const stored=readCompletedReport(key);if(stored){reportCache.set(key,{at:Date.now(),value:stored});return stored;}return null;};
async function loadCase(clientId:string,taskId:string,caseId:string,reader:ReturnType<typeof createEvidenceReader>,signal:AbortSignal,onDetails?:(summary:any)=>void){
  const valid=(page:any)=>{if(page.identity?.taskId!==taskId||page.identity?.caseId!==caseId)throw Error('Client case identity mismatch');return page;};
  const details=async()=>{
   const results:any[]=[];let offset:number|null=0,summary:any,snapshot:any;
   do{summary=valid(await readDesktop(clientId,'read_case_results',{taskId,caseId,view:'details',detailMode:'full',includeSnapshot:offset===0,offset,limit:20},signal));snapshot??=summary.caseSnapshot;results.push(...summary.results);const next=summary.nextOffset;if(next!=null&&next<=offset!)throw Error('用例分页未推进');offset=next??null;}while(offset!==null);
   return {...summary,caseSnapshot:snapshot,results,detailsLoaded:true};
  };
  const attachments=async()=>{
   const artifacts:Record<string,any[]>={};let offset:number|null=0;
   do{const page=valid(await readDesktop(clientId,'read_case_results',{taskId,caseId,view:'artifacts',includeMediaPreviews:true,offset,limit:20},signal));reader.prime?.((page.mediaPreviews||[]).map((item:any)=>{const r=valid(item.result);return {caseId,kind:item.ref.kind,index:item.ref.index,...(r.preview?{preview:true}:{}),mime:r.mime,data:r.data};}));for(const item of page.artifacts||[])(artifacts[item.ref.kind]??=[])[item.ref.index]=item.detail;const next=page.nextOffset;if(next!=null&&next<=offset!)throw Error('附件分页未推进');offset=next??null;}while(offset!==null);
   return artifacts;
  };
 const d=details(),a=attachments();void a.then(artifacts=>reader.prefetch?.(caseId,{screenshots:artifacts.screenshots||[]},signal)).catch(()=>{});if(onDetails)void d.then(onDetails).catch(()=>{});const [summary,artifacts]=await Promise.all([d,a]);return {...summary,detailsLoaded:true,artifactsLoading:false,nativeArtifacts:{logs:summary.identity.logs||[],...artifacts}};
}
export function NativeTaskReport(props:{clientId?:string;taskId?:string}={}){
 const [rejection,setRejection]=useState<{owner:string;task:Failure}|null>(null);
 const [performanceState,setPerformanceState]=useState<any>(null);
 const [artifactOwner,setArtifactOwner]=useState('');
 const [hydrated,setHydrated]=useState<Record<string,any>>({});
 const [caseErrors,setCaseErrors]=useState<Record<string,string>>({});
 const hydration=useRef({jobs:new Map<string,Promise<void>>(),lanes:[Promise.resolve(),Promise.resolve()],next:0,controller:new AbortController(),urls:new Set<string>()});
 useEffect(()=>()=>{hydration.current.controller.abort();for(const url of hydration.current.urls)URL.revokeObjectURL(url)},[]);
 const [routeHash,setRouteHash]=useState(location.hash);
 useEffect(()=>{const navigate=()=>setRouteHash(location.hash);window.addEventListener('hashchange',navigate);return()=>window.removeEventListener('hashchange',navigate)},[]);
 const q=new URLSearchParams(routeHash.split('?')[1]||''),clientId=props.clientId||q.get('clientId')||'',taskId=props.taskId||q.get('taskId')||'',caseId=q.get('caseId')||'';
 const [task,setTask]=useState<any>(()=>{const saved=cached(JSON.stringify([clientId,taskId]));if(saved)return saved;const seed=taskSeed(clientId,taskId);return seed?{...seed,cases:[],indexLoading:true}:null;}),[report,setReport]=useState<any>(null),[refresh,setRefresh]=useState(0),[error,setError]=useState(''),[artifactPath,setArtifactPath]=useState(''),[evidenceRevision,setEvidenceRevision]=useState(0);
 useEffect(()=>{
  const h=hydration.current;h.controller.abort();h.controller=new AbortController();h.jobs.clear();h.lanes=[Promise.resolve(),Promise.resolve()];h.next=0;setHydrated({});setCaseErrors({});
  return()=>h.controller.abort();
 },[clientId,taskId]);
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  void (async()=>{
   if(!clientId||!taskId)throw Error('链接缺少 clientId 或 taskId');
   const cacheKey=JSON.stringify([clientId,taskId]);const saved=refresh===0?cached(cacheKey):null;if(saved){setTask(saved);if(!['success','failed','stopped','cancelled','succeeded'].includes(saved.status))timer=setTimeout(()=>setRefresh(x=>x+1),5000);return;}
   const cases:any[]=[];let offset:number|null=0,overview:any;
   do{const result=offset===0?await firstTaskPage(clientId,taskId,refresh>0):await readDesktop(clientId,'read_task_report',{taskId,view:'cases',offset,limit:200},controller.signal);overview=result.task;if(overview?.id!==taskId)throw Error('Desktop 返回了其他任务');cases.push(...overview.cases);const next=overview.nextOffset;if(next!=null&&next<=offset!)throw Error('报告分页未推进');offset=next??null;if(!controller.signal.aborted)setTask({...overview,cases:[...cases],indexLoading:next!=null});}while(offset!==null);
   if(!controller.signal.aborted){const value={...overview,cases,indexRevision:refresh};remember(cacheKey,value);setTask(value);if(!['success','failed','stopped','cancelled','succeeded'].includes(overview.status))timer=setTimeout(()=>setRefresh(x=>x+1),5000);}
  })().catch(async e=>{
   if(controller.signal.aborted)return;
   if(e.code==='REPORT_DETAIL_NOT_FOUND'){
    try{const failure=await readSubmissionFailure(clientId,taskId,controller.signal);if(!controller.signal.aborted&&failure){setRejection({owner:JSON.stringify([clientId,taskId]),task:failure});setError('');return;}}catch{/* Keep the original report error when no matching rejection receipt is available. */}
   }
   if(!controller.signal.aborted)setError(e.message);
  });
  return()=>{controller.abort();clearTimeout(timer);};
 },[clientId,taskId,refresh]);
 useEffect(()=>{
  const controller=new AbortController(),owner=JSON.stringify([clientId,taskId]),key=JSON.stringify([clientId,taskId,'@performance','v1']);
  const saved=refresh===0?cached(key):null;
  if(saved){setPerformanceState({...saved,status:undefined,owner});return;}
  setPerformanceState({owner,performanceLoading:{phone:true,glasses:true}});
  void loadTaskPerformance(clientId,taskId,controller.signal).then(value=>{
   if(controller.signal.aborted)return;
   if(!Object.keys(value.performanceErrors).length)remember(key,value);
   setPerformanceState({...value,status:undefined,owner});
  }).catch(e=>{if(!controller.signal.aborted)setPerformanceState({owner,performanceErrors:{phone:e.message,glasses:e.message}})});
  return()=>controller.abort();
 },[clientId,taskId,refresh]);
 useEffect(()=>{
  setReport((old:any)=>old?.identity?.caseId===caseId&&old?.identity?.taskId===taskId?old:null);if(!caseId)return;
  const controller=new AbortController();setError('');
  const cacheKey=JSON.stringify([clientId,taskId,caseId]);const saved=refresh===0?cached(cacheKey):null;
  if(saved){setReport(saved);return;}
  const partial=hydrated[caseId];if(partial?.detailsLoaded)setReport(partial);
  const job=refresh===0?hydration.current.jobs.get(caseId):undefined;
  void (job?job.then(()=>cached(cacheKey)):loadCase(clientId,taskId,caseId,reader,controller.signal,summary=>{if(!controller.signal.aborted)setReport({...summary,detailsLoaded:true,artifactsLoading:true,nativeArtifacts:{logs:summary.identity.logs||[],loading:true}})})).then(value=>{if(!controller.signal.aborted&&value){remember(cacheKey,value);setReport(value)}}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
  return()=>controller.abort();
 },[clientId,taskId,caseId,refresh]);


 const mediaCache=useMemo(()=>completedMediaCache(JSON.stringify([clientId,taskId])),[clientId,taskId,evidenceRevision]);
 const terminal=isCompletedReport(task?.status);
 const terminalRef=useRef(terminal);terminalRef.current=terminal;
 const reader=useMemo(()=>({...createEvidenceReader(taskId,(tool,args,signal)=>readDesktop(clientId,tool,args,signal),{get:async key=>terminalRef.current?mediaCache.get(key):undefined,set:async(key,value)=>{if(terminalRef.current)await mediaCache.set(key,value)}}),diagnostic:(value:{event:string;stage:string;caseId:string;durationMs:number;code?:string})=>{void lab('diagnostics/events',{event:value.event,requestId:crypto.randomUUID(),clientId,taskId,caseId:value.caseId,stage:value.stage,durationMs:value.durationMs,toolName:value.stage,status:value.code?'failed':'succeeded',code:value.code},AbortSignal.timeout(3000)).catch(()=>{});}}),[clientId,taskId,evidenceRevision]);
 const cases=(task?.cases||[]).map((row:any)=>(()=>{const full=row.caseId===caseId?report:hydrated[row.caseId]||cached(JSON.stringify([clientId,taskId,row.caseId]));return full?{...row,...full,caseId:row.caseId,caseName:row.name||full.caseName,caseSnapshot:full.caseSnapshot,artifacts:full.nativeArtifacts,detailLoading:!full.detailsLoaded&&!caseErrors[row.caseId],artifactsLoading:!!full.artifactsLoading&&!caseErrors[row.caseId],detailError:caseErrors[row.caseId]}:{...row,caseName:row.name||row.caseName,detailLoading:!caseErrors[row.caseId],artifactsLoading:!caseErrors[row.caseId],detailError:caseErrors[row.caseId]}})());
 if(caseId&&report&&!cases.some((r:any)=>r.caseId===caseId))cases.push({...report,caseId,caseName:report.caseName||caseId,artifacts:report.nativeArtifacts});
 const navigate=(id?:string)=>{location.hash='#/native-report?'+new URLSearchParams({clientId,taskId,...(id?{caseId:id}:{})});};
 const rememberHydrated=(id:string,value:any)=>setHydrated(p=>{const next={...p,[id]:value};while(Object.keys(next).length>32)delete next[Object.keys(next)[0]];return next});
 const hydrateVisible=(id:string)=>{
  if(caseId||!task?.cases?.some((c:any)=>c.caseId===id)||hydration.current.jobs.has(id))return;
  const cacheKey=JSON.stringify([clientId,taskId,id]),saved=refresh===0?cached(cacheKey):null;if(saved){if(hydrated[id]!==saved)rememberHydrated(id,saved);return}
  const h=hydration.current,signal=h.controller.signal,lane=h.next++%2;const job=h.lanes[lane].then(async()=>{signal.throwIfAborted();const value=await loadCase(clientId,taskId,id,reader,signal,summary=>{if(!signal.aborted)rememberHydrated(id,{...summary,detailsLoaded:true,artifactsLoading:true,nativeArtifacts:{logs:summary.identity.logs||[],loading:true}})});if(signal.aborted)return;remember(cacheKey,value);rememberHydrated(id,value)});h.lanes[lane]=job.catch(()=>{});h.jobs.set(id,job);void job.catch(e=>{if(!signal.aborted)setCaseErrors(p=>({...p,[id]:e.message||'详情加载失败，请刷新重试'}));}).finally(()=>h.jobs.delete(id));
 };
 const openImage=async(path:string)=>{const owner=cases.find((c:any)=>c.artifacts?.screenshots?.some((a:any)=>a.path===path));if(!owner)throw Error('截图不属于当前报告');const index=owner.artifacts.screenshots.findIndex((a:any)=>a.path===path);const r=await reader.artifact({caseId:owner.caseId,kind:'screenshots',index},hydration.current.controller.signal);hydration.current.urls.add(r.url);while(hydration.current.urls.size>128){const old=hydration.current.urls.values().next().value!;URL.revokeObjectURL(old);hydration.current.urls.delete(old)}return r.url};
 const openArtifact=(path:string)=>{const matches=cases.filter((c:any)=>(!caseId||c.caseId===caseId)&&Object.values(c.artifacts||{}).some(items=>Array.isArray(items)&&items.some(a=>(a.path||a.outputPath||a.filePath)===path)));if(matches.length>1){setError('产物归属不唯一，请先打开对应用例');return;}setArtifactOwner(matches[0]?.caseId||caseId);setArtifactPath(path);};
 const selectedArtifactCase=cases.find((c:any)=>c.caseId===(artifactOwner||caseId));

 if(rejection?.owner===JSON.stringify([clientId,taskId]))return <SubmissionFailure task={rejection.task} onRefresh={()=>{setRejection(null);setError('');setRefresh(x=>x+1)}}/>;
 const displayTask=task||report&&{id:taskId,name:taskSeed(clientId,taskId)?.name||'测试任务',status:'unknown',cases};
 if(!displayTask||caseId&&!report)return <div className="native-loading" role={error?'alert':'status'}>{error||(caseId?'正在读取用例执行记录…':'正在读取 Client 任务…')}</div>;
 return <div className="native-report-page native-original-desktop"><PageHeaderActions><BackLink href={caseId?'#/native-report?'+new URLSearchParams({clientId,taskId}):'#/tasks'}>{caseId?'任务报告':'全部任务'}</BackLink><div><button onClick={async()=>{setError('');setCaseErrors({});clearLogDownloadCache(clientId,taskId);hydration.current.controller.abort();invalidateCompletedReport(clientId,taskId);for(const key of reportCache.keys()){const parts=JSON.parse(key);if(parts[0]===clientId&&parts[1]===taskId)reportCache.delete(key);}await mediaCache.clear();hydration.current.controller=new AbortController();hydration.current.jobs.clear();hydration.current.lanes=[Promise.resolve(),Promise.resolve()];setHydrated({});setEvidenceRevision(x=>x+1);setRefresh(x=>x+1)}}>刷新报告</button></div></PageHeaderActions>{['running','stopping'].includes(displayTask.status)&&<TaskLiveScreens key={clientId+':'+taskId} clientId={clientId} task={displayTask}/ >}{error&&<p role="alert">{error}</p>}{artifactPath&&(artifactOwner||caseId)&&<DesktopReportArtifact key={(artifactOwner||caseId)+artifactPath} path={artifactPath} caseId={artifactOwner||caseId} artifacts={selectedArtifactCase?.artifacts} reader={reader} downloadLog={(deviceType,ordinal,signal,progress)=>readCaseLogDownload(clientId,taskId,artifactOwner||caseId,deviceType,ordinal,signal,progress)} onClose={()=>setArtifactPath('')}/>}<DesktopReportFrame task={{...displayTask,...(performanceState?.owner===JSON.stringify([clientId,taskId])?performanceState:{performanceLoading:{phone:true,glasses:true}}),id:taskId,status:displayTask.status,cases,evidenceRevision}} caseId={caseId||undefined} onCase={id=>{setArtifactPath('');navigate(id)}} onBack={()=>{setArtifactPath('');caseId?navigate():location.hash='#/tasks'}} onArtifact={openArtifact} onVisible={hydrateVisible} onImage={openImage}/></div>;
}
