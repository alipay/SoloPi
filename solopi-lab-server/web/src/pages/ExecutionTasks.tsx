import {taskListLoadTiming,recordTaskListRefresh} from '../api/task-list-timing';
import {PageHeaderActions} from '../components/PageHeaderActions';
import {TaskLiveScreens} from '../components/TaskLiveScreens';
import {BackLink} from '../components/BackLink';
import {Loader2,Check,AlertCircle} from 'lucide-react';
import {compareTaskTime,mergeClientTaskRefresh} from '../api/task-list-order';
import {readTaskWorkspaceCache,saveTaskWorkspaceCache} from '../api/task-workspace-cache';
import {readTaskListView,saveTaskListView} from '../api/task-list-view';
import {prefetchTask,seedTask} from '../api/task-navigation';
import {Status} from '@desktop-report/ReportWorkbench';
import {listClientTasks,nativeTaskLink,type ClientTask} from '../api/client-tasks';
import {NativeTaskReport} from './NativeTaskReport';
import {Fragment,useEffect,useRef,useState} from 'react';
import {lab,type Catalog,type Execution} from '../api/lab';
const names:Record<string,string>={success:'成功',stopped:'已停止',pending:'等待执行',stopping:'停止中',queued:'等待执行',running:'执行中',succeeded:'成功',failed:'失败',cancelled:'已停止',unknown:'正在核对执行结果'};
function RequestDetail(){
 const id=location.hash.slice('#/request/'.length),[value,setValue]=useState<{text:string;status:string;reason?:string;tasks:Execution[]}|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();const load=()=>lab<NonNullable<typeof value>>('requests/'+encodeURIComponent(id),undefined,c.signal).then(v=>{setValue(v);setSelected(x=>x||v.tasks[0]?.taskId||'');}).catch(e=>{if(!c.signal.aborted)setError(e.message);});void load();const timer=setInterval(load,2000);return()=>{c.abort();clearInterval(timer);};},[id]);
 const task=value?.tasks.find(t=>t.taskId===selected);
 return <><BackLink href="#/tasks">全部任务</BackLink><h1>执行请求</h1><p>{value?.text}</p><p>{value?.status==='planning'?'正在自动拆解任务…':names[value?.status||'']||value?.status}</p>{value?.reason&&<p>{value.reason}</p>}<nav className="execution-tabs">{value?.tasks.map(t=><button key={t.taskId} aria-pressed={selected===t.taskId} onClick={()=>setSelected(t.taskId)}>{t.group.name} · {names[t.status]}</button>)}</nav>{task&&<ExecutionDetail key={task.taskId} task={task}/>} {error&&<p role="alert">{error}</p>}</>;
}
export function ExecutionTasks(){
 const [hash,setHash]=useState(location.hash);useEffect(()=>{const navigate=()=>setHash(location.hash);window.addEventListener('hashchange',navigate);return()=>window.removeEventListener('hashchange',navigate);},[]);
 if(hash.startsWith('#/native-report?'))return <NativeTaskReport key={new URLSearchParams(hash.split('?')[1]).get('clientId')+':'+new URLSearchParams(hash.split('?')[1]).get('taskId')}/>;
 if(hash.startsWith('#/execution/'))return <LegacyExecutionRoute key={hash} taskId={decodeURIComponent(hash.split('?')[0].slice('#/execution/'.length))}/>;
 if(hash.startsWith('#/request/'))return <RequestDetail key={hash}/>;
 return <TaskWorkspace/>;
}
function LegacyExecutionRoute({taskId}:{taskId:string}){
 const [task,setTask]=useState<Execution|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();void lab<Execution>('tasks/'+encodeURIComponent(taskId),undefined,c.signal).then(value=>{if(value.taskId!==taskId)throw Error('任务标识不匹配');setTask(value);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[taskId]);
 return task?<NativeTaskReport clientId={task.clientId} taskId={task.taskId}/>:<section><BackLink href="#/tasks">全部任务</BackLink><p role={error?'alert':'status'}>{error||'正在读取任务…'}</p></section>;
}
function TaskWorkspace(){
 const openedAt=useRef(performance.now()),initialTiming=useRef<ReturnType<typeof taskListLoadTiming>|null>(null);
 const [refreshing,setRefreshing]=useState(true),[refreshIssue,setRefreshIssue]=useState('');
 const [snapshot]=useState(()=>{const cached=readTaskWorkspaceCache();return cached?.complete?cached:undefined;});
 const [catalogs,setCatalogs]=useState<Catalog[]>(snapshot?.catalogs||[]),[tasks,setTasks]=useState<Execution[]>(snapshot?.tasks||[]),[clientId,setClientId]=useState(''),[groupId,setGroupId]=useState(''),[caseIds,setCaseIds]=useState<string[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [lastUpdated,setLastUpdated]=useState<number|null>(snapshot?.cachedAt??null);
 const [initialView]=useState(readTaskListView);
 const table=useRef<HTMLDivElement>(null),restored=useRef(false);const [nativeLoaded,setNativeLoaded]=useState(snapshot?.complete||false);
 const [showCreate,setShowCreate]=useState(false),[taskQuery,setTaskQuery]=useState(initialView.taskQuery),[taskFilter,setTaskFilter]=useState(initialView.taskFilter),[computerFilter,setComputerFilter]=useState(initialView.computerFilter),[fromDate,setFromDate]=useState(initialView.fromDate),[toDate,setToDate]=useState(initialView.toDate);
 useEffect(()=>{saveTaskListView({taskQuery,taskFilter,computerFilter,fromDate,toDate});},[taskQuery,taskFilter,computerFilter,fromDate,toDate]);
 const pending=useRef<unknown>(null);
 const [nativeTasks,setNativeTasks]=useState<ClientTask[]>(snapshot?.nativeTasks||[]),[clientErrors,setClientErrors]=useState<string[]>([]);
 useEffect(()=>{if(nativeLoaded&&lastUpdated!==null)saveTaskWorkspaceCache({nativeTasks,catalogs,tasks,complete:true,cachedAt:lastUpdated});},[lastUpdated]);
 useEffect(()=>{
  const c=new AbortController();let timer:ReturnType<typeof setTimeout>;let first=true;
  const timing=taskListLoadTiming({startedAt:openedAt.current,hasCache:!!snapshot});initialTiming.current=timing;
  const load=async()=>{
   const initial=first;first=false;const started=performance.now();let outcome:'succeeded'|'failed'|'cancelled'='failed';let rows=0;
   setRefreshing(true);setRefreshIssue('');
   try{
    const response=await lab<{items:Catalog[]}>('catalog',undefined,c.signal);if(c.signal.aborted)return;
    setCatalogs(response.items);setClientId(old=>old||response.items[0]?.clientId||'');
    const results=await Promise.allSettled(response.items.map(client=>listClientTasks(client,c.signal)));if(c.signal.aborted)return;
    rows=results.reduce((n,r)=>n+(r.status==='fulfilled'?r.value.length:0),0);
    setNativeLoaded(true);setNativeTasks(previous=>mergeClientTaskRefresh(previous,response.items,results));
    const failures=results.flatMap((r,i)=>r.status==='rejected'?[response.items[i].hostname+'：'+String(r.reason?.message||r.reason)]:[]);
    setClientErrors(failures);if(failures.length)setRefreshIssue('部分电脑更新失败，保留上次结果');else{setLastUpdated(Date.now());outcome='succeeded';}
   }catch(e){if(!c.signal.aborted)setRefreshIssue((e as Error).message);}
   finally{
    if(c.signal.aborted)outcome='cancelled';
    if(initial)timing.settle('native',rows,outcome);else recordTaskListRefresh(started,outcome);
    if(!c.signal.aborted){setRefreshing(false);timer=setTimeout(()=>void load(),30000);}
   }
  };
  void load();return()=>{c.abort();clearTimeout(timer);timing.cancel();};
 },[]);
 useEffect(()=>{
  const c=new AbortController();let reading=false,first=true;const timing=initialTiming.current;
  const load=async()=>{
   if(reading)return;reading=true;const initial=first;first=false;let rows=0,success=false;
   try{const response=await lab<{items:Execution[]}>('tasks',undefined,c.signal);if(!c.signal.aborted){rows=response.items.length;success=true;setTasks(response.items);}}
   catch(e){if(!c.signal.aborted)setError((e as Error).message);}
   finally{reading=false;if(initial)timing?.settle('server',rows,c.signal.aborted?'cancelled':success?'succeeded':'failed');}
  };
  void load();const timer=setInterval(()=>void load(),3000);return()=>{c.abort();clearInterval(timer);};
 },[]);
 const catalog=catalogs.find(c=>c.clientId===clientId);
 const submit=async()=>{if(busy)return;const request=pending.current||{requestId:crypto.randomUUID(),clientId,groupId,caseIds,source:'manual'};pending.current=request;setBusy(true);try{const task=await lab<Execution>('tasks',request);pending.current=null;location.hash='#/execution/'+encodeURIComponent(task.taskId);setError('');}catch(e){setError((e as Error).message+'。请用原请求核对，避免重复创建。');}finally{setBusy(false);}};
 const allRows=!nativeLoaded?[]:[...nativeTasks.map(t=>({...t,url:nativeTaskLink(t.clientId,t.id),host:t.hostname})),...tasks.filter(t=>!nativeTasks.some(n=>n.clientId===t.clientId&&n.id===t.taskId)).map(t=>({id:t.taskId,name:t.name,status:t.status,clientId:t.clientId,host:t.group.name,hostname:t.group.name,url:nativeTaskLink(t.clientId,t.taskId),summary:undefined,updatedAt:new Date(t.updatedAt).toISOString()}))].sort(compareTaskTime);
 const visible=allRows.filter(t=>(taskFilter==='all'||(({succeeded:'success',cancelled:'stopped',queued:'pending',submitted:'pending'} as Record<string,string>)[t.status]||t.status)===taskFilter)&&(computerFilter==='all'||t.clientId===computerFilter)&&(!fromDate||Date.parse(t.updatedAt||'')>=Date.parse(fromDate))&&(!toDate||Date.parse(t.updatedAt||'')<=Date.parse(toDate))&&[t.name,t.id,t.host].join(' ').toLowerCase().includes(taskQuery.toLowerCase()));
 useEffect(()=>{if(!restored.current&&visible.length&&table.current){table.current.scrollTop=initialView.scrollTop;restored.current=nativeLoaded||table.current.scrollTop===initialView.scrollTop;}},[visible.length,initialView.scrollTop,nativeLoaded]);
 return <section className="execution-page"><PageHeaderActions><small className="header-count">{!nativeLoaded&&!allRows.length?'—':allRows.length} 个任务</small><button className="primary" aria-expanded={showCreate} onClick={()=>setShowCreate(v=>!v)}>{showCreate?'收起创建':'＋ 创建任务'}</button></PageHeaderActions>{showCreate&&<div className="execution-create"><h2>创建任务</h2><label>电脑<select value={clientId} disabled={!!pending.current} onChange={e=>{setClientId(e.target.value);setGroupId('');setCaseIds([]);}}>{catalogs.map(c=><option key={c.clientId} value={c.clientId}>{c.hostname}</option>)}</select></label><label>设备组<select value={groupId} disabled={!!pending.current} onChange={e=>setGroupId(e.target.value)}><option value="">选择设备组</option>{catalog?.groups.filter(g=>g.enabled!==false).map(g=><option key={g.groupId} value={g.groupId}>{g.alias||g.name}{g.code?' · '+g.code:''} · {g.members.length} 台设备</option>)}</select></label>{catalog&&!catalog.groups.length&&<p>该电脑尚未保存设备组，请先到<a href="#/devices">设备页</a>创建。</p>}<input aria-label="搜索用例" placeholder="搜索用例" value={query} onChange={e=>setQuery(e.target.value)}/><div className="execution-case-picker">{catalog?.cases.filter(c=>c.name.toLowerCase().includes(query.toLowerCase())).map(c=><label key={c.caseId}><input type="checkbox" disabled={!!pending.current} checked={caseIds.includes(c.caseId)} onChange={e=>setCaseIds(old=>e.target.checked?[...old,c.caseId]:old.filter(id=>id!==c.caseId))}/>{c.name}</label>)}</div><button className="primary" disabled={busy||!pending.current&&(!groupId||!caseIds.length)} onClick={()=>void submit()}>{busy?'提交中…':pending.current?'核对原请求':'执行所选用例'}</button></div>}{error&&<p role="alert">{error}</p>}{clientErrors.map(message=><p role="alert" key={message}>{message}（该 Client 的任务暂未读取，稍后重试）</p>)}<div className="task-browser"><div className="task-browser-toolbar"><input aria-label="搜索任务" placeholder="搜索任务名称、电脑或任务 ID…" value={taskQuery} onChange={e=>setTaskQuery(e.target.value)}/><label>电脑<select aria-label="筛选电脑" value={computerFilter} onChange={e=>setComputerFilter(e.target.value)}><option value="all">全部电脑</option>{[...new Map([...catalogs.map(c=>[c.clientId,c.hostname] as const),...nativeTasks.map(t=>[t.clientId,t.hostname] as const)]).entries()].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><label>开始时间<input type="datetime-local" aria-label="开始时间" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label><label>结束时间<input type="datetime-local" aria-label="结束时间" min={fromDate||undefined} value={toDate} onChange={e=>setToDate(e.target.value)}/></label><label>状态<select aria-label="筛选任务状态" value={taskFilter} onChange={e=>setTaskFilter(e.target.value)}>{['all','running','stopping','pending','failed','success','stopped'].map(state=><option key={state} value={state}>{state==='all'?'全部状态':names[state]}</option>)}</select></label>{(computerFilter!=='all'||fromDate||toDate||taskFilter!=='all'||taskQuery)&&<button onClick={()=>{setComputerFilter('all');setFromDate('');setToDate('');setTaskFilter('all');setTaskQuery('');}}>清除筛选</button>}<span className="task-list-meta"><span className={'task-list-sync'+(refreshIssue?' has-error':'')} role="status" aria-live="polite" title={(lastUpdated!==null?'上次完整更新：'+new Date(lastUpdated).toLocaleString('zh-CN')+'。':'')+(refreshIssue|| (refreshing&&snapshot?'先显示缓存，正在获取最新任务列表。':'任务列表在后台自动更新。'))}>{refreshing?<Loader2 size={14} className="task-list-sync-spin" aria-hidden="true"/>:refreshIssue?<AlertCircle size={14} aria-hidden="true"/>:<Check size={14} aria-hidden="true"/>}<span>{refreshing?'正在更新最新任务列表':refreshIssue?'更新失败，显示上次结果':'已更新'}</span></span><span>{!nativeLoaded?'—':visible.length} 个任务</span></span></div><div className="task-table-wrap" ref={table} onScroll={e=>saveTaskListView({scrollTop:e.currentTarget.scrollTop})}><table className="task-table"><thead><tr><th>任务名称</th><th>电脑 / 设备组</th><th>状态</th><th>结果</th><th>更新时间</th></tr></thead><tbody>{visible.map(t=><Fragment key={t.clientId+':'+t.id}><tr><td><a href={t.url} onPointerEnter={()=>{seedTask({...t,hostname:t.host});prefetchTask(t.clientId,t.id);}} onFocus={()=>{seedTask({...t,hostname:t.host});prefetchTask(t.clientId,t.id);}} onClick={()=>seedTask({...t,hostname:t.host})}>{t.name}</a><small>{t.id}</small></td><td>{t.host}</td><td><Status value={t.status}/></td><td>{t.summary?<><span className="task-pass">{t.summary.successCount??'—'} 成功</span><span className="task-fail">{t.summary.failedCount??'—'} 失败</span></>:'—'}</td><td>{t.updatedAt?new Date(t.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'}</td></tr>{['running','stopping'].includes(t.status)&&<tr className="task-live-row"><td colSpan={5}><TaskLiveScreens clientId={t.clientId} task={t}/></td></tr>}</Fragment>)}</tbody></table>{!visible.length&&<div className="task-empty">{!nativeLoaded?'正在读取任务列表…':taskQuery||taskFilter!=='all'||computerFilter!=='all'||fromDate||toDate?'没有匹配的任务':'暂无测试任务'}</div>}</div></div></section>;
}
function ExecutionDetail({task}:{task:Execution}){
 return <NativeTaskReport clientId={task.clientId} taskId={task.taskId}/>;
}
