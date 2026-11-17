import {useEffect,useRef,useState} from 'react';
import {downloadClientSupport,downloadServerSupport} from '../api/support-export';
export function SupportExportButton({clientId,taskId,caseId,label}:{clientId?:string;taskId?:string;caseId?:string;label?:string}){
 const [open,setOpen]=useState(false),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),controller=useRef<AbortController>();
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function run(kind:'server'|'runtime'|'case'){
  const c=new AbortController();controller.current=c;setBusy(true);setStatus('正在导出…');
  try{if(kind==='server')await downloadServerSupport(c.signal);else {const meta=await downloadClientSupport(clientId!,kind==='case'?{taskId,caseIds:[caseId!]}:{},c.signal,setStatus);const missing=meta.cases?.flatMap((row:any)=>row.missing||[])||[];if(missing.length){setStatus('已下载；部分产物缺失：'+missing.map((m:any)=>m.reason).join('；'));return;}}setStatus('已下载，可随问题反馈附上日志包。');}
  catch(e){if(!c.signal.aborted)setStatus((e as Error).message);else setStatus('已取消下载；测试任务继续执行。');}
  finally{setBusy(false);}
 }
 return <span style={{position:'relative'}}><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{label||(clientId?'导出日志':'诊断日志')}</button>{open&&<div style={{position:'absolute',right:0,top:'100%',zIndex:30,width:300,background:'#fff',border:'1px solid #dce3ee',borderRadius:8,padding:12,boxShadow:'0 8px 24px #17233b20'}}>
 <p style={{margin:'0 0 10px',fontSize:13,color:'#64748b'}}>诊断包不包含凭证和聊天正文。用例日志包包含当前 case 的设备业务日志。</p>
 <button disabled={busy} onClick={()=>void run('server')}>Server 诊断包</button>{' '}{clientId&&<button disabled={busy} onClick={()=>void run('runtime')}>Client 诊断包</button>}{caseId&&<button disabled={busy} onClick={()=>void run('case')}>当前用例日志包</button>}
 {status&&<p role="status" style={{fontSize:13,overflowWrap:'anywhere',margin:'10px 0 0'}}>{status}</p>}{busy&&<button onClick={()=>controller.current?.abort()}>取消下载</button>}
 </div>}</span>;
}
