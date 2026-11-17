import {useEffect,useRef,useState} from 'react';
import {fetchAgentChatDesktops,type AgentChatDesktop} from '../api/agent-chat-desktops-ro';
import {uaCreatePromptOutcome,uaTaskDetail} from '../api/ua-session';
type Message={id:string;from:string;text:string;at:number;clientId?:string;key?:string;requestText?:string;taskId?:string;state?:string};
type Chat={id:string;name:string;members:string[];messages:Message[];group:boolean};
const STORE='solopi.im.chats.v1';
function read(recover=false):Chat[]{try{const x=JSON.parse(localStorage.getItem(STORE)||'[]');return Array.isArray(x)?x.filter(c=>typeof c.id==='string'&&typeof c.name==='string'&&Array.isArray(c.members)&&c.members.every((s:unknown)=>typeof s==='string')&&Array.isArray(c.messages)&&c.messages.every((m:Message)=>m&&typeof m.id==='string'&&typeof m.from==='string'&&typeof m.text==='string'&&typeof m.at==='number')).map((c:Chat)=>({...c,messages:c.messages.map(m=>recover&&m.state==='sending'&&!m.taskId?{...m,state:'unknown',text:'发送曾中断，点击核对结果恢复'}:m)})):[];}catch{return [];}}
const done=new Set(['succeeded','failed','cancelled','expired']);
export function ImChat(){
 const [people,setPeople]=useState<AgentChatDesktop[]>([]),[chats,setChats]=useState<Chat[]>(()=>read(true)),[selected,setSelected]=useState(''),[draft,setDraft]=useState(''),[error,setError]=useState(''),[creating,setCreating]=useState(false),[members,setMembers]=useState<string[]>([]),[name,setName]=useState(''),[busy,setBusy]=useState<Record<string,boolean>>({});
 const state=useRef(chats),mounted=useRef(true),tail=useRef<HTMLDivElement>(null);
 const commit=(next:Chat[])=>{localStorage.setItem(STORE,JSON.stringify(next));state.current=next;if(mounted.current)setChats(next);window.dispatchEvent(new Event('solopi-im-changed'));};
 const modify=(id:string,fn:(c:Chat)=>Chat)=>commit(read().map(c=>c.id===id?fn(c):c));
 useEffect(()=>{mounted.current=true;const ctl=new AbortController();const load=()=>void fetchAgentChatDesktops(ctl.signal).then(x=>{if(mounted.current)setPeople(x);}).catch(e=>{if(mounted.current&&!ctl.signal.aborted)setError(e.message);});load();const timer=setInterval(load,10000);return()=>{mounted.current=false;ctl.abort();clearInterval(timer);};},[]);
 useEffect(()=>{const sync=()=>{const next=read();state.current=next;setChats(next);};window.addEventListener('solopi-im-changed',sync);return()=>window.removeEventListener('solopi-im-changed',sync);},[]);
 useEffect(()=>{
  const ctl=new AbortController();let disposed=false;
  const open=async()=>{const id=location.hash.match(/^#\/(?:task|agent-request)\/([0-9A-HJKMNP-TV-Z]{26})$/)?.[1];if(!id)return;
   const known=read().find(c=>c.messages.some(m=>m.taskId===id));if(known){setSelected(known.id);return;}
   try{const d=await uaTaskDetail(id,ctl.signal);if(disposed)return;if(!d||d.kind!=='prompt'){setError('该旧链接不是聊天消息，请选择电脑Agent继续。');return;}
    const cId='history:'+id;const text=typeof d.result?.text==='string'?d.result.text:d.error||d.progress||'等待回复…';
    if(!read().some(c=>c.id===cId))commit([...read(),{id:cId,name:'历史消息',members:[d.clientId],group:false,messages:[{id:cId+':user',from:'我',text:d.prompt?.text||'历史消息内容未保存',at:Date.parse(d.createdAt)||Date.now()},{id:cId+':reply',from:label(d.clientId),text,at:Date.parse(d.endedAt||d.createdAt)||Date.now(),clientId:d.clientId,taskId:id,state:d.status}]}]);
    setSelected(cId);
   }catch(e){if(!disposed)setError((e as Error).message);}
  };void open();window.addEventListener('hashchange',open);return()=>{disposed=true;ctl.abort();window.removeEventListener('hashchange',open);};
 },[]);
 useEffect(()=>{tail.current?.scrollIntoView?.({block:'end'});},[chats,selected]);
 const chat=chats.find(c=>c.id===selected),label=(id:string)=>people.find(p=>p.clientId===id)?.hostname||id;
 const updateMessage=(chatId:string,id:string,patch:Partial<Message>)=>{modify(chatId,c=>({...c,messages:c.messages.map(m=>m.id===id?{...m,...patch}:m)}));};
 const tracking=useRef(new Set<string>());
 const track=async(chatId:string,m:Message)=>{if(!m.taskId||tracking.current.has(m.id))return;tracking.current.add(m.id);try{
  while(mounted.current){const detail=await uaTaskDetail(m.taskId,new AbortController().signal);if(!detail)throw Error('服务连接中断，请重试');if(detail.clientId!==m.clientId)throw Error('回复来源不匹配');
   const result=detail.result,text=typeof result?.text==='string'?result.text:typeof result?.message==='string'?result.message:done.has(detail.status)?detail.error||'本次处理已结束，未返回文本':detail.progress||'正在回复…';
   updateMessage(chatId,m.id,{state:detail.status,text});if(done.has(detail.status))break;await new Promise(r=>setTimeout(r,2000));
  }
 }catch(e){try{updateMessage(chatId,m.id,{state:'unknown',text:(e as Error).message});}catch{setError('无法保存回复，请检查浏览器存储');}}finally{tracking.current.delete(m.id);}};
 useEffect(()=>{for(const c of chats)for(const m of c.messages)if(m.taskId&&!done.has(m.state||'')&&m.state!=='unknown')void track(c.id,m);},[chats]);
 const openPerson=(p:AgentChatDesktop)=>{const id='direct:'+p.clientId;try{if(!state.current.some(c=>c.id===id))commit([...state.current,{id,name:p.hostname || p.clientId,members:[p.clientId],messages:[],group:false}]);setSelected(id);setError('');}catch{setError('无法保存会话，请检查浏览器存储。');}};
 const send=async()=>{if(!chat||!draft.trim()||busy[chat.id])return;if(chat.messages.some(m=>m.state==='unknown'||m.state==='sending'||m.taskId&&!done.has(m.state||''))){setError('请先等待或核对上一条消息，再发送新消息。');return;}const cId=chat.id,text=draft.trim();if(text.length>1500){setError('消息请控制在1500字以内');return;}
  const targets=chat.members.map(id=>people.find(p=>p.clientId===id));if(targets.some(p=>!p||!p.agentCapable||p.online!=='online')){setError('有成员离线或Agent尚不可用，请稍后重试。');return;}
  const entries=chat.members.map(clientId=>({id:crypto.randomUUID(),from:label(clientId),text:'等待回复…',at:Date.now(),clientId,key:crypto.randomUUID(),state:'sending'} satisfies Message));
  try{modify(cId,c=>({...c,messages:[...c.messages,{id:crypto.randomUUID(),from:'我',text,at:Date.now()},...entries]}));}catch{setError('消息未能保存，因此没有发送。');return;}
  setDraft('');setError('');setBusy(b=>({...b,[cId]:true}));
  try{for(const m of entries){
   const current=read().find(c=>c.id===cId)!;const history=current.messages.filter(x=>x.id!==m.id&&x.state!=='sending'&&x.text!=='正在回复…').slice(-16).map(x=>`${x.from}: ${x.text}`).join('\n').slice(-1650);
   const context=`${current.group?'你在一个群聊中，请阅读前面成员的发言并以自己身份回复。':'你在与用户私聊，请结合之前的聊天记录回复。'}\n${history}`;
   updateMessage(cId,m.id,{requestText:context});
   const response=await uaCreatePromptOutcome({kind:'prompt',prompt:{text:context},clientId:m.clientId!,idempotencyKey:m.key!,timeoutSeconds:300},new AbortController().signal);
   if(response.kind==='created'||response.kind==='duplicate'){if(response.detail.clientId!==m.clientId)throw Error('回复来源不匹配');updateMessage(cId,m.id,{taskId:response.detail.agentTaskId,state:response.detail.status});await track(cId,{...m,taskId:response.detail.agentTaskId});}
   else updateMessage(cId,m.id,{state:response.kind==='unknown'?'unknown':'failed',text:response.kind==='unknown'?'发送结果未知，请对账，勿重复发送':('message' in response?response.message:'服务暂不可用')});
  }}catch(e){for(const m of entries){const stored=state.current.find(c=>c.id===cId)?.messages.find(x=>x.id===m.id);if(stored?.state==='sending')try{updateMessage(cId,m.id,{state:stored.requestText?'unknown':'failed',text:stored.requestText?'发送中断，请核对结果':'尚未发送，本轮中断'});}catch{break;}}setError((e as Error).message);}finally{if(mounted.current)setBusy(b=>({...b,[cId]:false}));}
 };
 const reconcile=async(m:Message)=>{if(!chat)return;if(m.taskId){void track(chat.id,m);return;}if(!m.key||!m.requestText||!m.clientId){setError('发送未完成，请核对任务记录。');return;}
  const response=await uaCreatePromptOutcome({kind:'prompt',prompt:{text:m.requestText},clientId:m.clientId,idempotencyKey:m.key,timeoutSeconds:300},new AbortController().signal);
  if(response.kind==='created'||response.kind==='duplicate'){if(response.detail.clientId!==m.clientId){setError('回复来源不匹配');return;}updateMessage(chat.id,m.id,{taskId:response.detail.agentTaskId,state:response.detail.status});void track(chat.id,{...m,taskId:response.detail.agentTaskId});}
  else setError('仍未能取得结果，请稍后核对，原请求标识保持不变。');
 };
 return <section className="im-shell"><aside className="im-list"><div className="im-list-title"><h2>会话</h2><button onClick={()=>setCreating(true)}>＋ 群聊</button></div>
 {chats.map(c=><button className={`im-contact ${selected===c.id?'selected':''}`} key={c.id} onClick={()=>setSelected(c.id)}><b>{c.group?'♧ ':'◉ '}{c.name}</b><small>{c.messages.at(-1)?.text.slice(0,35)||'开始聊天'}</small></button>)}
 <h3>电脑上的Agent</h3>{people.filter(p=>p.agentCapable).map(p=><button className="im-contact" key={p.clientId} onClick={()=>openPerson(p)}><b>{p.hostname || p.clientId}</b><small>{p.online==='online'?'● 在线':'离线'}</small></button>)}</aside>
 <div className="im-main">{chat?<><header className="im-header"><h2>{chat.name}</h2><small>{chat.group?chat.members.map(label).join('、'):'电脑Agent · '+label(chat.members[0])}</small></header><div className="im-messages" aria-live="polite">{chat.messages.map(m=><article className={`im-message ${m.from==='我'?'mine':''}`} key={m.id}><small>{m.from} · {new Date(m.at).toLocaleTimeString()}</small><div className="im-bubble">{m.text}</div>{m.taskId&&<small className="im-delivery">{m.state==='succeeded'?'已回复':done.has(m.state||'')?'处理未完成':'处理中'}</small>}{m.state==='unknown'&&<button onClick={()=>void reconcile(m)}>核对结果</button>}</article>)}<div ref={tail}/></div><div className="im-compose"><textarea aria-label="消息" placeholder="输入消息，Enter发送，Shift+Enter换行" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><button className="primary" disabled={!draft.trim()||busy[chat.id]} onClick={()=>void send()}>{busy[chat.id]?'回复中…':'发送'}</button></div></>:<div className="im-welcome">选择电脑Agent开始聊天，或创建群聊。</div>}{error&&<p role="alert" className="im-error">{error}</p>}</div>
 {creating&&<div className="im-dialog" role="dialog" aria-label="创建群聊"><div><h2>新建群聊</h2><input aria-label="群名称" placeholder="群名称" value={name} onChange={e=>setName(e.target.value)}/>{people.filter(p=>p.agentCapable).map(p=><label key={p.clientId}><input type="checkbox" checked={members.includes(p.clientId)} onChange={e=>setMembers(x=>e.target.checked?[...x,p.clientId]:x.filter(id=>id!==p.clientId))}/>{p.hostname || p.clientId}</label>)}<button onClick={()=>setCreating(false)}>取消</button><button className="primary" disabled={!members.length||!name.trim()} onClick={()=>{try{const id=crypto.randomUUID();commit([...state.current,{id,name:name.trim(),members:[...members],messages:[],group:true}]);setSelected(id);setCreating(false);setName('');setMembers([]);}catch{setError('群聊未能保存');}}}>创建</button></div></div>}</section>;
}
