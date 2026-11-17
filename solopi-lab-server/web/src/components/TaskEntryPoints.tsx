import {useEffect,useState} from 'react';
type EntryPoint={id:string;label:string;url:string};
export function parseEntryPoints(value:unknown):EntryPoint[]{
 const items=(value as {items?:unknown})?.items;
 if(!Array.isArray(items)||items.length>20)throw Error('任务入口配置无效');
 const ids=new Set<string>();return items.map(item=>{
  if(!item||typeof item.id!=='string'||!/^[a-z][a-z0-9._-]{0,63}$/.test(item.id)||ids.has(item.id)||typeof item.label!=='string'||!item.label.trim()||item.label.length>80||typeof item.url!=='string')throw Error('任务入口配置无效');ids.add(item.id);
  const url=new URL(item.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('任务入口地址无效');return{id:item.id,label:item.label,url:url.href};
 });
}
export function TaskEntryPoints():React.JSX.Element{
 const[items,setItems]=useState<EntryPoint[]>([]),[failed,setFailed]=useState(false);
 useEffect(()=>{const controller=new AbortController();void fetch('/superagent/entry-points',{signal:controller.signal,headers:{Accept:'application/json'}}).then(async response=>{if(!response.ok)throw Error();return parseEntryPoints(await response.json())}).then(value=>{if(!controller.signal.aborted)setItems(value)}).catch(()=>{if(!controller.signal.aborted)setFailed(true)});return()=>controller.abort()},[]);
 return <div className="diagnostics" style={{display:'flex',flexWrap:'wrap',gap:10,alignItems:'center'}} data-testid="tasks-entry-guide">
  <a className="primary" href="#/agents">创建任务</a>
  {items.map(item=><a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer">{item.label} ↗</a>)}
  {failed&&<span role="status" className="muted">外部任务入口加载失败</span>}
 </div>;
}
