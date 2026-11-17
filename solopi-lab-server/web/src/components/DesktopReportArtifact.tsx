import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {EvidenceReader} from '@desktop-report/ReportWorkbench';
type FileResult={url:string;mime:string};
export function DesktopReportArtifact({path,caseId,artifacts,reader,onClose,downloadLog}:{path:string;caseId:string;artifacts:any;reader:EvidenceReader;onClose:()=>void;downloadLog?:(deviceType:string,ordinal:number,signal:AbortSignal,progress?:(text:string)=>void)=>Promise<FileResult>}){
 const [value,setValue]=useState<{url?:string;mime?:string;text?:string;nextLine?:number|null;error?:string}>({}),[line,setLine]=useState(1),[history,setHistory]=useState<number[]>([]),[retry,setRetry]=useState(0),[downloading,setDownloading]=useState(false),[downloadError,setDownloadError]=useState(''),[downloadProgress,setDownloadProgress]=useState(''),[mediaReady,setMediaReady]=useState(false);
 const panel=useRef<HTMLElement>(null),downloadController=useRef<AbortController>();
 const kind=['logs','recordings','screenshots'].find(k=>artifacts?.[k]?.some((x:any)=>(x.path||x.outputPath||x.filePath)===path)),index=kind?artifacts[kind].findIndex((x:any)=>(x.path||x.outputPath||x.filePath)===path):-1;
 const artifact=kind&&index>=0?artifacts[kind][index]:undefined;
 const deviceType=artifact?.deviceType||artifact?.role||'glasses';
 const title=kind==='logs'?'设备日志':kind==='recordings'?'用例录屏':'校验截图';
 const filename=path.split(/[\\/]/).pop()||'artifact';
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';panel.current?.focus();
  return()=>{document.body.style.overflow=overflow;previous?.focus?.();downloadController.current?.abort();};
 },[]);
 useEffect(()=>{const c=new AbortController();let url='';setValue({});setMediaReady(false);void(async()=>{
  if(!kind||index<0)throw Error('该文件不属于当前用例');if(artifact.success===false)throw Error(artifact.error||artifact.errorCode||'此产物未生成');
  if(kind==='logs'){const r=await reader.log({caseId,deviceType,query:'',fromLine:line},c.signal);if(!c.signal.aborted)setValue(r);}
  else{const r=await reader.artifact({caseId,kind:kind as 'recordings'|'screenshots',index},c.signal);if(c.signal.aborted){URL.revokeObjectURL(r.url);return;}url=r.url;setValue(r);}
 })().catch(e=>{if(!c.signal.aborted)setValue({error:e.message})});return()=>{c.abort();if(url)URL.revokeObjectURL(url)};},[path,caseId,reader,kind,index,line,retry]);
 const download=async()=>{
  if(downloadController.current||!kind||index<0||artifact.success===false)return;
  const c=new AbortController();downloadController.current=c;setDownloading(true);setDownloadError('');setDownloadProgress('正在准备日志…');
  try{let file:FileResult,name=filename;
   if(kind==='logs'){
    if(!downloadLog)throw Error('日志下载能力暂不可用');
    const ordinal=artifacts.logs.slice(0,index).filter((a:any)=>(a.deviceType||a.role||'glasses')===deviceType).length;
    file=await downloadLog(deviceType,ordinal,c.signal,text=>{if(!c.signal.aborted)setDownloadProgress(text)});if(!name.endsWith('.gz'))name+='.gz';
   }else file=await reader.artifact({caseId,kind:kind as 'recordings'|'screenshots',index,original:true},c.signal);
   if(c.signal.aborted){URL.revokeObjectURL(file.url);return;}
   const link=document.createElement('a');link.href=file.url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(file.url),30000);
  }catch(e){if(!c.signal.aborted)setDownloadError(e instanceof Error?e.message:'下载失败');}
  finally{downloadController.current=undefined;if(!c.signal.aborted)setDownloading(false);}
 };
 const keys=(event:React.KeyboardEvent)=>{
  if(event.key==='Escape'){event.preventDefault();onClose();return;}
  if(event.key!=='Tab')return;
  const controls=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],video[controls],[tabindex="0"]');if(!controls?.length){event.preventDefault();return;}
  const first=controls[0],last=controls[controls.length-1],active=document.activeElement;
  if(event.shiftKey&&(active===first||active===panel.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&(active===last||active===panel.current)){event.preventDefault();first.focus();}
 };
 return createPortal(<div className="artifact-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="执行产物查看" className="artifact-modal" onKeyDown={keys}>
  <header><div><strong>{title}</strong><small title={filename}>{filename}</small></div><div className="artifact-modal-actions"><button type="button" aria-label={downloading?'正在下载产物':'下载产物'} title="下载产物" disabled={downloading||!artifact||artifact.success===false} onClick={()=>void download()}>{downloading?<span role="status">下载中…</span>:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>}</button><button type="button" aria-label="关闭产物" title="关闭" onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></header>
  {downloading&&<p role="status" className="artifact-modal-progress">{downloadProgress}</p>}
  {downloadError&&<p role="alert" className="artifact-modal-error">{downloadError}</p>}
  <div className="artifact-modal-content" aria-busy={!value.error&&value.text===undefined&&!value.url}>
   {value.error?<div role="alert"><p>{value.error}</p><button onClick={()=>setRetry(x=>x+1)}>重新加载</button></div>:value.text!==undefined?<><pre tabIndex={0}>{value.text||'此页暂无日志'}</pre><footer><button disabled={!history.length} onClick={()=>{setLine(history[history.length-1]);setHistory(h=>h.slice(0,-1))}}>上一页日志</button><span>第 {line} 行起</span><button disabled={value.nextLine==null} onClick={()=>{setHistory(h=>[...h,line]);setLine(value.nextLine!)}}>下一页日志</button></footer></>:value.url?kind==='recordings'?<><video controls playsInline preload="auto" src={value.url} onLoadedData={()=>setMediaReady(true)} onError={e=>{const message=e.currentTarget.error?.message||'请下载原始录屏查看';setValue(v=>({...v,error:'视频无法播放：'+message}));}}/>{!mediaReady&&<p role="status">正在加载视频…</p>}</>:<img alt="用例校验截图" src={value.url}/>:<p role="status">正在读取产物…</p>}
  </div>
 </section></div>,document.body);
}
