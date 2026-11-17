import {useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@desktop-ui/ui/dialog';
import {ConversationOriginal} from './ConversationOriginal';
export function OriginalPreview({original,onClose,read}:{original:any;onClose:()=>void;read:(input:Record<string,unknown>)=>Promise<any>}){
 const [text,setText]=useState(original.text||''),[next,setNext]=useState<number|null>(original.nextOffset??null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const more=async()=>{if(busy||next===null)return;setBusy(true);setError('');try{const page=await read({offset:next,limit:6000});setText((value:string)=>value+(page.text||''));setNext(page.nextOffset??null)}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="memory-original-preview" overlayClassName="memory-original-overlay"><header><DialogTitle>{original.name}</DialogTitle><DialogDescription>原文预览</DialogDescription></header><div className="memory-original-body">{original.conversation?<ConversationOriginal original={original} read={offset=>read({includeMessages:true,messageOffset:offset,messageLimit:5})}/>:<><pre>{text||'此格式暂不支持预览，请下载原文件。'}</pre>{next!==null&&<button disabled={busy} onClick={()=>void more()}>{busy?'正在读取…':'继续读取'}</button>}</>}{error&&<p role="alert">{error}<button onClick={()=>void more()}>重试</button></p>}</div></DialogContent></Dialog>;
}
