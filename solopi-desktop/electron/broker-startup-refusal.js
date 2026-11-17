// Startup failed before any request dispatch. Return a definite refusal to its caller.
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
function writeBrokerStartupRefusal({taskPayloadPath,controlPayloadPath,error}){
 let written=0;
 for(const [kind,payloadPath] of [['task',taskPayloadPath],['control',controlPayloadPath]]){
  if(!payloadPath)continue;
  try{
   const payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'));
   const ackPath=kind==='task'?payload.__headlessAckPath:payload.ackPath;
   if(typeof ackPath!=='string'||!path.isAbsolute(ackPath)||fs.existsSync(ackPath))continue;
   const result={success:false,submitted:false,submissionOutcome:'not-submitted',task:null,pid:process.pid,
    errorCode:error?.code||'BROKER_STARTUP_FAILED',error:error?.message||'Broker startup failed before dispatch',
    ...(kind==='task'?{schemaVersion:'glassbox.headlessTaskAck.v1',taskId:payload.taskId||'',caseCount:payload.cases?.length||0}:{requestId:payload.request?.requestId})};
   // Exclusive publication preserves an already completed or concurrently delivered receipt.
   const temporary=ackPath+'.'+randomUUID()+'.tmp';
   try{const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(result));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.linkSync(temporary,ackPath);written++;}finally{fs.rmSync(temporary,{force:true});}
  }catch{ /* If publication fails, the caller must keep the outcome unknown. */ }
 }
 return written;
}
module.exports={writeBrokerStartupRefusal};
