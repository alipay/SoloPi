import {toolPairingBalancedBefore} from '@deepseek-ai/dsh-compaction';
// Shared Desktop/Server progress policy. No business names or assistant-text matching.
import {createHash} from 'node:crypto';
import context from './context.js';
import policies from './request-policy.js';
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
export function pressureDecision(session,{capacity,output=16384,headroom=16384,inputBudget=Infinity,meterTokens=0}) {
 const messages=session.deriveMessages().map(m=>({role:m.role,content:m.content}));
 const tools=session.requestHeader()?.tools||[];
 const total=policies.inputEstimate(messages,tools);
 const fixed=policies.inputEstimate(messages.filter(m=>m.role==='system'),tools);
 const hard=Math.min(inputBudget,capacity?capacity-output:Infinity);
 const threshold=Math.min(180000,capacity?capacity*.8:Infinity,hard-headroom);
 // A pressure summary cannot shrink system instructions or schemas. Keep room
 // for useful new history rather than repeatedly rewriting the checkpoint.
 const growthRequired=Math.max(4096,Math.min(16384,Math.floor((Number.isFinite(hard)?hard:65536)*.1)));
 let checkpoint=-1;
 for(let seq=session.seq-1;seq>=0;seq--)if(session.eventAt(seq)?.type==='compaction/end'){checkpoint=seq;break;}
 const fresh=session.surface.nodes.filter(seq=>seq>checkpoint).map(seq=>session.deriveEventMessage(session.eventAt(seq))).filter(m=>m&&m.role!=='system'&&!['runtime-context','skill-catalog'].includes(m.source?.kind));
 const growth=context.estimateTokens(fresh.map(m=>({role:m.role,content:m.content})));
 const pressured=Math.max(total,meterTokens)>=threshold;
 const reason=!pressured?'below-pressure':fixed>=hard?'fixed-context-exceeds-budget':total>=hard?'hard-budget':total-fixed<growthRequired?'fixed-context-dominates':checkpoint>=0&&growth<growthRequired?'insufficient-new-history':'history-pressure';
 return {total,fixed,hard,threshold,growth,growthRequired,compact:pressured&&(reason==='fixed-context-exceeds-budget'?total-fixed>=growthRequired:!['fixed-context-dominates','insufficient-new-history'].includes(reason)),reason};
}
export class ToolProgressGuard {
 constructor(){this.locks=new Map();this.reset();}
 reset(){this.duplicates=new Map();this.tools=new Map();this.failure=undefined;}
 async acquire(name,args,signal){
  const key=JSON.stringify([name,stable(args)]),previous=this.locks.get(key)||Promise.resolve();
  let unlock;const current=new Promise(resolve=>unlock=resolve);this.locks.set(key,current);
  let done=false;const release=()=>{if(done)return;done=true;unlock();if(this.locks.get(key)===current)this.locks.delete(key);};
  let abort;
  try{
   await Promise.race([previous,new Promise((_,reject)=>{abort=()=>reject(signal.reason||Error('cancelled'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);
   return release;
  }catch(error){release();throw error;}finally{signal.removeEventListener('abort',abort);}
 }

 blockFor(name,args){
  const exact=[...this.duplicates.values()].find(v=>v.name===name&&v.args===JSON.stringify(stable(args))&&v.count>=2);
  const attempts=this.tools.get(name)||0;
  if(!exact&&attempts<4)return undefined;
  return {code:'TOOL_NO_PROGRESS',tool:name,attempts,identicalFailures:exact?.count||0,message:`工具 ${name} 已重复失败且无进展，已阻止继续尝试。本轮停止；原始回执和已提交操作保留，不自动重提。`};
 }
 record(name,args,result){
  // Native failures plus explicitly structured failed outcomes, never prose.
  const value=result.value;
  const failed=result.isError===true||value?.success===false||(value?.success!==true&&!!value?.error);
  if(!failed){this.tools.delete(name);for(const[k,v]of this.duplicates)if(v.name===name)this.duplicates.delete(k);return;}
  const code=result.error?.info?.code||value?.error?.code||value?.code||'TOOL_FAILED';
  const key=createHash('sha256').update(JSON.stringify([name,stable(args),code])).digest('hex');
  const exact=(this.duplicates.get(key)?.count||0)+1;
  this.duplicates.set(key,{name,args:JSON.stringify(stable(args)),count:exact});
  const attempts=(this.tools.get(name)||0)+1;this.tools.set(name,attempts);
  if(exact>=2||attempts>=4)this.failure={code:'TOOL_NO_PROGRESS',tool:name,attempts,identicalFailures:exact,
   message:`工具 ${name} 连续失败且未取得进展（本工具 ${attempts} 次，同参数同错误 ${exact} 次）。本轮已停止；原始回执与已提交操作保留，不自动重提。`};
 }
}

// Application wire pressure must retain recent complete tool batches. Actual
// overflow recovery remains the native engine's maximal reduction path.
export function pressureRegion(session,retainTokens=12000){
 const nodes=session.surface.nodes;
 const first=session.eventAt(nodes[0])?.type==='system/message'?1:0;
 let keep=nodes.length,used=0;
 for(let i=nodes.length-1;i>=first;i--){
  const message=session.deriveEventMessage(session.eventAt(nodes[i]));
  const cost=message?context.estimateTokens({role:message.role,content:message.content}):0;
  if(used>0&&used+cost>retainTokens)break;
  used+=cost;keep=i;if(used>=retainTokens)break;
 }
 while(keep>first&&keep<nodes.length&&!toolPairingBalancedBefore(session,nodes[keep]))keep--;
 return keep>first&&keep<nodes.length?{start:nodes[first],end:nodes[keep-1]}:null;
}
