// Transport compatibility only; AgentRuntime owns planning, tools and history.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
async function requestLocalModel(options,{request=require('./local-runtime.cjs').requestModel,createDeadline=require('./request-deadline').requestDeadline}={}){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-local-images-')),images=[];
 let outputCharacters=0,reasoningCharacters=0,responseCharacters=0;
 const policy=require('./request-policy').requestPolicy(options.provider.requestPolicy||{});
 const startedAt=Date.now(),deadline=createDeadline(policy);
 const signal=options.signal?AbortSignal.any([options.signal,deadline.signal]):deadline.signal;
 try{
  const messages=require('./report-media-input').reportMediaInput(require('./request-history').requestHistory(options.messages),{purpose:options.purpose}).map((m,messageIndex)=>{
   if(options.purpose!=='compaction')for(const a of m.attachments||[])if(a.mime?.startsWith('image/'))images.push({path:a.path,messageIndex});
   const wire=require('./attachments').attachmentMessage(m,false);
   if(Array.isArray(wire.content))wire.content=wire.content.filter((b,blockIndex)=>{
    if(b.type!=='image_url')return true;
    if(options.purpose==='compaction')return false;
    const match=/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.image_url?.url||'');
    if(!match)throw Object.assign(Error('本地运行时图片必须来自本机附件'),{code:'UNSUPPORTED_IMAGE_INPUT'});
    const file=path.join(temporary,`${messageIndex}-${blockIndex}`);fs.writeFileSync(file,Buffer.from(match[2],'base64'),{mode:0o600});images.push({path:file,messageIndex,blockIndex});return false;
   });return wire;
  });
  const result=await request({...options,messages,images,signal,timeoutMs:options.timeoutMs??policy.totalSeconds*1000,onResponseProgress:progress=>{
   // Model-generated JSON arguments are semantic response progress too, even
   // when text comes after calls. Never display those private parameters.
   if(signal.aborted||!Number.isSafeInteger(progress.characters)||progress.characters<=0)return;
   responseCharacters+=progress.characters;deadline.progress();
   options.onProgress?.({outputCharacters:Math.max(outputCharacters,responseCharacters),reasoningCharacters});
   options.onDelta?.({stage:'streaming'});
  },onProgress:chunk=>{
   if(!chunk.text||signal.aborted)return;deadline.progress();
   if(chunk.type==='reasoning-delta')reasoningCharacters+=chunk.text.length;
   else outputCharacters+=chunk.text.length;
   options.onProgress?.({...chunk,outputCharacters:Math.max(outputCharacters,responseCharacters),reasoningCharacters});
   options.onDelta?.(chunk.type==='reasoning-delta'?{reasoning:chunk.text,stage:'streaming'}:{content:chunk.text,stage:'streaming'});
  }});
  // The local transport resolves only after a successful CLI turn and a
  // validated response envelope. Its native result has no API finish_reason;
  // legacy compaction requires that semantic completion marker explicitly.
  // Preserve any explicit upstream limit/error marker instead of hiding it.
  return{role:'assistant',...result,finish_reason:result.finish_reason??(result.tool_calls?.length?'tool_calls':'stop')};
 }catch(error){
  // Preserve the same typed deadline contract used by API models. Recovery
  // retries only this uncommitted model step, never completed host tools.
  if(!options.signal?.aborted && deadline.signal.aborted){
   const facts=deadline.snapshot();
   const phase=facts.timeoutKind==='first-response'?'等待模型首个有效输出':facts.timeoutKind==='idle'?'模型有效输出停滞':'模型请求总耗时';
   throw Object.assign(Error(`${phase}达到 ${Math.round(facts.timeoutMs/1000)} 秒时限；本次未返回可执行的完整结果，已完成操作保留。`),{
    code:'MODEL_REQUEST_TIMEOUT',diagnostics:{category:'timeout',purpose:options.purpose||'conversation',runtimeId:options.provider.runtimeId,
     durationMs:Date.now()-startedAt,...facts,outputCharacters:Math.max(outputCharacters,responseCharacters),reasoningCharacters,causes:[{code:'MODEL_REQUEST_TIMEOUT'}]}
   });
  }
  throw error;
 }finally{deadline.close();fs.rmSync(temporary,{recursive:true,force:true});}
}
module.exports={requestLocalModel};
