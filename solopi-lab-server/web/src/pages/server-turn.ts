import {agentTurns,type AgentMessage,type AgentCall} from '@desktop-ui/agent-turns';
type NativeCall={id?:string;model_call_id?:string;name:string;status:string;gmt_create?:string};
export type ServerRow={id:string;text:string;status:string;gmt_create:string;tools?:NativeCall[];result?:{progress?:{event:string;attempt?:number;maxRetries?:number;code?:string;delayMs?:number};text?:string;error?:{message:string};tools?:NativeCall[];process?:AgentMessage[];streaming?:{content?:string;reasoning?:string;createdAt?:string;stage?:string}}};
const timestamp=(value:string)=>/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)?value.replace(' ','T')+'Z':value;
// Use the Server's persisted native records, including in-flight calls. The
// terminal result.tools field is only a fallback for older conversation data.
export function serverTurn(row:ServerRow){
 const active=['queued','running'].includes(row.status);
 const native=row.tools??row.result?.tools??[];
 const calls:AgentCall[]=native.map((c,i)=>({id:c.id||row.id+':tool:'+i,modelCallId:c.model_call_id||c.id||row.id+':tool:'+i,name:c.name,status:c.status,args:undefined,detailsAvailable:!!c.id,result:c.id?undefined:c}));
 const records=(row.result?.process||[]).map((m,i)=>({message:{...m},at:Date.parse(m.createdAt||'')||0,index:i}));
 calls.forEach((c,i)=>records.push({message:{role:'assistant',tool_calls:[{id:c.modelCallId!}],createdAt:timestamp(native[i].gmt_create||row.gmt_create)},at:Date.parse(timestamp(native[i].gmt_create||row.gmt_create))||0,index:records.length}));
 records.sort((a,b)=>a.at-b.at||a.index-b.index);
 const messages:AgentMessage[]=[{role:'user',content:row.text,createdAt:timestamp(row.gmt_create)},...records.map(r=>r.message)];
 const stream=row.result?.streaming;
 if(active&&stream&&(stream.content||stream.reasoning)){
  const last=messages.at(-1);
  if(last?.content!==stream.content||last?.reasoning_content!==stream.reasoning)messages.push({role:'assistant',content:stream.content,reasoning_content:stream.reasoning,createdAt:stream.createdAt});
 }
 const final=row.result?.text;
 if(!active&&final&&messages.at(-1)?.content!==final)messages.push({role:'assistant',content:final});
 return agentTurns(messages,calls,active?'running':'idle')[0];
}
