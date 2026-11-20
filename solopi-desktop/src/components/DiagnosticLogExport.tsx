import { useLanguage } from '../language';
import {useRef,useState} from 'react';
import {Download,Loader2} from 'lucide-react';
type Result={success?:boolean;canceled?:boolean;path?:string;warning?:string;error?:string};
export default function DiagnosticLogExport({invoke}:{invoke?:(channel:string)=>Promise<unknown>}){
 const { t } = useLanguage();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const pending=useRef(false);
 const run=async()=>{
  if(pending.current||!invoke)return;pending.current=true;setBusy(true);setMessage('');setError('');
  try{const r=await invoke('diagnostics:export') as Result;if(r.canceled)return;if(!r.success)throw Error(r.error||t('诊断日志导出失败','Could not export diagnostics'));setMessage(t('已导出', 'Exported') + ' · ' + r.path + (r.warning ? ' · ' + r.warning : ''));}
  catch(e){setError(e instanceof Error?e.message:t('诊断日志导出失败','Could not export diagnostics'));}
  finally{pending.current=false;setBusy(false);}
 };
 return <div className="max-w-xl text-right"><button type="button" disabled={busy||!invoke} onClick={()=>void run()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<Download className="h-4 w-4"/>}{busy?t('正在导出…','Exporting…'):t('导出诊断日志','Export diagnostics')}</button>{message&&<p role="status" className="mt-2 break-all text-xs text-emerald-700">{message}</p>}{error&&<p role="alert" className="mt-2 break-words text-xs text-rose-600">{error}</p>}</div>;
}
