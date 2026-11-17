import {executionProof,approvePendingExecutions} from './memory-admission.mjs';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {HierarchicalMemory as ContextWorkbench} from './hierarchical-memory.mjs';
import {CaseQuality} from './case-quality.mjs';
import {LabPlatform} from './lab-platform.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same=(a,b)=>a.orgId===b.orgId&&a.projectId===b.projectId;
const failure=(status,code,message)=>Object.assign(Error(message),{status,code});
export function createContextIntegration({db,scope,directory,sirchmunkUrl,now=Date.now}){
 const memory=new ContextWorkbench({directory,scope,engines:sirchmunkUrl?{sirchmunk:{url:sirchmunkUrl}}:{},now}),lab=new LabPlatform(db);
 const quality=new CaseQuality({db,memory,scope,directory});
 const contextProvider=(s,input)=>same(s,scope)?memory.prepared(input):null;
 async function prepare(path,input){
  let clients=[],conversationId;
  const match=/^conversations\/([^/]+)\/messages$/.exec(path);
  if(match){conversationId=match[1];const c=lab.conversation(scope,conversationId);clients=input.recipients||c.members;if(!Array.isArray(clients)||clients.some(id=>!c.members.includes(id)))throw failure(422,'INVALID_RECIPIENT','目标不属于当前会话');}
  else if(path==='requests')clients=lab.catalogs(scope).filter(c=>now()-c.updatedAt<60000&&c.groups.some(g=>g.enabled!==false)&&c.cases.length).slice(0,1).map(c=>c.clientId);
  if(typeof input?.text!=='string'||!input.text.trim()||input.text.length>12000)return;
  await Promise.all(clients.map(clientId=>memory.retrieve({query:input.text,clientId,conversationId,requestId:digest([input.requestId,clientId,conversationId||null])})));
 }
 async function client(identity,operation,input={}){
  if(!same(identity.scope,scope))throw failure(403,'CONTEXT_SCOPE_DENIED','当前项目不可访问');
  if(input.commandId){const command=lab.getCommand(scope,input.commandId);if(command.kind!=='chat'||command.clientId!==identity.clientId)throw failure(403,'CONTEXT_SCOPE_DENIED','请求不属于当前Client会话');input={...input,conversationId:command.payload.conversationId};}
  if(input.conversationId&&!lab.conversation(scope,input.conversationId).members.includes(identity.clientId))throw failure(403,'CONTEXT_SCOPE_DENIED','会话不属于当前Client');
  const bound={...input,clientId:identity.clientId};
  if(operation==='retrieve')return memory.retrieve(bound);
  if(operation==='browse')return memory.browse(bound);
  if(operation==='read')return memory.read(bound,{verifiedOnly:true});
  // Agents propose knowledge; they cannot certify their own conclusions.
  if(operation==='save')return memory.saveEntry({...bound,status:'candidate'});
  throw failure(404,'NOT_FOUND','没有此上下文操作');
 }
 function capture(){
  const commands=db.prepare("SELECT * FROM lab_command WHERE org_uid=? AND project_uid=? AND kind='chat' AND status IN ('succeeded','failed') AND result_json IS NOT NULL ORDER BY updated_at_ms DESC LIMIT 200").all(scope.orgId,scope.projectId);
  for(const command of commands){
   const payload=JSON.parse(command.body_json),result=JSON.parse(command.result_json);
   if(!Array.isArray(result.caseAuthoring))continue;
   for(const item of result.caseAuthoring){
    const id=digest([command.command_uid,item.operationId]);
    if(memory.db.prepare('SELECT 1 FROM cw_attempt WHERE id=?').get(id))continue;
    memory.attempt({id,title:item.title||item.caseId||'Case 编写',requirement:payload.text,output:JSON.stringify(item),origin:'agent',mode:payload.context?'memory':'baseline',model:result.model||'unreported',codeVersion:result.codeVersion||'unreported',promptVersion:'lab-im-context-v1',datasetVersion:payload.context?.datasetVersion||digest([]),retrievalId:payload.context?.id||null,evidence:['lab-command:'+command.command_uid,'agent-operation:'+item.operationId]});
   }
  }
 }
 let broker,active=0;
 function startModelBroker({port=8865}={}){
  broker=createServer(async(req,res)=>{
   const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}};
   if(req.method==='GET'&&req.url==='/health')return send(200,{modelReady:lab.catalogs(scope).some(c=>c.contextModel===true&&now()-c.updatedAt<60000),embedding:false});
   if(req.method!=='POST'||req.url!=='/v1/chat/completions')return send(404,{error:{code:'NOT_FOUND'}});
   if(active>=2)return send(429,{error:{code:'MODEL_BUSY'}});active++;
   let commandId,clientId;
   try{
    const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>300000)throw failure(413,'INPUT_TOO_LARGE','模型输入超过限制');chunks.push(c);}
    const input=JSON.parse(Buffer.concat(chunks).toString());
    if(!Array.isArray(input.messages)||input.messages.length>64||!input.messages.length||input.messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'))throw failure(422,'INVALID_MODEL_INPUT','只支持文本检索推理');
    const target=lab.catalogs(scope).find(c=>c.contextModel===true&&now()-c.updatedAt<60000);
    if(!target)throw failure(503,'NO_MODEL_CLIENT','没有在线且已配置模型的Client');
    commandId=randomUUID();clientId=target.clientId;const expiresAt=now()+90000;
    lab.command(scope,{commandId,clientId,kind:'context-llm',payload:{messages:input.messages,maxTokens:Math.min(4096,Number(input.max_tokens)||2048),expiresAt}});
    while(now()<expiresAt&&!res.destroyed){
     const c=lab.getCommand(scope,commandId);
     if(c.status==='succeeded')return send(200,{id:commandId,object:'chat.completion',model:c.result.model,choices:[{index:0,message:{role:'assistant',content:c.result.text},finish_reason:'stop'}]});
     if(['failed','unknown'].includes(c.status))throw failure(503,'CLIENT_MODEL_FAILED','Client模型推理失败');
     await new Promise(r=>setTimeout(r,200));
    }
    throw failure(504,'MODEL_TIMEOUT','Client模型推理超时');
   }catch(e){
    // A deadline ends this HTTP request, not the Client's durable receipt lifecycle.
    // The Client rejects expired commands and acknowledges its result through the existing queue.
    send(e.status||503,{error:{code:e.code||'MODEL_FAILED',message:'上下文检索的模型请求未完成'}});
   }finally{active--;}
  });
  broker.listen(port,'127.0.0.1');return broker;
 }
 let lastQuality=0;
 const timer=setInterval(()=>{try{capture();approvePendingExecutions(memory,e=>executionProof(db,scope,memory,e));if(now()-lastQuality>=30000){lastQuality=now();void quality.tick().catch(e=>console.error('[case-quality]',e.code||e.name));}}catch(e){console.error('[context-capture]',e.code||e.name);}},5000);timer.unref();
 async function handle(method,path,input){if(method==='GET'&&path==='quality')return quality.dashboard();const detail=/^quality\/records\/([a-f0-9]{64})$/.exec(path);if(method==='GET'&&detail)return quality.record(detail[1]);if(method==='POST'&&path==='quality/refresh'){capture();void quality.tick().catch(()=>{});return {automatic:true,status:'scheduled'};}return memory.handle(method,path,input);}
 return {memory,quality,handle,prepare,client,contextProvider,startModelBroker,capture,close:()=>{clearInterval(timer);broker?.close();void quality.close();memory.close();}};
}
